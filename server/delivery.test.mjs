import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { createCommandSession } from '../public/integrations/command-session.mjs';
import * as native from '../e2e/fixtures/h3-native/h3_delivery_core.mjs';
import { checkpointLocalSelectionJson } from '../e2e/fixtures/h3-native/h3_checkpoint_selection_native.mjs';
import * as hooks from '../e2e/fixtures/h3-native/h3_chain_top_level_requeue_coordinator.mjs';
function fixture() {
  const graph = { id: 'delivery', _nodes: [], links: {}, serialize() { return { id: this.id, native: true }; } };
  const nodes = {
    p: { type: 'MiniMaxH3ChainPlan', widgets: [{ name: 'run_name', value: 'film' }, { name: 'plan_json', value: '{"shots":[{"id":"one"},{"id":"two"}]}' }] },
    assets: { type: 'MiniMaxH3ProjectAssetManager', widgets: [{ name: 'run_name', value: 'film' }] },
    assembly: { type: 'MiniMaxH3ChainAssemble', widgets: [{ name: 'filename', value: 'native_name' }, { name: 'audio_source', value: 'generated' }, { name: 'audio_bitrate', value: 256 }], inputs: [{ name: 'manifest', link: 1 }] },
    loop: { type: 'MiniMaxH3ChainLoopEnd', widgets: [] },
  };
  for (const [id, node] of Object.entries(nodes)) graph._nodes.push({ id, graph, inputs: [], ...node });
  graph.links[1] = { origin_id: 'loop', origin_slot: 0 };
  const posts = [];
  const payload = { run_name: 'film', editorial: { revision: 'e'.repeat(32) }, checkpoints: [], revisions: [
    { scene: 1, scene_id: 'one', revision: 'a'.repeat(32), ready: true, active: true },
    { scene: 2, scene_id: 'two', revision: 'b'.repeat(32), ready: true, active: true, parent: { scene: 1, revision: 'a'.repeat(32) } },
  ] };
  const app = { graph, canvas: { graph }, async graphToPrompt(current) { return { workflow: current.serialize(), output: Object.fromEntries(current._nodes.map(node => [node.id, { class_type: node.type, inputs: { ...Object.fromEntries(node.widgets.map(w => [w.name, w.value])), ...Object.fromEntries(node.inputs.map(input => { const link = current.links[input.link]; return [input.name, [link.origin_id, link.origin_slot]]; })) } }])) }; } };
  const api = { async fetchApi(path, options) {
    if (path === '/queue') return Response.json({ queue_running: [], queue_pending: [] });
    if (path.includes('/checkpoints?')) return Response.json(payload);
    if (path.endsWith('/delivery/prepare')) {
      const { selection, editorial_revision } = JSON.parse(options.body);
      return Response.json({ version: 1, snapshot_id: 'd'.repeat(64), snapshot_json: 'exact native snapshot with seed 18446744073709551615', summary: { run_name: 'film', branch_id: 'main', final_cut_branch_id: selection.final_cut_branch_id, editorial_revision } });
    }
    throw new Error(`Unexpected request ${path}`);
  }, async queuePrompt(...args) { posts.push(args); return { prompt_id: 'delivery-job' }; } };
  const adapter = createAdapter(app, api, { generationHooks: hooks, delivery: { ...native, checkpointLocalSelectionJson } });
  const command = (action, extra = {}) => { const current = adapter.snapshot(); return { action, binding: current.binding, revision: current.revision, plan: 'p', project: 'film', branch_id: 'main', ...extra }; };
  const prepare = () => adapter.command(command('delivery-preview', { target: 'assembly', filename: 'saved_%date:yyyy-MM-dd%', audio_source: 'generated', scene: 2, take_revision: 'b'.repeat(32), editorial_revision: 'e'.repeat(32) }));
  return { graph, nodes, posts, payload, app, api, adapter, command, prepare };
}

