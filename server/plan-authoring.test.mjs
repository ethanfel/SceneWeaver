import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as native from '../e2e/fixtures/h3-native/h3_chain_plan_core.mjs';
import { editPlanDraft } from '../public/integrations/plan-authoring.mjs';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { createCommandSession } from '../public/integrations/command-session.mjs';

const edit = (text, operation) => JSON.parse(editPlanDraft(native, typeof text === 'string' ? text : JSON.stringify(text), operation).text);
const sceneSettings = patch => ({ type: 'scene-settings', index: 0, duration: { mode: 'default', value: '' }, steps: '', seed: '', prompt_seed_mode: 'inherit', prompt_seed: '', ...patch });

test('scene settings store requested seconds literally and reset inheritance without removing other options', () => {
  const source = { shots: [{ id: 'a', prompt: 'one', frames: 209, steps: 8, seed: '5', prompt_seed: '4', prompt_seed_mode: 'fixed', visual_context_source: 'previous', custom: { keep: true } }] };
  const seconds = edit(source, sceneSettings({ duration: { mode: 'seconds', value: '6' }, steps: '12', seed: '18446744073709551615', prompt_seed_mode: 'fixed', prompt_seed: '18446744073709551615' }));
  assert.equal(seconds.shots[0].duration_seconds, 6); assert.equal(seconds.shots[0].length, undefined); assert.equal(seconds.shots[0].frames, undefined);
  assert.equal(seconds.shots[0].seed, '18446744073709551615'); assert.equal(seconds.shots[0].prompt_seed, '18446744073709551615');
  const inherited = edit(seconds, sceneSettings());
  for (const field of ['length', 'frames', 'duration_seconds', 'steps', 'seed', 'prompt_seed', 'prompt_seed_mode']) assert.equal(inherited.shots[0][field], undefined);
  assert.equal(inherited.shots[0].visual_context_source, 'previous'); assert.deepEqual(inherited.shots[0].custom, { keep: true });
  assert.equal(source.shots[0].frames, 209);
  const exact = edit(source, sceneSettings({ duration: { mode: 'frames', value: '158' }, prompt_seed_mode: 'randomize' }));
  assert.equal(exact.shots[0].length, 158); assert.equal(exact.shots[0].prompt_seed_mode, 'randomize'); assert.equal(exact.shots[0].prompt_seed, undefined);
});

test('invalid duration, steps, seeds and prompt modes cannot produce a draft', () => {
  const plan = { shots: ['scene'] };
  for (const duration of [{ mode: 'seconds', value: '0' }, { mode: 'seconds', value: '150' }, { mode: 'seconds', value: 'NaN' }, { mode: 'frames', value: '24' }]) assert.throws(() => edit(plan, sceneSettings({ duration })));
  for (const steps of ['1.5', '-1', '10001']) assert.throws(() => edit(plan, sceneSettings({ steps })), /Steps/);
  for (const seed of ['-1', '18446744073709551616', '1e4']) assert.throws(() => edit(plan, sceneSettings({ seed })), /Seed/);
  assert.throws(() => edit(plan, sceneSettings({ prompt_seed_mode: 'fixed' })), /fixed prompt seed/);
  assert.throws(() => edit(plan, sceneSettings({ prompt_seed_mode: 'unknown' })), /Prompt seed mode/);
});

test('Plan defaults and shared direction retain inheritance precedence and the existing legacy key', () => {
  const source = { duration_seconds: 12, steps: 18, global_prompt: ['Original'], defaults: { steps: 9, custom: 'kept' }, shots: [{ id: 'a', prompt: 'scene', length: 209 }] };
  const changed = edit(source, { type: 'plan-defaults', index: 0, duration_seconds: '6', steps: '8' });
  assert.deepEqual(changed.defaults, { duration_seconds: 6, steps: 8, custom: 'kept' }); assert.equal(changed.shots[0].length, 209);
  const reset = edit(changed, { type: 'plan-defaults', index: 0, duration_seconds: '', steps: '' });
  assert.deepEqual(reset.defaults, { custom: 'kept' }); assert.equal(reset.duration_seconds, undefined); assert.equal(reset.steps, undefined);
  const direction = edit(reset, { type: 'shared-direction', index: 0, text: 'Shared\n\nDirection' });
  assert.deepEqual(direction.global_prompt, ['Shared', '', 'Direction']); assert.equal(direction.prompt_prefix, undefined);
});

