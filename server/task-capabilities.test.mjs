import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { planTaskCapabilities, unregisteredNodes } from '../public/integrations/task-capabilities.mjs';

function snapshot() {
  const graph = { id: 'fixture', _nodes: [
    { id: 'p', type: 'MiniMaxH3ChainPlanModern', widgets: [{ name: 'plan_json', value: '{}' }, { name: 'run_name', value: 'film' }], inputs: [] },
    { id: 'assets', type: 'MiniMaxH3ProjectAssetManager', widgets: [{ name: 'run_name', value: 'film' }, { name: 'ownership_json', value: 'private-proof' }], inputs: [] },
  ] };
  return createAdapter({ graph, queuePrompt() {} }, {}, { ownershipOptions() {}, audioTracks: { projectAudioTrackBindings() {} }, workingBranches: true, finalCut: true }).snapshot();
}
const task = (value, id) => planTaskCapabilities(value, 'p').tasks.find(task => task.id === id);

test('separates whole-graph queue support from unimplemented range, branch, and delivery commands', () => {
  const value = snapshot();
  assert.equal(task(value, 'queue').status, 'available');
  for (const id of ['generate-range', 'branch-save', 'deliver', 'finish']) assert.equal(task(value, id).status, 'unavailable');
  assert.equal(task(value, 'workflow-save').status, 'unavailable');
  assert.equal(task(value, 'asset-update').status, 'available');
  assert.equal(task(value, 'asset-audio-tracks').status, 'available');
  assert.equal(JSON.stringify(value).includes('private-proof'), false);
});

test('connected authoring, project ambiguity, and missing ownership helpers affect the relevant tasks', () => {
  const value = snapshot();
  value.capabilities.ownership = false;
  assert.equal(task(value, 'asset-update').status, 'unavailable');
  value.nodes.p.editable = ['run_name'];
  assert.equal(task(value, 'patch').status, 'unavailable');
  assert.equal(task(value, 'take-final-cut').status, 'unavailable');
  assert.equal(task(value, 'queue').status, 'available');
  value.nodes.duplicate = structuredClone(value.nodes.assets);
  assert.equal(task(value, 'queue').status, 'unavailable');
});

test('unknown schemas stay unknown, and frontend virtual nodes are not reported as missing server nodes', () => {
  const value = snapshot();
  value.nodes.reroute = { class_type: 'Reroute', inputs: {}, virtual: true };
  assert.deepEqual(unregisteredNodes(value, {}), []);
  assert.deepEqual(unregisteredNodes(value, { MiniMaxH3ChainPlanModern: {} }), [{ nodeId: 'assets', classType: 'MiniMaxH3ProjectAssetManager' }]);
});
