import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { createCommandSession } from '../public/integrations/command-session.mjs';
import { assetLibraryFixture } from '../e2e/asset-library-backend.mjs';

function fixture() {
  const backend = assetLibraryFixture(), posts = [];
  const graph = { id: 'library', _nodes: [{ id: 'm', type: 'MiniMaxH3ProjectAssetManager', inputs: [], widgets: [{ name: 'run_name', value: 'sceneweaver_first_film' }, { name: 'catalog_json', value: '{}' }] }] };
  const app = { graph, canvas: { graph } }, api = { async fetchApi(path, options) { if (options?.method === 'POST') posts.push({ path, options }); return backend.handle(path, options); } };
  const ownershipOptions = async (_node, _project, request) => ({ ...request, headers: { ...request.headers, 'X-Test-Native-Owner': 'proof' } });
  const adapter = createAdapter(app, api, { ownershipOptions });
  const command = (action, fields = {}) => { const snapshot = adapter.snapshot(); return { action, binding: snapshot.binding, revision: snapshot.revision, node: 'm', project: 'sceneweaver_first_film', ...fields }; };
  const inspect = () => adapter.command(command('asset-library-inspect'));
  const mutate = async fields => { const result = await inspect(); return adapter.command(command('asset-library-mutate', { base_revision: result.data.catalog.library_revision, ...fields })); };
  return { backend, posts, graph, app, api, adapter, ownershipOptions, command, inspect, mutate };
}
test('library reads use exact project scope and do not create native project state', async () => {
  const f = fixture(), value = await f.inspect(); assert.equal(value.data.catalog.folders.length, 2); assert.equal(f.posts.length, 0);
  await assert.rejects(f.adapter.command(f.command('asset-library-inspect', { project: 'other' })), /project/);
});
test('folder-only changes invalidate a reviewed library operation and never send it', async () => {
  const f = fixture(), read = await f.inspect(); f.backend.configure({ rename: 'New cast name' });
  await assert.rejects(f.adapter.command(f.command('asset-library-mutate', { library_action: 'asset_duplicate', asset_id: 'hero', base_revision: read.data.catalog.library_revision })), /changed/);
  assert.equal(f.posts.length, 0);
});
test('library changes use native ownership, publish the catalog, and retain project-shared scope', async () => {
  const f = fixture(); await f.mutate({ library_action: 'asset_update', asset_id: 'hero', changes: { folder_id: 'places' } });
  assert.equal(f.posts[0].options.headers['X-Test-Native-Owner'], 'proof'); assert.ok(!f.posts[0].path.includes('branch_id'));
  assert.equal(JSON.parse(f.graph._nodes[0].widgets[1].value).assets[0].folder_id, 'places');
});
test('unconfirmed duplication checks its durable receipt and never duplicates again', async () => {
  const f = fixture(); f.backend.configure({ failure: 'after' });
  await assert.rejects(f.mutate({ library_action: 'asset_duplicate', asset_id: 'hero' }), /Lost library/);
  const recovered = await f.inspect(); assert.equal(recovered.data.pending, null); assert.match(recovered.data.message, /committed/); assert.equal(f.backend.actions().length, 1);
});
test('retry preserves the exact retained library body while rejecting native conflicts and ownership denial', async () => {
  const f = fixture(); f.backend.configure({ failure: 'before' });
  await assert.rejects(f.mutate({ library_action: 'folder_create', name: 'Reviewed name' }), /Dropped library/);
  const pending = (await f.inspect()).data.pending;
  await f.adapter.command(f.command('asset-library-mutate', { retry: true, operation_id: pending.operation_id, name: 'Changed name' }));
  assert.equal(f.backend.actions()[0].name, 'Reviewed name');
  for (const failure of ['conflict', 'ownership']) {
    f.backend.configure({ failure }); await assert.rejects(f.mutate({ library_action: 'folder_create', name: 'Rejected' }), error => error.outcome === 'rejected');
    assert.equal((await f.inspect()).data.pending, null);
  }
});
test('legacy catalogs remain readable without enabling organizing and a tab switch cannot redirect a write', async () => {
  const f = fixture(); f.backend.configure({ legacy: true }); assert.equal((await f.inspect()).data.writable, false);
  await assert.rejects(f.mutate({ library_action: 'folder_create', name: 'No write' }), /Update H3/);
  f.backend.configure({});
  const adapter = createAdapter(f.app, f.api, { ownershipOptions: async () => { f.app.graph = { id: 'another', _nodes: [] }; return {}; } });
  const snapshot = adapter.snapshot(), command = { ...f.command('asset-library-inspect'), binding: snapshot.binding, revision: snapshot.revision }, state = await adapter.command(command);
  await assert.rejects(adapter.command({ ...command, action: 'asset-library-mutate', library_action: 'asset_duplicate', asset_id: 'hero', base_revision: state.data.catalog.library_revision }), /workflow|tab/);
  assert.equal(f.posts.length, 0);
});
test('read-only library polling does not take or release the active mutation lock', async () => {
  let finish; const waiting = new Promise(resolve => { finish = resolve; });
  const session = createCommandSession({ command: async command => { if (command.action === 'asset-library-mutate') await waiting; return { ok: true }; } });
  const mutation = session.execute('write', { action: 'asset-library-mutate' });
  assert.equal(session.processing, true);
  assert.ok((await session.execute('read', { action: 'asset-library-inspect' })).result);
  assert.equal(session.processing, true); assert.equal(session.recent().length, 1);
  assert.equal((await session.execute('second', { action: 'queue' })).outcome, 'rejected');
  finish(); await mutation; assert.equal(session.processing, false);
});
