import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as schema from '../e2e/fixtures/h3-native/h3_prompt_schema_core.mjs';
import * as completion from '../e2e/fixtures/h3-native/h3_prompt_completion_core.mjs';
import * as rich from '../e2e/fixtures/h3-native/h3_rich_prompt_editor_core.mjs';
import * as references from '../e2e/fixtures/h3-native/h3_reference_preview_core.mjs';
import * as core from '../e2e/fixtures/h3-native/h3_chain_plan_core.mjs';
import { inspectPromptDraft } from '../public/integrations/prompt-tools.mjs';
import { editPlanDraft } from '../public/integrations/plan-authoring.mjs';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { createCommandSession } from '../public/integrations/command-session.mjs';
import { discoverH3 } from '../public/integrations/h3-discovery.mjs';
const modules = { schema, completion, rich, references };
const plan = JSON.stringify({ prompt_prefix: '@shared', shots: [{ id: 'a', prompt: ['Original', '', 'Paragraph'], seed: '18446744073709551615', custom: { untouched: true } }, { id: 'b', prompt: 'Other scene' }] });
const request = extra => ({ index: 0, value: 'A simple scene', mode: 'auto', duration: 6, finalShot: 1, caret: 0, ...extra });
const inspect = (extra, nodes = {}) => inspectPromptDraft(modules, core, nodes, 'p', plan, request(extra));
const node = (class_type, inputs) => ({ class_type, inputs, editable: Object.keys(inputs), mode: 0 });
const catalog = { project: 'film', assets: [
  { id: 'one', tag: 'actor', kind: 'image', role: 'picture', enabled: true },
  { id: 'two', tag: 'shared', kind: 'image', role: 'picture', enabled: true },
  { id: 'three', tag: 'anchor', kind: 'image', role: 'semantic_anchor', enabled: true },
  { id: 'four', tag: 'hidden', kind: 'image', role: 'picture', enabled: false },
] };
const graphNodes = () => ({ p: node('MiniMaxH3ChainPlan', { project_assets: ['m', 0], plan_json: plan, run_name: 'film' }), m: node('MiniMaxH3ProjectAssetManager', { run_name: 'film', catalog_json: JSON.stringify(catalog), semantic_anchor_mode: 'picture' }) });

test('all native schema modes produce reviewable structure without rewriting source or claiming repairs of existing errors', () => {
  for (const mode of schema.H3_MODES.map(item => item.id)) {
    const result = inspect({ mode, operation: 'structure', value: 'Keep this sentence.' });
    assert.equal(result.proposal.text, schema.ensureH3Structure('Keep this sentence.', mode, { duration: 6, finalShot: 1 }).text);
    assert.ok(result.proposal.text.includes('Keep this sentence.'));
    assert.equal(result.tokens.map(token => token.text).join(''), 'Keep this sentence.');
  }
  const invalid = 'overall_soundscape: rain\nintegrated_multimodal_description: [Shot 1] <d>Unclosed\nnon_diegetic_music: N/A';
  const proposed = inspect({ value: invalid, operation: 'structure', mode: 't2va' });
  assert.ok(inspect({ value: proposed.proposal.text }).analysis.problems.some(item => item.code === 'dialogue'));
  assert.ok(inspect({ value: proposed.proposal.text }).analysis.problems.some(item => item.code === 'order'));
  assert.equal(JSON.parse(plan).shots[0].prompt[0], 'Original');
});

test('completion uses native speaker/dialogue tokens and recomputes the insertion from current text', () => {
  const result = inspect({ value: '<', caret: 1 });
  const index = result.items.findIndex(item => item.insertText === '<d>'); assert.ok(index >= 0);
  const applied = inspect({ value: '<', caret: 1, operation: 'complete', item: index });
  assert.ok(applied.proposal.text.startsWith('<d>'));
  assert.ok(inspect({ value: '(S', caret: 2 }).items.length);
  assert.throws(() => inspect({ operation: 'complete', item: 1000 }), /no longer available/);
  assert.throws(() => inspect({ operation: 'section', section: 'summary', mode: 't2va' }), /does not belong/);
});

