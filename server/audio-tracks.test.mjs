import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import * as audioTracks from '../e2e/fixtures/h3-native/h3_project_asset_editor_core.mjs';

test('audio bindings validate current options, distinct enabled assets and native ownership before writing', async () => {
  const graph = { id: 'graph', _nodes: [] }, writes = [];
  graph._nodes.push({ id: 1, type: 'MiniMaxH3ProjectAssetManager', widgets: [{ name: 'run_name', value: 'film' }], graph });
  const asset = { id: 'mix', role: 'source_track', kind: 'audio', enabled: true, options: { timeline_mode: 'source_timeline' } };
  const catalog = { project: 'film', assets: [asset, { id: 'vocal', kind: 'audio', enabled: true }, { id: 'disabled', kind: 'audio', enabled: false }] };
  const adapter = createAdapter({ graph }, { async fetchApi(path, options) { if (options) { writes.push({ path, options }); return Response.json({ ok: true }); } return Response.json(catalog); } }, { audioTracks, ownershipOptions: async (_node, _project, options) => ({ ...options, headers: { ...options.headers, 'X-Native-Owner': 'verified' } }) });
  const base = adapter.snapshot();
  const command = tracks => ({ action: 'asset-audio-tracks', binding: base.binding, revision: base.revision, node: '1', project: 'film', asset_id: 'mix', before_options: { timeline_mode: 'source_timeline' }, tracks });
  await adapter.command(command({ full_mix: 'mix', vocals: 'vocal', instrumental: '' }));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.headers['X-Native-Owner'], 'verified');
  assert.deepEqual(JSON.parse(writes[0].options.body).changes, { options: { audio_tracks: { full_mix: 'mix', vocals: 'vocal', instrumental: '' } } });
  for (const tracks of [{}, { vocals: 'missing' }, { vocals: 'disabled' }, { full_mix: 'mix', vocals: 'mix' }]) await assert.rejects(adapter.command(command(tracks)), /distinct, enabled/);
  asset.options.timeline_mode = 'standalone';
  await assert.rejects(adapter.command(command({ vocals: 'vocal' })), /source track changed/);
  assert.equal(writes.length, 1);
});
