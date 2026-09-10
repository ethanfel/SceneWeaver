import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveWorkflowFile, workflowFileStatus } from '../public/integrations/workflow-file.mjs';
import { createAdapter } from '../public/integrations/companion-client.mjs';

function fixture() {
  const writes = [], graph = { id: 'film', _nodes: [], links: {} };
  const node = { id: 1, graph, type: 'MiniMaxH3ChainPlan', widgets: [{ name: 'run_name', value: 'film' }, { name: 'plan_json', value: '{"shots":[]}' }], inputs: [] };
  graph._nodes.push(node);
  const workflow = { path: 'workflows/Film.json', filename: 'Film.json', isPersisted: true, isTemporary: false, isModified: true, activeState: { id: 'film' }, changeTracker: { prepareForSave() { writes.push('capture'); } } };
  const store = { activeWorkflow: workflow, async saveWorkflow(target) { writes.push(target); target.isModified = false; } };
  const app = { graph, extensionManager: { workflow: store } }, adapter = createAdapter(app, {});
  const base = adapter.snapshot(), command = { action: 'workflow-save', binding: base.binding, revision: base.revision };
  return { writes, workflow, store, app, adapter, command, node };
}

test('native workflow saving captures through the tracker and persists the bound workflow object', async () => {
  const f = fixture();
  const result = await f.adapter.command(f.command);
  assert.equal(result.saved, true); assert.equal(result.path, 'workflows/Film.json');
  assert.deepEqual(f.writes, ['capture', f.workflow]);
  assert.equal(result.snapshot.workflowFile.state, 'saved');
  assert.equal(result.snapshot.revision, f.command.revision, 'Persistence status does not invalidate an unchanged prompt draft.');
});

test('unknown frontend APIs and temporary workflows never fall back to a raw userdata write', async () => {
  const f = fixture(); delete f.workflow.changeTracker.prepareForSave;
  assert.equal(workflowFileStatus(f.app).canSave, false);
  await assert.rejects(saveWorkflowFile(f.app, () => {}), /does not expose/);
  assert.deepEqual(f.writes, []);
  const g = fixture(); g.workflow.isPersisted = false; g.workflow.isTemporary = true;
  assert.equal(workflowFileStatus(g.app).state, 'temporary');
  await assert.rejects(g.adapter.command(g.command), /Name and save/);
  assert.deepEqual(g.writes, []);
});

test('a changed workflow before capture and a busy native store prevent saving', async () => {
  const f = fixture(); f.store.activeWorkflow = { ...f.workflow, path: 'workflows/Other.json' }; // Copies may retain the same serialized graph UUID.
  await assert.rejects(f.adapter.command(f.command), /changed/);
  assert.deepEqual(f.writes, []);
  const g = fixture(); g.store.isBusy = true;
  await assert.rejects(g.adapter.command(g.command), /already changing or saving/);
  assert.deepEqual(g.writes, []);
});

test('late save completion reports a changed tab without writing that tab', async () => {
  const f = fixture(), other = { ...f.workflow, path: 'workflows/Other.json', activeState: { id: 'other' } };
  f.store.saveWorkflow = async target => { f.writes.push(target); f.store.activeWorkflow = other; target.isModified = false; };
  const result = await f.adapter.command(f.command);
  assert.match(result.warning, /active tab changed/);
  assert.deepEqual(f.writes, ['capture', f.workflow]);
  assert.notEqual(f.writes[1], other);
});

test('edits during persistence remain visibly unsaved and failures never report success', async () => {
  const f = fixture(); f.store.saveWorkflow = async target => { f.node.widgets[1].value = '{"shots":[{"prompt":"new"}]}'; target.isModified = false; };
  const result = await f.adapter.command(f.command);
  assert.match(result.warning, /graph or active tab changed/);
  assert.equal(f.workflow.isModified, true);
  assert.equal(result.snapshot.workflowFile.state, 'modified');
  const g = fixture(); g.store.saveWorkflow = async () => { throw new Error('Disk unavailable'); };
  await assert.rejects(g.adapter.command(g.command), /Disk unavailable/);
  assert.equal(g.workflow.isModified, true);
});
