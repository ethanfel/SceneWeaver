import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { createCommandSession } from '../public/integrations/command-session.mjs';
import { generationProposal, generationTargets } from '../public/integrations/production-range.mjs';
import * as hooks from '../e2e/fixtures/h3-native/h3_chain_top_level_requeue_coordinator.mjs';

function fixture() {
  const starter = JSON.parse(readFileSync('public/examples/h3-starter.api.json'));
  starter.assets = { class_type: 'MiniMaxH3ProjectAssetManager', inputs: { run_name: 'sceneweaver_first_film', ownership_json: 'synthetic-private-proof' } };
  starter['1700'].inputs.project_assets = ['assets', 0];
  // This side output would otherwise be discovered by H3's recursive loop.
  starter.extra = { class_type: 'SaveImage', inputs: { images: ['1705', 1] } };
  const graph = { id: 'production', _nodes: [], links: {}, serialize() { return { id: this.id, native: true, nodes: Object.keys(starter) }; } };
  let linkId = 0;
  for (const [id, node] of Object.entries(starter)) {
    const item = { id, type: node.class_type, graph, widgets: [], inputs: [] };
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) { graph.links[++linkId] = { origin_id: value[0], origin_slot: value[1] }; item.inputs.push({ name, link: linkId }); }
      else item.widgets.push({ name, value, callback() {} });
    }
    graph._nodes.push(item);
  }
  const posts = [], phases = [];
  const app = { graph, canvas: { graph }, async graphToPrompt(current) {
    return { workflow: current.serialize(), output: Object.fromEntries(current._nodes.map(node => [node.id, { class_type: node.type, inputs: { ...Object.fromEntries(node.widgets.map(w => [w.name, w.value])), ...Object.fromEntries(node.inputs.map(input => { const link = current.links[input.link]; return [input.name, [link.origin_id, link.origin_slot]]; })) } }])) };
  } };
  const api = { async fetchApi() { return Response.json({ queue_running: [], queue_pending: [] }); }, async queuePrompt(...args) { posts.push(args); return { prompt_id: 'native-job' }; } };
  const adapter = createAdapter(app, api, { generationHooks: hooks });
  const get = (id, name) => graph._nodes.find(n => n.id === id).widgets.find(w => w.name === name);
  get('1700', 'base_seed').value = '18446744073709551615';
  get('1700', 'base_seed').beforeQueued = options => phases.push(['before', options]);
  get('1700', 'base_seed').afterQueued = options => phases.push(['after', options]);
  const command = () => { const base = adapter.snapshot(); return { action: 'generate-range', binding: base.binding, revision: base.revision, plan: '1700', project: 'sceneweaver_first_film', branch_id: 'main', target: '1706', start: 2, end: 3, verify: true }; };
  return { app, api, graph, adapter, get, posts, phases, command };
}

test('queues only native assembly dependencies, retaining seeds, proof and full canvas metadata', async () => {
  const f = fixture(), result = await f.adapter.command(f.command());
  assert.equal(result.prompt_id, 'native-job'); assert.equal(f.posts.length, 1);
  const [number, compiled, options] = f.posts[0];
  assert.equal(number, 0); assert.deepEqual(options, { partialExecutionTargets: ['1706'] });
  assert.equal(compiled.output.extra, undefined); assert.ok(compiled.workflow.nodes.includes('extra'));
  assert.equal(compiled.output.assets.inputs.ownership_json, 'synthetic-private-proof');
  assert.equal(JSON.stringify(result.snapshot).includes('synthetic-private-proof'), false);
  assert.equal(compiled.output['1700'].inputs.base_seed, '18446744073709551615');
  for (const id of ['1701', '1947']) { assert.equal(compiled.output[id].inputs.scene_range, '2:3'); assert.equal(f.get(id, 'start_clip').value, 2); }
  assert.deepEqual(f.phases, [['before', { isPartialExecution: true }], ['after', { isPartialExecution: true }]]);
});

test('rejects changed project, branch, disconnected scope and invalid ranges before callbacks', async () => {
  for (const change of [{ project: 'other' }, { branch_id: 'other' }, { start: 4 }, { end: 1 }, { start: 1.5 }, { target: 'extra' }]) {
    const f = fixture(); await assert.rejects(f.adapter.command({ ...f.command(), ...change })); assert.equal(f.posts.length, 0); assert.equal(f.phases.length, 0);
  }
  const f = fixture(); f.graph._nodes.find(n => n.id === '1701').inputs.push({ name: 'scene_range', link: 9999 });
  assert.throws(() => generationProposal(f.adapter.snapshot(), f.command()), /scene_range/);
});

test('rejects native serialization that changes the reviewed Plan or scope and restores owned scope edits', async () => {
  for (const alter of [p => { p.output['1701'].inputs.scene_range = '1'; }, p => { p.output['1700'].inputs.plan_json = '{"shots":[{"id":"changed"}]}'; }, p => { p.output['1706'].inputs.manifest = ['extra', 0]; }, p => { p.output['1705'].inputs.execution_mode = 'top_level_requeue'; }, p => { p.output['1701'].inputs.initial_state = { index: 1, end_clip: 99 }; }]) {
    const f = fixture(), serialize = f.app.graphToPrompt;
    f.app.graphToPrompt = async graph => { const prompt = await serialize(graph); alter(prompt); return prompt; };
    await assert.rejects(f.adapter.command(f.command()));
    assert.equal(f.posts.length, 0); assert.equal(f.get('1701', 'scene_range').value, '');
  }
});