test('chapter boundary and resolution edits validate with native normalization and select the relocated marker', () => {
  const plan = { shots: [{ id: 'a', prompt: 'one' }, { id: 'b', prompt: 'two' }], chapters: [{ id: 'act', title: 'Act', start_scene_id: 'a' }] };
  const operation = { type: 'chapter-update', index: 0, chapter_id: 'act', title: 'Act', text: 'notes', start_scene_id: 'b', resolution: { width: 1024, height: 576 } };
  const result = editPlanDraft(native, JSON.stringify(plan), operation), changed = JSON.parse(result.text);
  assert.equal(result.selected, 1); assert.deepEqual(changed.chapters[0].resolution, operation.resolution); assert.equal(changed.chapters[0].start_scene_id, 'b');
  assert.throws(() => edit(plan, { ...operation, resolution: { width: 1000, height: 576 } }), /multiples of 32/);
  assert.throws(() => edit({ ...plan, chapters: [...plan.chapters, { id: 'two', title: 'Other', start_scene_id: 'b' }] }, operation), /Only one chapter/);
  const reset = edit(changed, { ...operation, resolution: null }); assert.equal(reset.chapters[0].resolution, undefined);
});

test('new seed actions delegate to the native secure generator without changing other seed domains', () => {
  const source = { shots: [{ id: 'a', prompt: 'one', seed: '4', prompt_seed: '6', prompt_seed_mode: 'fixed' }] };
  const generation = edit(source, { type: 'scene-seed-random', index: 0, kind: 'generation' });
  assert.match(generation.shots[0].seed, /^\d+$/); assert.ok(BigInt(generation.shots[0].seed) <= native.MAX_SEED); assert.equal(generation.shots[0].prompt_seed, '6');
  const prompt = edit(source, { type: 'scene-seed-random', index: 0, kind: 'prompt' });
  assert.match(prompt.shots[0].prompt_seed, /^\d+$/); assert.ok(BigInt(prompt.shots[0].prompt_seed) <= native.MAX_SEED); assert.equal(prompt.shots[0].seed, '4');
  const staged = edit(source, sceneSettings({ duration: { mode: 'seconds', value: '6' }, steps: '17', seed: 'invalid replaced seed', prompt_seed_mode: 'fixed', prompt_seed: '6', randomize_seed: 'generation' }));
  assert.equal(staged.shots[0].duration_seconds, 6); assert.equal(staged.shots[0].steps, 17); assert.equal(staged.shots[0].prompt_seed, '6'); assert.match(staged.shots[0].seed, /^\d+$/);
});
test('native duplication retains uint64 seeds, chapters, metadata and continuation identity', () => {
  const text = '{"_branch_id":"abc","custom":{"keep":true},"shots":[{"id":"a","prompt":"first","seed":18446744073709551615},{"id":"b","prompt":"second","visual_context_source":"a","audio_context_source":1},{"id":"c","prompt":"third","visual_context_source":2,"visual_context_start_frame":4,"visual_context_blocks":[{"source":2,"start_frame":1}]}],"chapters":[{"id":"act","start_scene_id":"b","title":"Act","text":"notes"}]}';
  const out = edit(text, { type: 'duplicate', index: 0 });
  assert.deepEqual(out.shots.map(s => s.id), ['a', 'a_copy', 'b', 'c']);
  assert.equal(out.shots[0].seed, '18446744073709551615'); assert.equal(out.shots[1].seed, out.shots[0].seed);
  assert.equal(out.shots[2].visual_context_source, 'a_copy'); assert.equal(out.shots[2].audio_context_source, 2);
  assert.equal(out.shots[3].visual_context_source, 3); assert.equal(out.shots[3].visual_context_blocks[0].source, 3);
  assert.equal(out.chapters[0].start_scene_id, 'b'); assert.equal(out._branch_id, 'abc'); assert.deepEqual(out.custom, { keep: true });
});

test('native rename updates ID references and chapter starts but preserves numeric reference spelling', () => {
  const out = edit({ shots: [{ id: 'old', prompt: 'one' }, { id: 'next', prompt: 'two', visual_context_source: 'old', audio_context_lead_source: 'old', visual_context_blocks: [{ source: 'old' }], audio_context_source: '1' }], chapters: [{ id: 'act', title: 'Act', start_scene_id: 'old' }] }, { type: 'rename', index: 0, id: 'New scene!' });
  assert.equal(out.shots[0].id, 'New_scene'); assert.equal(out.chapters[0].start_scene_id, 'New_scene');
  assert.equal(out.shots[1].visual_context_source, 'New_scene'); assert.equal(out.shots[1].audio_context_lead_source, 'New_scene');
  assert.equal(out.shots[1].visual_context_blocks[0].source, 'New_scene'); assert.equal(out.shots[1].audio_context_source, '1');
  assert.throws(() => edit(out, { type: 'rename', index: 0, id: 'next' }), /already uses/);
  assert.equal(edit({ shots: ['implicit'] }, { type: 'rename', index: 0, id: 'clip_0001' }).shots[0].id, 'clip_0001');
  assert.equal(edit({ shots: [{ id: 'raw name', prompt: 'one' }] }, { type: 'rename', index: 0, id: 'raw_name' }).shots[0].id, 'raw_name');
});