test('aliases come only from the exact connected catalog, with semantic anchors and shared direction activation', () => {
  const nodes = graphNodes(), before = JSON.stringify(nodes), result = inspect({ value: '@ac', caret: 3 }, nodes);
  assert.ok(result.items.some(item => item.label === '@actor'));
  assert.ok(result.references.find(item => item.token === '@shared').active);
  assert.ok(!result.items.some(item => item.label === '@anchor'));
  assert.ok(inspect({ value: '#an', caret: 3 }, nodes).items.some(item => item.label === '#anchor'));
  assert.ok(!result.references.some(item => item.token === '@hidden'));
  assert.ok(result.referenceScope.includes('#m'));
  assert.doesNotThrow(() => JSON.stringify(result)); assert.equal(JSON.stringify(nodes), before);
  const staged = inspect({ value: '@actor', caret: 6 }, nodes);
  assert.ok(staged.references.find(item => item.token === '@actor').active);
  assert.ok(inspect({ value: '#anchor[1s]', caret: 11 }, nodes).tokens.some(token => token.semantic && !token.unresolved));
  nodes.m.inputs.catalog_json = JSON.stringify({ ...catalog, project: 'other' });
  assert.equal(inspect({ value: '@', caret: 1 }, nodes).references.length, 0);
  nodes.m.inputs.catalog_json = JSON.stringify(catalog); delete nodes.p.inputs.project_assets;
  assert.equal(inspect({ value: '@', caret: 1 }, nodes).references.length, 0);
});

test('prompt staging preserves blank paragraphs, uint64 seeds, other scenes and metadata', () => {
  const out = JSON.parse(editPlanDraft(core, plan, { type: 'scene-prompt', index: 0, value: 'First\r\n\r\nLast\r' }).text);
  assert.deepEqual(out.shots[0].prompt, ['First', '', 'Last', '']);
  assert.equal(out.shots[0].seed, '18446744073709551615'); assert.deepEqual(out.shots[0].custom, { untouched: true });
  assert.deepEqual(out.shots[1].prompt, ['Other scene']);
  assert.throws(() => editPlanDraft({ ...core, promptTextToLines: undefined }, plan, { type: 'scene-prompt', index: 0, value: 'Text' }), /normalizer is unavailable/);
  for (const change of [{ mode: 'invented' }, { duration: 0 }, { finalShot: 100 }, { index: 2 }]) assert.throws(() => inspect(change));
});

test('prompt inspection is a read-only bound command and rejects changed source, workflow or revision', async () => {
  const graph = { id: 'one', _nodes: [], links: { 1: { origin_id: 'text', origin_slot: 0 } } };
  const source = { id: 'text', type: 'PrimitiveStringMultiline', graph, widgets: [{ name: 'value', value: plan }], inputs: [] };
  graph._nodes.push({ id: 'p', type: 'MiniMaxH3ChainPlan', graph, widgets: [], inputs: [{ name: 'plan_json_input', link: 1 }] }, source);
  const adapter = createAdapter({ graph, canvas: { graph } }, { fetchApi() { throw new Error('No network writes'); } }, { planAuthoring: core, promptTools: modules });
  const session = createCommandSession(adapter), snapshot = adapter.snapshot();
  const command = { action: 'prompt-tools', binding: snapshot.binding, revision: snapshot.revision, plan: 'p', source_node: 'text', source_widget: 'value', text: plan, request: request({ operation: 'structure' }) };
  const result = await session.execute('inspection', command);
  assert.ok(result.result.data.proposal); assert.deepEqual(session.recent(), []); assert.equal(source.widgets[0].value, plan);
  await assert.rejects(adapter.command({ ...command, binding: 'different' }));
  await assert.rejects(adapter.command({ ...command, source_node: 'p' }), /different text source/);
  source.widgets[0].value = '{"shots":["new"]}'; await assert.rejects(adapter.command(command), /workflow changed/);
});

test('discovery follows installed helper import paths and isolates an absent optional alias helper', async () => {
  const fixture = new URL('../e2e/fixtures/h3-native/', import.meta.url);
  const api = { fetchApi: async path => ({ ok: true, json: async () => path === '/extensions' ? ['h3_project_asset_manager.js', 'h3_chain_scene_prompt_editor.js'].map(name => `/extensions/h3/${name}`) : {} }) };
  const options = { baseUrl: 'http://comfy.test', readText: url => readFile(new URL(new URL(url).pathname.split('/').pop(), fixture), 'utf8'), importModule: async url => import(new URL(new URL(url).pathname.split('/').pop(), fixture).href) };
  const result = await discoverH3(api, options); assert.equal(result.promptTools.schema.analyzeH3Prompt, schema.analyzeH3Prompt); assert.equal(typeof result.promptTools.references.projectAssetReferenceRecords, 'function');
  const missing = await discoverH3(api, { ...options, importModule: url => { if (url.includes('reference_preview')) throw new Error('missing'); return options.importModule(url); } });
  assert.equal(typeof missing.promptTools.completion.promptCompletionItems, 'function'); assert.equal(missing.promptTools.references, undefined);
});