test('a graph switch while native serialization awaits cannot queue either workflow', async () => {
  const f = fixture(), serialize = f.app.graphToPrompt;
  f.app.graphToPrompt = async graph => { await Promise.resolve(); f.app.graph = { id: 'another', _nodes: [], links: {} }; return serialize(graph); };
  await assert.rejects(f.adapter.command(f.command()), /workflow changed/); assert.equal(f.posts.length, 0);
});

test('concurrent user edits are preserved and stop submission', async () => {
  const f = fixture(), serialize = f.app.graphToPrompt;
  f.app.graphToPrompt = async graph => { f.get('1701', 'scene_range').value = '1'; return serialize(graph); };
  await assert.rejects(f.adapter.command(f.command()), /changed/);
  assert.equal(f.posts.length, 0); assert.equal(f.get('1701', 'scene_range').value, '1');
});

test('serialized Plan comparison preserves exact uint64 text even when JSON numbers round to the same value', async () => {
  const f = fixture(), serialize = f.app.graphToPrompt;
  f.get('1700', 'plan_json').value = '{"shots":[{"id":"one","seed":18446744073709551615},{"id":"two"},{"id":"three"}]}';
  f.app.graphToPrompt = async graph => { const prompt = await serialize(graph); prompt.output['1700'].inputs.plan_json = prompt.output['1700'].inputs.plan_json.replace('18446744073709551615', '18446744073709551614'); return prompt; };
  await assert.rejects(f.adapter.command(f.command()), /reviewed Plan/);
  assert.equal(f.posts.length, 0);
});

test('uncertain responses are not retried; accepted receipts retain the native job identity', async () => {
  const f = fixture(), session = createCommandSession(f.adapter);
  const success = await session.execute('job-1', f.command());
  assert.equal(success.receipt.prompt_id, 'native-job');
  assert.equal((await session.execute('job-1', f.command())).receipt.prompt_id, 'native-job');
  assert.equal(f.posts.length, 1);
  f.api.queuePrompt = async (...args) => { f.posts.push(args); throw new TypeError('Lost response'); };
  const failed = await session.execute('job-2', f.command()); assert.equal(failed.outcome, 'uncertain');
  assert.match(failed.error, /may have reached/);
  await session.execute('job-2', f.command()); assert.equal(f.posts.length, 2);
});

test('HTTP rejection and after-queue callback failure have distinct submission outcomes', async () => {
  const f = fixture(); f.api.queuePrompt = async () => { throw Object.assign(new Error('Prompt execution failed'), { status: 400, response: { error: 'Invalid model' }, toString() { return this.response.error; } }); };
  await assert.rejects(f.adapter.command(f.command()), error => error.outcome === 'rejected' && error.message === 'Invalid model');
  f.api.queuePrompt = async () => ({ prompt_id: 'accepted' });
  f.get('1700', 'base_seed').afterQueued = () => { throw new Error('UI failure'); };
  const result = await f.adapter.command(f.command()); assert.equal(result.prompt_id, 'accepted'); assert.match(result.warning, /accepted/);
});

test('subgraphs and multi-scene top-level handoffs stay unavailable until their native queue contracts exist', async () => {
  const f = fixture(); f.graph._nodes.find(n => n.id === '1705').widgets.push({ name: 'execution_mode', value: 'top_level_requeue' });
  await assert.rejects(f.adapter.command(f.command()), /one scene at a time/);
  await f.adapter.command({ ...f.command(), end: 2 }); assert.equal(f.posts.length, 1);
  f.graph._nodes.push({ id: 'sub', type: 'Subgraph', subgraph: { _nodes: [] } });
  assert.equal(f.adapter.snapshot().capabilities.generationVersion, 0);
});

test('ALT drafts including disabled objects cannot silently override a reviewed original range', () => {
  const f = fixture(), snapshot = f.adapter.snapshot();
  snapshot.nodes.studio = { class_type: 'MiniMaxH3ChainPlanStudio', inputs: { plan: ['1700', 0], start_clip: 1, scene_range: '', verify_resume_history: true, alternate_take_json: 'null' }, editable: ['start_clip', 'scene_range', 'verify_resume_history'] };
  snapshot.nodes['1947'].inputSources.plan = ['studio', 0];
  assert.equal(generationTargets(snapshot.nodes, '1700').length, 1);
  generationProposal(snapshot, f.command());
  for (const value of ['', '{"enabled":false,"scene":1}', '{"enabled":true}']) {
    snapshot.nodes.studio.inputs.alternate_take_json = value;
    assert.throws(() => generationProposal(snapshot, f.command()), /ALT state|ALT draft/);
  }
});
