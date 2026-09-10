import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as native from '../e2e/fixtures/h3-native/h3_chain_plan_core.mjs';
import { editPlanDraft } from '../public/integrations/plan-authoring.mjs';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { createCommandSession } from '../public/integrations/command-session.mjs';

const edit = (text, operation) => JSON.parse(editPlanDraft(native, typeof text === 'string' ? text : JSON.stringify(text), operation).text);
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
