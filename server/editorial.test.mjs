import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { createCommandSession } from '../public/integrations/command-session.mjs';
import * as native from '../e2e/fixtures/h3-native/h3_editorial_commands.mjs';

function fixture() {
  const graph = { id: 'cut', _nodes: [], links: {}, serialize() { return { id: this.id }; } };
  const plan = { id: 'p', type: 'MiniMaxH3ChainPlan', graph, inputs: [], widgets: [{ name: 'run_name', value: 'film' }, { name: 'plan_json', value: '{"shots":[{"id":"one","seed":"18446744073709551615"}]}' }] };
  const manager = { id: 'assets', type: 'MiniMaxH3ProjectAssetManager', graph, inputs: [], widgets: [{ name: 'run_name', value: 'film' }] };
  graph._nodes.push(plan, manager);
  const app = { graph, canvas: { graph } }, writes = [], requests = [];
  const api = { async fetchApi(path, request) {
    if (path === '/queue') return Response.json({ queue_running: [], queue_pending: [] });
    const body = JSON.parse(request.body); requests.push(body);
    const data = { version: 1, run_name: body.run_name, branch_id: body.branch_id };
    if (body.action === 'inspect') return Response.json({ ...data, stamp: 's', scenes: [] });
    if (body.action === 'preview') return Response.json({ ...data, preview_token: 'reviewed', timeline: { stale_scenes: [] }, patch: body.patch });
    writes.push({ path, request, body }); return Response.json({ ...data, editorial: { revision: 'saved' } });
  } };
  const options = { editorial: native, ownershipOptions: async (_node, _project, request) => ({ ...request, headers: { ...request.headers, 'X-H3-Workflow-Owner': 'native-proof' } }) };
  const adapter = createAdapter(app, api, options);
  const command = (action, extra = {}) => { const snapshot = adapter.snapshot(); return { binding: snapshot.binding, revision: snapshot.revision, action, node: 'assets', plan: 'p', project: 'film', branch_id: 'main', ...extra }; };
  const preview = () => adapter.command(command('editorial-preview', { stamp: 's', patch: { scene: { scene: 1, scene_id: 'one', revision: 'a'.repeat(32), out_frame: 27 } } }));
  return { app, graph, plan, api, adapter, options, command, preview, writes, requests };
}

test('inspection and preview are read-only commands; apply preserves the exact reviewed patch and native proof', async () => {
  const f = fixture(), session = createCommandSession(f.adapter), before = JSON.stringify(f.plan.widgets);
  await session.execute('inspect', f.command('editorial-inspect'));
  assert.deepEqual(session.recent(), []);
  const preview = await f.preview(); assert.equal(f.writes.length, 0);
  await f.adapter.command(f.command('editorial-apply', { ticket: preview.data.ticket, patch: { subtitles: { mode: 'off' } } }));
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].request.headers['X-H3-Workflow-Owner'], 'native-proof');
  assert.equal(f.writes[0].body.patch.scene.out_frame, 27);
  assert.equal(f.writes[0].body.preview_token, 'reviewed');
  assert.equal(JSON.stringify(f.plan.widgets), before);
  await assert.rejects(f.adapter.command(f.command('editorial-apply', { ticket: preview.data.ticket })), /Review/);
  assert.equal(f.writes.length, 1);
});

test('a native tab switch during ownership checking cannot redirect the reviewed edit', async () => {
  const f = fixture();
  const adapter = createAdapter(f.app, f.api, { ...f.options, ownershipOptions: async (_node, _project, options) => { f.app.graph = { id: 'other', _nodes: [], links: {} }; return options; } });
  const before = adapter.snapshot();
  const cmd = action => ({ ...f.command(action), binding: before.binding, revision: before.revision });
  const preview = await adapter.command({ ...cmd('editorial-preview'), stamp: 's', patch: { subtitles: { mode: 'off' } } });
  await assert.rejects(adapter.command({ ...cmd('editorial-apply'), ticket: preview.data.ticket }), /workflow|tab/i);
  assert.equal(f.writes.length, 0);
});

test('uncertain saved-cut responses retain their receipt and cannot replay the consumed preview', async () => {
  const f = fixture(), preview = await f.preview(), fetch = f.api.fetchApi, session = createCommandSession(f.adapter);
  f.api.fetchApi = async (...args) => { const result = await fetch(...args); if (JSON.parse(args[1]?.body || '{}').action === 'apply') throw new Error('Result lost after write'); return result; };
  const apply = f.command('editorial-apply', { ticket: preview.data.ticket });
  const response = await session.execute('edit', apply); assert.equal(response.outcome, 'uncertain');
  await session.execute('edit', apply);
  await session.execute('check', { action: 'command-status', request_id: 'edit' });
  await assert.rejects(f.adapter.command(apply), /Review/);
  assert.equal(f.writes.length, 1);
});

test('unknown backend identities are rejected before a preview can be saved', async () => {
  const f = fixture();
  f.api.fetchApi = async () => Response.json({ version: 1, run_name: 'another film', branch_id: 'main' });
  await assert.rejects(f.adapter.command(f.command('editorial-inspect')), /another saved sequence/);
  assert.equal(f.writes.length, 0);
});

test('a busy native queue prevents timing preview and any write', async () => {
  const f = fixture(), fetch = f.api.fetchApi;
  f.api.fetchApi = async (path, options) => path === '/queue' ? Response.json({ queue_running: [[1, 'render']], queue_pending: [] }) : fetch(path, options);
  await assert.rejects(f.preview(), /queue to finish/);
  assert.equal(f.requests.length, 0); assert.equal(f.writes.length, 0);
});
