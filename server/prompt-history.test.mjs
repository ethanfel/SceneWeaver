import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../e2e/fixtures/h3-native/h3_chain_plan_core.mjs';
import * as native from '../e2e/fixtures/h3-native/h3_prompt_history_core.mjs';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { createCommandSession } from '../public/integrations/command-session.mjs';
import { promptHistoryFixture } from '../e2e/prompt-history-backend.mjs';

function fixture(branch = 'main') {
  const backend = promptHistoryFixture(), calls = [];
  const graph = { id: 'history-workflow', _nodes: [], links: { 1: { origin_id: 'text', origin_slot: 0 } } };
  const source = { id: 'text', type: 'PrimitiveStringMultiline', graph, inputs: [], widgets: [{ name: 'value', value: JSON.stringify({ _branch_id: branch, shots: [{ id: 'scene', prompt: 'Current prompt', seed: '18446744073709551615' }] }) }] };
  const plan = { id: 'p', type: 'MiniMaxH3ChainPlan', graph, widgets: [{ name: 'run_name', value: 'film' }, { name: 'plan_json', value: '{"shots":["fallback"]}' }], inputs: [{ name: 'plan_json_input', link: 1 }] };
  const manager = { id: 'm', type: 'MiniMaxH3ProjectAssetManager', graph, inputs: [], widgets: [{ name: 'run_name', value: 'film' }] };
  graph._nodes.push(plan, source, manager);
  const app = { graph, canvas: { graph } };
  const api = { async fetchApi(path, options) { calls.push({ path, options }); return backend.handle(path, options); } };
  const options = { planAuthoring: core, promptHistory: native, workingBranches: true, ownershipOptions: async (_manager, _project, request) => ({ ...request, headers: { ...request.headers, 'X-H3-Workflow-Owner': 'native-proof' } }) };
  const adapter = createAdapter(app, api, options);
  const command = (action, extra = {}) => { const snapshot = adapter.snapshot(); return { action, binding: snapshot.binding, revision: snapshot.revision, node: 'm', plan: 'p', project: 'film', branch_id: branch, scene: 1, scene_id: 'scene', ...extra }; };
  const read = () => adapter.command(command('prompt-history-list'));
  const save = async extra => { const state = await read(); return adapter.command(command('prompt-history-mutate', { history_action: 'save', prompt: 'Saved from editor', base_revision: state.data.history.history_revision, ...extra })); };
  return { backend, calls, graph, app, source, options, api, adapter, command, read, save };
}
test('history reads follow the connected Plan scene and native tree without changing graph or receipts', async () => {
  const f = fixture(), before = f.source.widgets[0].value, session = createCommandSession(f.adapter);
  const result = await session.execute('read', f.command('prompt-history-list'));
  assert.equal(result.result.data.tree.rows[1].depth, 1); assert.deepEqual(session.recent(), []);
  const preview = await f.adapter.command(f.command('prompt-history-revision', { revision_id: 'a'.repeat(32) }));
  assert.equal(preview.data.revision.prompt, 'Saved first prompt.\n\nKeep the rain.');
  assert.equal(f.source.widgets[0].value, before); assert.equal(f.backend.actions().length, 0);
  await assert.rejects(f.adapter.command(f.command('prompt-history-list', { scene_id: 'different' })), /no longer matches/);
  await assert.rejects(f.adapter.command(f.command('prompt-history-list', { node: 'other' })), /carousel/);
});
test('named branches never read Original history when a server ignores branch routing', async () => {
  const f = fixture('1'.repeat(32)); assert.equal((await f.read()).data.tree.rows.length, 0);
  assert.ok(f.calls[0].path.includes('branch_id='));
  f.backend.configure({ ignoreBranch: true }); await assert.rejects(f.read(), /different working branch/);
});
test('conditional saves preserve the Plan and use the native ownership proof and reviewed stamp', async () => {
  const f = fixture(), before = f.source.widgets[0].value;
  const result = await f.save(); assert.equal(result.data.history.revisions.length, 2);
  const post = f.calls.find(item => item.options?.method === 'POST');
  assert.equal(post.options.headers['X-H3-Workflow-Owner'], 'native-proof');
  assert.equal(JSON.parse(post.options.body).command_version, 1); assert.equal(f.source.widgets[0].value, before);
  await assert.rejects(f.adapter.command(f.command('prompt-history-mutate', { history_action: 'save', prompt: 'stale', base_revision: '0'.repeat(64) })), /changed/);
  assert.equal(f.backend.actions().length, 1);
});
test('lost acknowledgement resolves by reading the retained operation, without replaying the save', async () => {
  const f = fixture(); f.backend.configure({ failure: 'after' });
  await assert.rejects(f.save(), /lost acknowledgement/);
  assert.equal(f.backend.actions().length, 1);
  const check = await f.read(); assert.equal(check.data.pending, null); assert.match(check.data.message, /committed/);
  assert.equal(f.backend.actions().length, 1);
});
test('a dropped request can retry only its exact retained command and operation ID', async () => {
  const f = fixture(); f.backend.configure({ failure: 'before' }); await assert.rejects(f.save(), /dropped request/);
  const { pending } = (await f.read()).data; assert.equal(pending.action, 'save');
  const result = await f.adapter.command(f.command('prompt-history-mutate', { retry: true, operation_id: pending.operation_id, prompt: 'Must not replace retained text' }));
  assert.equal(result.data.pending, null); assert.equal(f.backend.actions()[0].prompt, 'Saved from editor');
  assert.equal(f.backend.actions()[0].operation_id, pending.operation_id);
});
test('native conflicts and ownership rejections do not leave a retryable mutation', async () => {
  for (const failure of ['conflict', 'ownership']) {
    const f = fixture(); f.backend.configure({ failure });
    await assert.rejects(f.save(), error => error.outcome === 'rejected');
    assert.equal((await f.read()).data.pending, null); assert.equal(f.backend.actions().length, 0);
  }
});
test('legacy history supports inspection but cannot authorize conditional writes', async () => {
  const f = fixture(); f.backend.configure({ legacy: true });
  assert.equal((await f.read()).data.writable, false); await assert.rejects(f.save(), /Update H3/);
  assert.equal(f.backend.actions().length, 0);
});
test('a tab switch during native ownership preparation cannot redirect history writes', async () => {
  const f = fixture();
  const adapter = createAdapter(f.app, f.api, { ...f.options, ownershipOptions: async () => { f.app.graph = { id: 'other', _nodes: [], links: {} }; return {}; } });
  const snapshot = adapter.snapshot(), command = { ...f.command('prompt-history-list'), binding: snapshot.binding, revision: snapshot.revision };
  const state = await adapter.command(command);
  await assert.rejects(adapter.command({ ...command, action: 'prompt-history-mutate', history_action: 'save', prompt: 'No redirect', base_revision: state.data.history.history_revision }), /workflow|tab/);
  assert.equal(f.backend.actions().length, 0);
});
