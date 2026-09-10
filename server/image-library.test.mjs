import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { assetLibraryFixture } from '../e2e/asset-library-backend.mjs';
import * as sizing from '../e2e/fixtures/h3-native/h3_project_asset_editor_core.mjs';

function fixture() {
  const backend = assetLibraryFixture(), posts = [];
  const graph = { id: 'images', _nodes: [{ id: 'm', type: 'MiniMaxH3ProjectAssetManager', inputs: [], widgets: [{ name: 'run_name', value: 'sceneweaver_first_film' }, { name: 'catalog_json', value: '{}' }] }] };
  const app = { graph, canvas: { graph } }, api = { async fetchApi(path, options) { if (options?.method === 'POST') posts.push(options); return backend.handle(path, options); } };
  const options = { imageSizing: sizing, ownershipOptions: async (_node, _project, request) => ({ ...request, headers: { ...request.headers, 'X-Test-Owner': 'native' } }) };
  const adapter = createAdapter(app, api, options);
  const command = (action, fields = {}, selected = adapter) => { const snapshot = selected.snapshot(); return { action, binding: snapshot.binding, revision: snapshot.revision, node: 'm', project: 'sceneweaver_first_film', ...fields }; };
  const edit = { crop: { x: 20, y: 10, width: 100, height: 100 }, target: { width: 64, height: 64 }, resample: 'nearest', tag: 'new_picture', folder_id: 'cast' };
  const review = async () => (await adapter.command(command('asset-image-inspect', { asset_id: 'hero', edit }))).data;
  const mutate = async () => { const value = await review(); return adapter.command(command('asset-library-mutate', { library_action: 'asset_derive', asset_id: 'hero', base_revision: value.base_revision, preview_revision: value.preview_revision, ...edit })); };
  return { app, api, options, backend, posts, adapter, command, edit, review, mutate };
}
test('image reads and native megapixel/aspect/snapping calculations never write a catalog', async () => {
  const f = fixture(); assert.equal(f.adapter.snapshot().capabilities.assetImageVersion, 1);
  const value = await f.adapter.command(f.command('asset-image-inspect', { asset_id: 'hero' })); assert.deepEqual(value.data.source, { width: 240, height: 160 });
  const output = await f.adapter.command(f.command('asset-image-dimensions', { size: { mode: 'megapixels', megapixels: 1, ratio: 4032 / 3024, multiple: 8 } }));
  assert.equal(output.data.width % 8, 0); assert.equal(output.data.height % 8, 0); assert.ok(Math.abs(output.data.width * output.data.height / 1e6 - 1) < .02);
  const unlocked = await f.adapter.command(f.command('asset-image-dimensions', { size: { mode: 'dimensions', width: 101, height: 71, ratio: 1.5, locked: false, changed: 'height', multiple: 16 } }));
  assert.deepEqual(unlocked.data, { width: 96, height: 64 }); assert.equal(f.posts.length, 0);
  await assert.rejects(f.adapter.command(f.command('asset-image-dimensions', { size: { mode: 'megapixels', ratio: 1, multiple: 8 } })), /positive/);
  await assert.rejects(f.adapter.command(f.command('asset-image-inspect', { project: 'other', asset_id: 'hero' })), /project/);
});
test('reviewed variants publish the native catalog and preserve parent, folder and transform', async () => {
  const f = fixture(), result = await f.mutate(), asset = result.data.catalog.assets.at(-1);
  assert.equal(asset.parent_asset_id, 'hero'); assert.equal(asset.folder_id, 'cast'); assert.deepEqual(asset.transform.crop, f.edit.crop); assert.deepEqual(asset.transform.target, f.edit.target);
  assert.equal(f.posts[0].headers['X-Test-Owner'], 'native'); assert.equal(JSON.parse(f.app.graph._nodes[0].widgets[1].value).assets.at(-1).id, asset.id);
});
test('stale image review and out-of-bounds crops never create a variant', async () => {
  const f = fixture(), review = await f.review(); f.backend.configure({ rename: 'Native folder change' });
  await assert.rejects(f.adapter.command(f.command('asset-library-mutate', { library_action: 'asset_derive', asset_id: 'hero', base_revision: review.base_revision, preview_revision: review.preview_revision, ...f.edit })), /changed/);
  await assert.rejects(f.adapter.command(f.command('asset-image-inspect', { asset_id: 'hero', edit: { ...f.edit, crop: { ...f.edit.crop, x: 300 } } })), /bounds/); assert.equal(f.posts.length, 0);
});
test('lost image acknowledgements and reopened-parent recovery reuse the saved operation', async () => {
  const f = fixture(); f.backend.configure({ failure: 'after' }); await assert.rejects(f.mutate());
  assert.equal((await f.adapter.command(f.command('asset-library-inspect'))).data.pending, null); assert.equal(f.backend.actions().length, 1);
  f.backend.configure({ failure: 'prepared' }); await assert.rejects(f.mutate());
  const operation = (await f.adapter.command(f.command('asset-library-inspect'))).data.pending.operation_id;
  const reopened = createAdapter(f.app, f.api, f.options);
  const result = await reopened.command(f.command('asset-library-mutate', { retry: true, resume_operation: true, operation_id: operation, tag: 'Changed after reopening' }, reopened));
  assert.equal(result.data.catalog.library_pending_operations.length, 0); assert.equal(f.backend.actions().length, 2); assert.equal(f.backend.actions()[1].tag, 'new_picture');
});
test('missing native sizing and legacy server support disable image commands independently', async () => {
  const f = fixture(), old = createAdapter(f.app, f.api, { ...f.options, imageSizing: undefined }); assert.equal(old.snapshot().capabilities.assetImageVersion, 0);
  await assert.rejects(old.command(f.command('asset-image-dimensions', { size: {} }, old)), /unavailable/);
  f.backend.configure({ legacy: true }); await assert.rejects(f.mutate(), /Update H3/); assert.equal(f.posts.length, 0);
});