test('chapter creation, notes and deletion preserve scenes; scene deletion migrates a chapter boundary natively', () => {
  const plan = { shots: [{ id: 'a', prompt: 'one' }, { id: 'b', prompt: 'two' }, { id: 'c', prompt: 'three' }] };
  const added = edit(plan, { type: 'chapter-add', index: 1 }), chapter = added.chapters[0];
  assert.equal(chapter.start_scene_id, 'b'); assert.throws(() => edit(added, { type: 'chapter-add', index: 1 }), /already starts/);
  const updated = edit(added, { type: 'chapter-update', index: 1, chapter_id: chapter.id, title: 'Arrival', text: 'Chapter notes' });
  assert.equal(updated.chapters[0].text, 'Chapter notes');
  const removedScene = edit(updated, { type: 'remove', index: 1 }); assert.equal(removedScene.chapters[0].start_scene_id, 'c');
  const removed = edit(updated, { type: 'chapter-remove', index: 1, chapter_id: chapter.id });
  assert.equal(removed.chapters, undefined); assert.deepEqual(removed.shots, updated.shots);
});

test('accepted native shorthand, implicit identity and limits use the installed core', () => {
  const out = edit('["first","second"]', { type: 'duplicate', index: 0 });
  assert.deepEqual(out.shots.map(s => s.id), ['clip_0001', 'scene_01_copy', 'clip_0002']);
  assert.deepEqual(out.shots[1].prompt, ['first']);
  const source = { duration_seconds: 8, steps: 14, defaults: { steps: 7 }, shots: ['scene'] };
  const added = edit(source, { type: 'add', index: 0 }); assert.deepEqual(added.defaults, { duration_seconds: 8, steps: 7 });
  assert.equal(added.shots[1].id, 'scene_02');
  assert.throws(() => edit(source, { type: 'remove', index: 0 }), /at least one/);
  assert.throws(() => edit(source, { type: 'move', index: 0, direction: 1 }), /inside the Plan/);
  assert.throws(() => edit({ shots: Array.from({ length: native.MAX_SHOTS }, (_, i) => ({ id: `s${i}`, prompt: 'p' })) }, { type: 'duplicate', index: 0 }), /at most/);
  assert.throws(() => editPlanDraft({}, JSON.stringify(source), { type: 'add', index: 0 }), /helpers are unavailable/);
});

test('draft command follows connected sources, validates binding, and never writes or queues', async () => {
  const graph = { id: 'one', _nodes: [], links: { 1: { origin_id: 'text', origin_slot: 0 } } };
  const plan = { id: 'p', type: 'MiniMaxH3ChainPlan', graph, widgets: [{ name: 'plan_json', value: '{"shots":["fallback"]}' }], inputs: [{ name: 'plan_json_input', link: 1 }] };
  const source = { id: 'text', type: 'PrimitiveStringMultiline', graph, widgets: [{ name: 'value', value: '{"shots":[{"id":"a","prompt":"original"}]}' }], inputs: [] };
  graph._nodes.push(plan, source);
  const adapter = createAdapter({ graph, canvas: { graph } }, { fetchApi() { throw new Error('No HTTP action expected'); } }, { planAuthoring: native });
  const session = createCommandSession(adapter), snapshot = adapter.snapshot(), before = JSON.stringify(graph._nodes.map(n => n.widgets));
  assert.equal(snapshot.capabilities.planAuthoringVersion, 1);
  const command = { action: 'plan-edit', binding: snapshot.binding, revision: snapshot.revision, plan: 'p', source_node: 'text', source_widget: 'value', text: '{"shots":[{"id":"a","prompt":"unapplied draft"}]}', edit: { type: 'duplicate', index: 0 } };
  const result = await session.execute('preview', command);
  assert.equal(JSON.parse(result.result.data.text).shots[1].prompt[0], 'unapplied draft');
  assert.deepEqual(session.recent(), []); assert.equal(JSON.stringify(graph._nodes.map(n => n.widgets)), before);
  await assert.rejects(adapter.command({ ...command, source_node: 'p', source_widget: 'plan_json' }), /different text source/);
  source.widgets[0].value = '{"shots":["newer native prompt"]}';
  await assert.rejects(adapter.command(command), /workflow changed/);
});
