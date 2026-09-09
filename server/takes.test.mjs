import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { finalCutDocument, checkpointStamp } from '../public/integrations/takes-core.mjs';
import * as core from '../e2e/fixtures/h3-native/h3_checkpoint_manager_core.mjs';

function fixture(options = {}) {
  const base = { scene: 1, scene_id: 'opening', revision: 'a'.repeat(32), ready: true, active: true, raw_frames: 124, steps: 12, seed: '18446744073709551615', prompt: 'Base' };
  const alternate = { ...base, revision: 'b'.repeat(32), active: false, take_kind: 'editorial_alternate', alternate_of_revision: base.revision };
  const archived = { ...base, revision: 'd'.repeat(32), active: false, prompt: 'Archived' };
  const next = { ...base, scene: 2, scene_id: 'next', revision: 'c'.repeat(32), parent: { scene: 1, revision: base.revision } };
  const data = { run_name: 'film', checkpoints: [base, next], revisions: [base, alternate, archived, next], scenes: [{ scene: 1 }, { scene: 2 }], editorial: { revision: 'e'.repeat(32), chapters: [], replacements: [], subtitles: { mode: 'preview_srt' }, trims: [{ scene: 1, scene_id: 'opening', out_frame: 48 }] } };
  const graph = { id: 'graph', links: {}, _nodes: [] };
  const plan = { id: '1', type: 'MiniMaxH3ChainPlan', graph, widgets: [{ name: 'run_name', value: 'film' }, { name: 'plan_json', value: '{"shots":[{"id":"opening","prompt":"Original"},{"id":"next"}]}' }], inputs: [] };
  const manager = { id: '2', type: 'MiniMaxH3ProjectAssetManager', graph, widgets: [{ name: 'run_name', value: 'film' }, { name: 'ownership_json', value: 'private-proof' }], inputs: [] }; graph._nodes = [plan, manager];
  const app = { graph, extensionManager: { workflow: { activeWorkflow: { path: 'film.json' } } } }, writes = [];
  const api = { async fetchApi(path, request) {
    if (path === '/queue') return Response.json({ queue_running: [], queue_pending: [] });
    if (!request) return Response.json(data);
    writes.push({ path, request });
    return path.endsWith('/editorial') ? Response.json({ editorial: JSON.parse(request.body) }) : Response.json({ run_name: 'film', restored: [archived] });
  } };
  const adapter = createAdapter(app, api, { finalCut: true, checkpoints: { ...core, restorePlan: (value, revisions) => { const document = JSON.parse(value); for (const item of revisions) document.shots[item.scene - 1].prompt = item.prompt; return JSON.stringify(document); } }, ownershipOptions: async (_node, _project, request) => ({ ...request, headers: { ...request.headers, 'X-H3-Workflow-Owner': 'native' } }), ...options });
  const snapshot = adapter.snapshot();
  const command = (action, extra = {}) => ({ binding: snapshot.binding, revision: snapshot.revision, action, project: 'film', node: '2', plan: '1', scene: 1, scene_id: 'opening', take_revision: archived.revision, ...extra });
  return { app, api, adapter, data, writes, command, plan, manager, base, alternate, archived };
}
test('final-cut saves preserve unrelated editorial fields and carry the exact revision precondition and native proof', async () => {
  const f = fixture();
  await f.adapter.command(f.command('take-final-cut', { take_revision: f.alternate.revision, base_revision: f.base.revision, editorial_revision: f.data.editorial.revision }));
  assert.equal(f.writes.length, 1);
  const request = f.writes[0].request, body = JSON.parse(request.body);
  assert.equal(request.headers['X-H3-Workflow-Owner'], 'native');
  assert.equal(body.base_revision, f.data.editorial.revision); assert.deepEqual(body.trims, f.data.editorial.trims); assert.deepEqual(body.subtitles, f.data.editorial.subtitles);
  assert.equal(body.replacements[0].alternate_revision, f.alternate.revision);
  assert.throws(() => finalCutDocument(f.data, f.command('take-final-cut', { take_revision: f.alternate.revision, base_revision: 'old', editorial_revision: f.data.editorial.revision })), /active checkpoint changed/);
  f.alternate.alternate_of_revision = 'old'; assert.throws(() => finalCutDocument(f.data, f.command('take-final-cut', { take_revision: f.alternate.revision, base_revision: f.base.revision, editorial_revision: f.data.editorial.revision })), /does not belong/);
});
test('checkpoint preview is read-only, validates the chapter, and issues a single-use restoration ticket', async () => {
  const f = fixture(), preview = await f.adapter.command(f.command('checkpoint-preview'));
  assert.equal(f.writes.length, 0); assert.equal(preview.data.retired[0].scene, 2);
  const result = await f.adapter.command(f.command('checkpoint-activate', { ticket: preview.data.ticket }));
  assert.equal(JSON.parse(f.writes[0].request.body).scope_end_scene, 2);
  assert.equal(JSON.parse(f.plan.widgets[1].value).shots[0].prompt, 'Archived'); assert.ok(result.snapshot);
  await assert.rejects(f.adapter.command(f.command('checkpoint-activate', { ticket: preview.data.ticket })), /Preview.*again/);
  assert.equal(f.writes.length, 1);
});
test('changed graph evidence, busy queues, and wrong Plan/carousel connections prevent restoration', async () => {
  const f = fixture(), preview = await f.adapter.command(f.command('checkpoint-preview'));
  const before = await checkpointStamp(f.data); f.data.revisions[0].ready = false;
  assert.notEqual(await checkpointStamp(f.data), before);
  await assert.rejects(f.adapter.command(f.command('checkpoint-activate', { ticket: preview.data.ticket })), /graph or saved cut changed/);
  const g = fixture(), fetch = g.api.fetchApi;
  g.api.fetchApi = (path, request) => path === '/queue' ? Promise.resolve(Response.json({ queue_running: [[1]], queue_pending: [] })) : fetch(path, request);
  await assert.rejects(g.adapter.command(g.command('checkpoint-preview')), /queue to finish/);
  const h = fixture(); h.plan.inputs.push({ name: 'project_assets', link: 7 }); h.app.graph.links[7] = { origin_id: 'other-manager', origin_slot: 0 };
  const snapshot = h.adapter.snapshot();
  await assert.rejects(h.adapter.command(h.command('checkpoint-preview', { revision: snapshot.revision })), /different asset carousel/);
  assert.equal(f.writes.length + g.writes.length + h.writes.length, 0);
});
test('ownership checks revalidate the tab before sending a write', async () => {
  let f;
  f = fixture({ ownershipOptions: async (_node, _project, request) => { f.app.extensionManager.workflow.activeWorkflow.path = 'other.json'; return request; } });
  const preview = await f.adapter.command(f.command('checkpoint-preview'));
  await assert.rejects(f.adapter.command(f.command('checkpoint-activate', { ticket: preview.data.ticket })), /workflow changed/);
  assert.equal(f.writes.length, 0);
});
test('supports a standalone Plan Studio but refuses to mutate a connected Studio mirror', async () => {
  const f = fixture(); f.plan.type = 'MiniMaxH3ChainPlanStudio';
  let snapshot = f.adapter.snapshot();
  const preview = await f.adapter.command(f.command('checkpoint-preview', { revision: snapshot.revision }));
  assert.ok(preview.data.ticket);
  f.plan.inputs.push({ name: 'plan', link: 9 }); f.app.graph.links[9] = { origin_id: 'upstream', origin_slot: 0 };
  snapshot = f.adapter.snapshot();
  await assert.rejects(f.adapter.command(f.command('checkpoint-preview', { revision: snapshot.revision })), /upstream Plan/);
  assert.equal(f.writes.length, 0);
});
test('a late restoration response never overwrites a newer Plan edit or another project', async () => {
  for (const changeProject of [false, true]) {
    const f = fixture(), preview = await f.adapter.command(f.command('checkpoint-preview')), fetch = f.api.fetchApi;
    f.api.fetchApi = async (path, request) => {
      if (request?.method === 'POST') { if (changeProject) f.manager.widgets[0].value = 'other-film'; else f.plan.widgets[1].value = '{"shots":[{"prompt":"Newer edit"}]}'; }
      return fetch(path, request);
    };
    const result = await f.adapter.command(f.command('checkpoint-activate', { ticket: preview.data.ticket }));
    assert.ok(result.warning); assert.equal(f.writes.length, 1);
    assert.equal(JSON.parse(f.plan.widgets[1].value).shots[0].prompt, changeProject ? 'Original' : 'Newer edit');
  }
});