test('prepares without writes and queues the exact frozen recipe once, preserving the native graph', async () => {
  const f = fixture(), before = JSON.stringify(f.graph._nodes.map(n => n.widgets));
  const preview = await f.prepare(); assert.equal(f.posts.length, 0);
  f.payload.editorial.revision = 'changed after snapshot';
  const result = await f.adapter.command(f.command('deliver', { ticket: preview.data.ticket }));
  assert.equal(result.prompt_id, 'delivery-job'); assert.equal(f.posts.length, 1);
  const [number, prompt, options] = f.posts[0];
  assert.equal(number, 0); assert.deepEqual(options.partialExecutionTargets, ['assembly']);
  assert.equal(prompt.output.loop, undefined); assert.equal(prompt.output.p, undefined);
  assert.equal(prompt.output.h3_saved_delivery.inputs.snapshot_json, 'exact native snapshot with seed 18446744073709551615');
  assert.equal(prompt.output.assembly.inputs.filename, 'saved_%date:yyyy-MM-dd%');
  assert.equal(prompt.output.assembly.inputs.audio_bitrate, 256);
  assert.equal(prompt.workflow.native, true);
  assert.equal(JSON.stringify(f.graph._nodes.map(n => n.widgets)), before);
  await assert.rejects(f.adapter.command(f.command('deliver', { ticket: preview.data.ticket })), /review/);
  assert.equal(f.posts.length, 1);
});

test('native serialization changing a reviewed assembly value is rejected before queueing', async () => {
  const f = fixture(), preview = await f.prepare(), serialize = f.app.graphToPrompt;
  f.app.graphToPrompt = async graph => { const value = await serialize(graph); value.output.assembly.inputs.audio_bitrate = 64; return value; };
  await assert.rejects(f.adapter.command(f.command('deliver', { ticket: preview.data.ticket })), /audio_bitrate/);
  assert.equal(f.posts.length, 0);
});

test('a tab change during native serialization cannot redirect saved delivery', async () => {
  const f = fixture(), preview = await f.prepare(), serialize = f.app.graphToPrompt;
  f.app.graphToPrompt = async graph => { const value = await serialize(graph); f.app.graph = { id: 'other', _nodes: [] }; return value; };
  await assert.rejects(f.adapter.command(f.command('deliver', { ticket: preview.data.ticket })), /attached workflow/);
  assert.equal(f.posts.length, 0);
});

test('uncertain deliveries keep a receipt and never reuse their consumed ticket', async () => {
  const f = fixture(), preview = await f.prepare(), session = createCommandSession(f.adapter);
  f.api.queuePrompt = async (...args) => { f.posts.push(args); throw new Error('Lost response'); };
  const result = await session.execute('delivery-1', f.command('deliver', { ticket: preview.data.ticket }));
  assert.equal(result.outcome, 'uncertain'); assert.match(result.error, /may have reached/);
  await session.execute('delivery-1', f.command('deliver', { ticket: preview.data.ticket }));
  await assert.rejects(f.adapter.command(f.command('deliver', { ticket: preview.data.ticket })), /review/);
  assert.equal(f.posts.length, 1);
});

test('the native delivery recipe preserves allowed VAE inputs but rejects a generating ancillary branch', () => {
  const graph = { workflow: { full: true }, output: {
    assembly: { class_type: 'MiniMaxH3ChainAssemble', inputs: { manifest: ['loop', 0], blend_video_vae: ['vae', 0] } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: 'native.safetensors' } },
    loop: { class_type: 'MiniMaxH3ChainLoopEnd', inputs: {} },
  } };
  const result = native.deliveryPrompt(graph, 'assembly', 'snapshot');
  assert.equal(result.prompt.output.vae, graph.output.vae); assert.equal(result.prompt.output.loop, undefined);
  graph.output.vae.class_type = 'UnknownSamplingNode';
  assert.throws(() => native.deliveryPrompt(graph, 'assembly', 'snapshot'), /source adapter/);
  assert.throws(() => native.deliveryPrompt(graph, 'assembly', 'snapshot', { overwrite_existing: true }), /unknown/);
});
