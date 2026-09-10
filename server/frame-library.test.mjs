import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { assetLibraryFixture } from '../e2e/asset-library-backend.mjs';

function fixture() {
  const backend = assetLibraryFixture(), posts = [];
  const graph = { id: 'frames', _nodes: [{ id: 'm', type: 'MiniMaxH3ProjectAssetManager', inputs: [], widgets: [{ name: 'run_name', value: 'sceneweaver_first_film' }, { name: 'catalog_json', value: '{}' }] }] };
  const app = { graph, canvas: { graph } }, api = { async fetchApi(path, options) { if (options?.method === 'POST') posts.push(options); return backend.handle(path, options); } };
  const options = { ownershipOptions: async (_node, _project, request) => ({ ...request, headers: { ...request.headers, 'X-Test-Owner': 'native' } }) };
  const adapter = createAdapter(app, api, options);
  const command = (action, fields = {}, selected = adapter) => { const snapshot = selected.snapshot(); return { action, binding: snapshot.binding, revision: snapshot.revision, node: 'm', project: 'sceneweaver_first_film', ...fields }; };
  const frame = { source: { scene: 2, revision: 'c'.repeat(32), branch_id: 'main', file: { filename: 'second.webm', subfolder: '', type: 'output' } }, time_seconds: 1.25, tag: 'still', folder_id: 'cast' };
  const review = async () => (await adapter.command(command('asset-frame-inspect', frame))).data;
  const capture = async () => { const value = await review(); return adapter.command(command('asset-library-mutate', { library_action: 'asset_capture', base_revision: value.base_revision, preview_revision: value.preview_revision, ...frame })); };
  return { app, api, options, backend, posts, adapter, command, frame, review, capture };
}
test('saved frame review is read-only and its owned publication preserves exact media/time', async () => {
  const f = fixture(); assert.equal(f.adapter.snapshot().capabilities.assetFrameVersion, 1);
  await f.review(); assert.equal(f.posts.length, 0);
  const result = await f.capture(), asset = result.data.catalog.assets.at(-1);
  assert.equal(asset.source_origin.scene, 2); assert.equal(asset.source_origin.time_seconds, 1.25);
  assert.deepEqual(asset.source_origin.file, f.frame.source.file);
  assert.equal(f.posts[0].headers['X-Test-Owner'], 'native');
  assert.equal(JSON.parse(f.app.graph._nodes[0].widgets[1].value).assets.at(-1).id, asset.id);
});
test('frame reviews cannot authorize another project, time, source, folder or stale catalog', async () => {
  const f = fixture(), review = await f.review();
  await assert.rejects(f.adapter.command(f.command('asset-frame-inspect', { ...f.frame, project: 'other' })), /project/);
  await assert.rejects(f.adapter.command(f.command('asset-frame-inspect', { ...f.frame, time_seconds: -1 })), /inside/);
  await assert.rejects(f.adapter.command(f.command('asset-library-mutate', { library_action: 'asset_capture', ...f.frame, time_seconds: 2, base_revision: review.base_revision, preview_revision: review.preview_revision })), /changed/);
  f.backend.configure({ rename: 'Changed folder' });
  await assert.rejects(f.adapter.command(f.command('asset-library-mutate', { library_action: 'asset_capture', ...f.frame, base_revision: review.base_revision, preview_revision: review.preview_revision })), /changed/);
  assert.equal(f.backend.actions().length, 0);
});
test('dropped acknowledgement and reopened parent recovery never capture a new frame', async () => {
  const f = fixture(); f.backend.configure({ failure: 'after' }); await assert.rejects(f.capture());
  assert.equal((await f.adapter.command(f.command('asset-library-inspect'))).data.pending, null);
  assert.equal(f.backend.actions().length, 1);
  f.backend.configure({ failure: 'prepared' }); await assert.rejects(f.capture());
  const operation = (await f.adapter.command(f.command('asset-library-inspect'))).data.pending.operation_id;
  const reopened = createAdapter(f.app, f.api, f.options);
  const result = await reopened.command(f.command('asset-library-mutate', { retry: true, resume_operation: true, operation_id: operation, time_seconds: 99 }, reopened));
  assert.equal(result.data.catalog.library_pending_operations.length, 0); assert.equal(f.backend.actions().length, 2);
  assert.equal(f.backend.actions()[1].time_seconds, 1.25);
});
test('old native API and ownership rejection block publication', async () => {
  const f = fixture(); f.backend.configure({ legacy: true }); await assert.rejects(f.capture(), /Update H3|conditional/); assert.equal(f.posts.length, 0);
  f.backend.configure({ failure: 'ownership' }); await assert.rejects(f.capture(), /read-only/);
  assert.equal((await f.adapter.command(f.command('asset-library-inspect'))).data.pending, null); assert.equal(f.backend.actions().length, 0);
});