test('named branch checkpoint reads, final-cut saves and restoration stay scoped to that branch', async () => {
  const branch = '1'.repeat(32), f = fixture({ workingBranches: true });
  f.plan.widgets[1].value = JSON.stringify({ ...JSON.parse(f.plan.widgets[1].value), _branch_id: branch });
  f.data.working_branch_id = branch;
  const paths = [], original = f.api.fetchApi;
  f.api.fetchApi = (path, options) => { paths.push(path); return original(path, options); };
  const command = (action, options = {}) => f.command(action, { revision: f.adapter.snapshot().revision, branch_id: branch, ...options });
  await f.adapter.command(command('take-final-cut', { take_revision: f.alternate.revision, base_revision: f.base.revision, editorial_revision: f.data.editorial.revision }));
  const preview = await f.adapter.command(command('checkpoint-preview'));
  await f.adapter.command(command('checkpoint-activate', { ticket: preview.data.ticket }));
  assert.ok(paths.filter(path => path !== '/queue').every(path => new URL(path, 'http://test').searchParams.get('branch_id') === branch));
  assert.equal(JSON.parse(f.plan.widgets[1].value)._branch_id, branch);
});
test('a server ignoring branch routing cannot authorize a final-cut write', async () => {
  const branch = '1'.repeat(32), f = fixture({ workingBranches: true });
  f.plan.widgets[1].value = JSON.stringify({ ...JSON.parse(f.plan.widgets[1].value), _branch_id: branch });
  await assert.rejects(f.adapter.command(f.command('take-final-cut', { revision: f.adapter.snapshot().revision, branch_id: branch })), /different working branch/);
  assert.equal(f.writes.length, 0);
});
test('branch switches invalidate pending checkpoint confirmations even with identical saved scenes', async () => {
  const f = fixture({ workingBranches: true }), preview = await f.adapter.command(f.command('checkpoint-preview'));
  f.plan.widgets[1].value = JSON.stringify({ ...JSON.parse(f.plan.widgets[1].value), _branch_id: '1'.repeat(32) });
  await assert.rejects(f.adapter.command(f.command('checkpoint-activate', { ticket: preview.data.ticket })), /workflow changed/);
  assert.equal(f.writes.length, 0);
});
