import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChoices, resolvePlanBinding, traceSource } from '../public/integrations/binding-core.mjs';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { rebaseDraft } from '../public/integrations/bridge-core.mjs';

const node = (class_type, inputs, more = {}) => ({ class_type, inputs, ...more });
const plan = inputs => node('MiniMaxH3ChainPlan', { run_name: 'fallback', plan_json: '{"shots":[]}', ...inputs });
const carousel = project => node('MiniMaxH3ProjectAssetManager', { run_name: project });

test('direct wiring selects the exact Carousel even when another has the same project name', () => {
  const nodes = { p: plan({ project_assets: ['b', 0] }), a: carousel('film'), b: carousel('film') };
  assert.equal(resolvePlanBinding(nodes, 'p').managerId, 'b');
  delete nodes.p.inputs.project_assets;
  nodes.p.inputs.run_name = 'film';
  assert.equal(resolvePlanBinding(nodes, 'p').status, 'ambiguous');
  assert.equal(resolvePlanBinding(nodes, 'p').managerId, '');
});

test('follows reroutes and Get/Set sources without using stale Plan project names', () => {
  const nodes = { p: plan({ project_assets: ['get', 0] }), get: node('GetNode', { Constant: 'assets' }), set: node('SetNode', { Constant: 'assets', '*': ['r', 0] }), r: node('Reroute', { '': ['a', 0] }), a: carousel('actual') };
  const binding = resolvePlanBinding(nodes, 'p');
  assert.equal(binding.project, 'actual');
  assert.deepEqual(binding.assetPath, ['get', 'set', 'r', 'a']);
  nodes.other = node('SetNode', { Constant: 'assets', '*': ['a', 0] });
  assert.equal(resolvePlanBinding(nodes, 'p').status, 'ambiguous');
  assert.equal(resolvePlanBinding(nodes, 'p').project, '');
});

test('bus lookup respects nested graph scopes and requires native ancestor support', () => {
  const nodes = { a: carousel('root'), set: node('SetNode', { Constant: 'assets', '*': ['a', 0] }), 'sub/p': plan({ project_assets: ['sub/get', 0] }), 'sub/get': node('GetNode', { Constant: 'assets' }), 'sibling/set': node('SetNode', { Constant: 'assets', '*': ['sibling/a', 0] }), 'sibling/a': carousel('sibling') };
  assert.equal(resolvePlanBinding(nodes, 'sub/p').status, 'unresolved');
  nodes['sub/get'].routing = { busAncestors: true };
  assert.equal(resolvePlanBinding(nodes, 'sub/p').project, 'root');
  nodes['sub/set'] = node('SetNode', { Constant: 'assets', '*': ['sub/a', 0] });
  nodes['sub/a'] = carousel('inner');
  assert.equal(resolvePlanBinding(nodes, 'sub/p').project, 'inner');
  nodes['sub/set'].mode = 2;
  assert.equal(resolvePlanBinding(nodes, 'sub/p').status, 'unresolved');
});

test('unknown, cyclic, broken, bypassed, and wrong-output connections never fall back to a project name', () => {
  const nodes = { p: plan({ project_assets: ['r', 0] }), a: carousel('fallback'), r: node('Reroute', { '': ['r', 0] }) };
  assert.match(traceSource(nodes, ['r', 0]).reason, /cycle/);
  assert.equal(resolvePlanBinding(nodes, 'p').project, '');
  nodes.r.inputs[''] = ['missing', 0];
  assert.equal(resolvePlanBinding(nodes, 'p').project, '');
  nodes.r = node('UnknownAssetTransformer', { assets: ['a', 0] });
  assert.equal(resolvePlanBinding(nodes, 'p').status, 'unresolved');
  nodes.p.inputs.project_assets = ['a', 1];
  assert.equal(resolvePlanBinding(nodes, 'p').status, 'unresolved');
  nodes.p.inputs.project_assets = ['a', 0]; nodes.a.mode = 4;
  assert.equal(resolvePlanBinding(nodes, 'p').project, '');
  delete nodes.p.inputs.project_assets; nodes.p.inputErrors = ['project_assets'];
  assert.equal(resolvePlanBinding(nodes, 'p').project, '');
});

test('connected Studios are presentation nodes, while a standalone Studio is an authoring choice', () => {
  const nodes = { p: plan({}), r: node('Reroute', { '': ['p', 0] }), studio: node('MiniMaxH3ChainPlanStudio', { plan: ['r', 0], plan_json: '{"shots":[]}' }), standalone: node('MiniMaxH3ChainPlanStudio', { run_name: 'another', plan_json: '{"shots":[]}' }) };
  assert.deepEqual(planChoices(nodes).map(([id]) => id), ['p', 'standalone']);
  assert.deepEqual(resolvePlanBinding(nodes, 'p').studioIds, ['studio']);
  assert.match(resolvePlanBinding(nodes, 'studio').issues[0], /upstream Plan p/);
});

