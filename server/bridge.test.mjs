import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { diffInputs, rebaseDraft } from '../public/integrations/bridge-core.mjs';
function fixture(options = {}) {
  const calls = [], graph = { id: 'stable-uuid', _nodes: [], links: {}, beforeChange() { calls.push('before'); }, afterChange() { calls.push('after'); }, change() { calls.push('change'); }, serialize() { return { id: this.id, nodes: this._nodes.map(n => ({ id: n.id, widgets_values: n.widgets.map(w => w.value) })) }; } };
  const node = { id: 1, type: 'MiniMaxH3ChainPlan', graph, widgets: [{ name: 'plan_json', value: 'original', callback(value) { calls.push(value); } }, { name: 'seed', value: '18446744073709551615' }, { name: 'ownership_json', value: 'private-proof' }, { name: 'api_key', value: 'private-key' }], inputs: [] };
  graph._nodes.push(node);
  const app = { graph, canvas: { graph }, extensionManager: { workflow: { activeWorkflow: { path: 'workflows/Live.json', filename: 'Live.json' } } }, async queuePrompt(...args) { calls.push(args); return true; } };
  const api = { async fetchApi(path, opts) { calls.push({ path, opts }); return Response.json({ project: 'film', assets: [{ id: 'asset', tag: 'hero', role: 'picture', enabled: true }] }); } };
  const adapter = createAdapter(app, api, options), base = adapter.snapshot();
  const edit = (widget, after) => ({ node: '1', widget, before: base.nodes['1'].inputs[widget], after });
  const command = (action, more = {}) => ({ action, binding: base.binding, revision: base.revision, ...more });
  return { app, api, graph, node, calls, adapter, base, edit, command };
}
test('live snapshots exclude credentials, preserve large seeds and ignore canvas layout', () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.base.nodes['1'].inputs), ['plan_json', 'seed']);
  assert.equal(f.base.nodes['1'].inputs.seed, '18446744073709551615');
  f.node.pos = [44, 100]; assert.equal(f.adapter.snapshot().revision, f.base.revision);
});
test('patches native named widgets with callbacks and rejects stale revisions before any write', async () => {
  const f = fixture();
  const result = await f.adapter.command(f.command('patch', { edits: [f.edit('plan_json', 'draft')] }));
  assert.equal(f.node.widgets[0].value, 'draft'); assert.deepEqual(f.calls, ['before', 'draft', 'change', 'after']);
  assert.ok(result.snapshot.revision > f.base.revision);
  await assert.rejects(f.adapter.command(f.command('patch', { edits: [f.edit('seed', '2')] })), /changed since/);
  assert.equal(f.node.widgets[1].value, '18446744073709551615');
});
test('tab switching blocks patch, queue, and export even if the same graph object is reused', async () => {
  const f = fixture(); f.app.extensionManager.workflow.activeWorkflow.path = 'workflows/Different.json';
  for (const action of ['patch', 'queue', 'export']) await assert.rejects(f.adapter.command(f.command(action, { edits: [f.edit('plan_json', 'wrong')] })), /changed/);
  assert.equal(f.node.widgets[0].value, 'original'); assert.deepEqual(f.calls, []);
});
test('validates every patch field before writing, including linked and protected widgets', async () => {
  const f = fixture();
  for (const edits of [[f.edit('plan_json', 'new'), f.edit('ownership_json', 'x')], [f.edit('plan_json', 'a'), f.edit('plan_json', 'b')], [f.edit('seed', Infinity)]]) {
    await assert.rejects(f.adapter.command(f.command('patch', { edits })));
    assert.equal(f.node.widgets[0].value, 'original');
  }
  f.node.inputs = [{ name: 'plan_json', link: 5 }]; f.graph.links[5] = { origin_id: 9, origin_slot: 0 };
  const snap = f.adapter.snapshot();
  assert.deepEqual(snap.nodes['1'].inputs.plan_json, ['9', 0]); assert.ok(!snap.nodes['1'].editable.includes('plan_json'));
});
test('draft reconciliation preserves disjoint edits and reports shared-widget conflicts without overwriting', () => {
  const f = fixture(), draft = { prompt: { '1': { class_type: 'MiniMaxH3ChainPlan', inputs: { ...f.base.nodes['1'].inputs, plan_json: 'local' } } } };
  f.node.widgets[1].value = '4';
  const merged = rebaseDraft(f.base, f.adapter.snapshot(), draft);
  assert.deepEqual(merged.conflicts, []); assert.equal(merged.draft.prompt['1'].inputs.seed, '4'); assert.equal(merged.draft.prompt['1'].inputs.plan_json, 'local');
  assert.equal(diffInputs(f.base, draft).length, 1);
  f.node.widgets[0].value = 'remote'; const conflicting = rebaseDraft(f.base, f.adapter.snapshot(), draft);
  assert.deepEqual(conflicting.conflicts, ['1.plan_json']); assert.equal(conflicting.draft, draft);
});
test('native queue hooks and native canvas export remain authoritative', async () => {
  const f = fixture(); await f.adapter.command(f.command('queue')); assert.deepEqual(f.calls, [[0, 1]]);
  assert.equal((await f.adapter.command(f.command('export'))).workflow.id, 'stable-uuid');
  f.app.queuePrompt = async () => false; await assert.rejects(f.adapter.command(f.command('queue')), /rejected/);
});
function manager(f, protectedProject = true) {
  f.node.type = 'MiniMaxH3ProjectAssetManager';
  f.node.widgets = [{ name: 'run_name', value: 'film' }, { name: 'catalog_json', value: '{}' }, ...(protectedProject ? [{ name: 'ownership_json', value: 'proof' }] : [])];
  const base = f.adapter.snapshot();
  return { action: 'asset-update', binding: base.binding, revision: base.revision, node: '1', project: 'film', asset_id: 'asset', before: { tag: 'hero' }, changes: { tag: 'lead' } };
}
test('asset edits require native ownership support and reject a stale asset baseline', async () => {
  const f = fixture(), cmd = manager(f);
  await assert.rejects(f.adapter.command(cmd), /native ownership adapter/);
  assert.equal(f.calls.filter(v => v.opts?.method === 'POST').length, 0);
  await assert.rejects(f.adapter.command({ ...cmd, before: { tag: 'old' } }), /asset changed/);
  await assert.rejects(f.adapter.command({ ...cmd, before: {} }), /original value/);
});
test('asset writes use native ownership headers and never synchronize a result into a switched project', async () => {
  const f = fixture({ ownershipOptions: async (_node, _run, options) => ({ ...options, headers: { ...options.headers, 'X-H3-Workflow-Owner': 'native-owner' } }) }), cmd = manager(f);
  const original = f.api.fetchApi;
  f.api.fetchApi = async (path, options) => {
    if (!options) return original(path);
    assert.equal(options.headers['X-H3-Workflow-Owner'], 'native-owner');
    f.node.widgets[0].value = 'other-film';
    return Response.json({ catalog: { project: 'film', assets: [] } });
  };
  const result = await f.adapter.command(cmd);
  assert.match(result.warning, /project changed/); assert.equal(f.node.widgets[1].value, '{}');
});
test('a tab change during asynchronous ownership validation prevents the server write', async () => {
  let f;
  f = fixture({ ownershipOptions: async (_node, _run, options) => { f.app.extensionManager.workflow.activeWorkflow.path = 'different'; return options; } });
  await assert.rejects(f.adapter.command(manager(f)), /changed/);
  assert.equal(f.calls.filter(v => v.opts?.method === 'POST').length, 0);
});

test('drafts cannot silently move branches or edit their identity through Plan JSON', async () => {
  const f = fixture(), next = structuredClone(f.base);
  next.nodes['1'].inputs.working_branch_id = '1'.repeat(32);
  const draft = { prompt: { '1': { class_type: 'MiniMaxH3ChainPlan', inputs: { ...f.base.nodes['1'].inputs, seed: '5' } } } };
  assert.match(rebaseDraft(f.base, next, draft).conflicts[0], /Working branch changed/);
  assert.equal(rebaseDraft(f.base, next, { prompt: { '1': f.base.nodes['1'] } }).conflicts.length, 0);
  await assert.rejects(f.adapter.command(f.command('patch', { edits: [f.edit('plan_json', '{"shots":[],"_branch_id":"11111111111111111111111111111111"}')] })), /Switch working branches in Plan Studio/);
});