test('the native adapter and rebased UI agree on missing-link binding failures', async () => {
  const graph = { id: 'workflow', links: {}, _nodes: [] };
  const nativePlan = { id: 1, type: 'MiniMaxH3ChainPlan', graph, widgets: [{ name: 'run_name', value: 'film' }, { name: 'plan_json', value: '{"shots":[]}' }], inputs: [{ name: 'project_assets', link: 999 }] };
  const nativeManager = { id: 2, type: 'MiniMaxH3ProjectAssetManager', graph, widgets: [{ name: 'run_name', value: 'film' }], inputs: [] };
  graph._nodes = [nativePlan, nativeManager];
  let queued = false;
  const adapter = createAdapter({ graph, async queuePrompt() { queued = true; } }, {});
  const snapshot = adapter.snapshot();
  assert.deepEqual(snapshot.nodes['1'].inputErrors, ['project_assets']);
  assert.equal(snapshot.projectBindings.plans[0].status, 'unresolved');
  const rebased = rebaseDraft(snapshot, snapshot, { prompt: snapshot.nodes });
  assert.equal(resolvePlanBinding(rebased.draft.prompt, '1').status, 'unresolved');
  await assert.rejects(adapter.command({ action: 'queue', plan: '1', binding: snapshot.binding, revision: snapshot.revision }), /source is missing/);
  assert.equal(queued, false);
});

test('subgraph input/output rails bind the correct project and retain raw inspection links', async () => {
  const root = { id: 'root', _nodes: [], links: {} }, inner = { _nodes: [], links: {}, inputNode: { id: -10 } };
  const native = (id, type, graph, inputs, values) => ({ id, type, graph, inputs, widgets: Object.entries(values).map(([name, value]) => ({ name, value })) });
  const outside = native('asset', 'MiniMaxH3ProjectAssetManager', root, [], { run_name: 'outside' });
  const inside = native('asset', 'MiniMaxH3ProjectAssetManager', inner, [], { run_name: 'inside' });
  const innerPlan = native('plan', 'MiniMaxH3ChainPlan', inner, [{ name: 'project_assets', link: 1 }], { run_name: 'wrong-inner', plan_json: '{"shots":[]}' });
  const outerPlan = native('plan', 'MiniMaxH3ChainPlan', root, [{ name: 'project_assets', link: 4 }], { run_name: 'wrong-outer', plan_json: '{"shots":[]}' });
  inner.links[1] = { origin_id: -10, origin_slot: 0 };
  inner.links[2] = { origin_id: 'asset', origin_slot: 0 };
  inner.outputNode = { slots: [{ getLinks: () => [inner.links[2]] }] };
  inner._nodes = [inside, innerPlan];
  const wrapper = native('sub', 'subgraph-definition', root, [{ name: 'assets', link: 3 }], {}); wrapper.subgraph = inner;
  root.links[3] = { origin_id: 'asset', origin_slot: 0 };
  root.links[4] = { origin_id: 'sub', origin_slot: 0 };
  root._nodes = [outside, wrapper, outerPlan];
  const adapter = createAdapter({ graph: root }, {}), snapshot = adapter.snapshot();
  assert.deepEqual(snapshot.nodes['sub/plan'].inputs.project_assets, ['sub/-10', 0]);
  assert.equal(resolvePlanBinding(snapshot.nodes, 'sub/plan').project, 'outside');
  assert.equal(resolvePlanBinding(snapshot.nodes, 'plan').project, 'inside');
  assert.equal(resolvePlanBinding(snapshot.nodes, 'plan').managerId, 'sub/asset');
  const ui = rebaseDraft(snapshot, snapshot, { prompt: snapshot.nodes });
  assert.equal(resolvePlanBinding(ui.draft.prompt, 'sub/plan').project, 'outside');
  wrapper.mode = 2;
  const muted = adapter.snapshot();
  assert.equal(resolvePlanBinding(muted.nodes, 'sub/plan').status, 'unresolved');
  assert.equal(resolvePlanBinding(muted.nodes, 'plan').status, 'unresolved');
  await assert.rejects(adapter.command({ action: 'queue', binding: snapshot.binding, revision: snapshot.revision, plan: 'plan' }), /changed/);
  wrapper.mode = 0;
  root._nodes.push({ ...wrapper, id: 'another-instance' });
  const shared = adapter.snapshot();
  assert.equal(shared.nodes['sub/plan'].scopeActive, false);
  assert.deepEqual(shared.nodes['sub/plan'].editable, []);
});
