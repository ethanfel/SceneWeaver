import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChoices } from '../public/integrations/binding-core.mjs';
import { resolvePlanDocument, planBranchSource, sharedPlanEdits, validatePlanSourceEdits } from '../public/integrations/plan-source.mjs';
import { createAdapter } from '../public/integrations/companion-client.mjs';
import { rebaseDraft } from '../public/integrations/bridge-core.mjs';

const json = prompt => JSON.stringify({ shots: [{ id: 'opening', prompt }] });
const node = (class_type, inputs, extra = {}) => ({ class_type, inputs, editable: Object.keys(inputs), ...extra });
const plan = inputs => node('MiniMaxH3ChainPlanModern', { run_name: 'film', plan_json: json('fallback'), ...inputs });
const text = value => node('PrimitiveStringMultiline', { value });
function graph() {
  return { p: plan({ plan_json_input: ['get', 0] }), get: node('GetNode', { Constant: 'Plan' }), set: node('SetNode', { Constant: 'Plan', '*': ['reroute', 0] }), reroute: node('Reroute', { '': ['text', 0] }), text: text(json('effective')) };
}

test('uses native override precedence through Get/Set and reroutes, including blank fallback behavior', () => {
  const nodes = graph(), source = resolvePlanDocument(nodes, 'p');
  assert.equal(source.text, json('effective'));
  assert.deepEqual([source.nodeId, source.widget, source.input], ['text', 'value', 'plan_json_input']);
  assert.deepEqual(source.path, ['p', 'get', 'set', 'reroute', 'text']);
  nodes.text.inputs.value = ' \n ';
  assert.equal(resolvePlanDocument(nodes, 'p').text, json('fallback'));
  assert.equal(resolvePlanDocument(nodes, 'p').fallback, true);
  nodes.p.inputs.plan_json_input = json('inline override');
  assert.equal(resolvePlanDocument(nodes, 'p').widget, 'plan_json_input');
});

test('keeps Plans selectable when their required JSON widget is converted to a connection', () => {
  const nodes = { p: plan({ plan_json: ['text', 0] }), text: text(json('connected required input')) };
  assert.equal(planChoices(nodes)[0][0], 'p');
  assert.equal(resolvePlanDocument(nodes, 'p').text, json('connected required input'));
  nodes.p.inputs.plan_json = ['text', 1];
  assert.equal(resolvePlanDocument(nodes, 'p').status, 'unresolved');
});

test('never substitutes fallback scenes when runtime, transformed, inactive or broken sources are unknown', () => {
  const nodes = graph();
  nodes.text.class_type = 'RuntimePromptGenerator';
  assert.equal(resolvePlanDocument(nodes, 'p').text, null);
  nodes.text = text(json('effective')); nodes.text.runtimeText = ['value'];
  assert.match(resolvePlanDocument(nodes, 'p').reason, /serialization/);
  delete nodes.text.runtimeText; nodes.text.mode = 4;
  assert.equal(resolvePlanDocument(nodes, 'p').status, 'unresolved');
  nodes.text.mode = 0; nodes.p.inputErrors = ['plan_json_input'];
  assert.equal(resolvePlanDocument(nodes, 'p').text, null);
  nodes.p.inputErrors = []; nodes.text.inputs.value = ['text', 0];
  assert.match(resolvePlanDocument(nodes, 'p').reason, /cyclic/);
});

test('derives the effective branch and rejects the native whitespace override / named fallback mismatch', () => {
  const nodes = graph(), branch = '1'.repeat(32);
  nodes.text.inputs.value = JSON.stringify({ _branch_id: branch, shots: [] });
  assert.equal(planBranchSource(nodes, 'p').id, branch);
  nodes.p.inputs.plan_json = nodes.text.inputs.value; nodes.text.inputs.value = '   ';
  assert.equal(planBranchSource(nodes, 'p').id, '');
  assert.match(planBranchSource(nodes, 'p').reason, /whitespace/);
  nodes.text.inputs.value = '';
  assert.equal(planBranchSource(nodes, 'p').id, branch);
  nodes.text.inputs.value = '{invalid';
  assert.equal(planBranchSource(nodes, 'p').id, '');
});

test('shared-source acknowledgement covers all active consumers, not only the selected Plan', () => {
  const nodes = graph(); nodes.second = plan({ plan_json: ['text', 0] }); nodes.clip = node('CLIPTextEncode', { text: ['text', 0] });
  nodes.inactive = node('CLIPTextEncode', { text: ['text', 0] }, { mode: 2 });
  const edits = [{ node: 'text', widget: 'value', before: nodes.text.inputs.value, after: json('both Plans') }];
  const shared = sharedPlanEdits(nodes, edits);
  assert.deepEqual(shared[0].consumers, [{ node: 'clip', widget: 'text' }, { node: 'p', widget: 'plan_json_input' }, { node: 'second', widget: 'plan_json' }]);
  assert.throws(() => validatePlanSourceEdits(nodes, edits), /every consumer/);
  assert.doesNotThrow(() => validatePlanSourceEdits(nodes, edits, shared));
  nodes.third = plan({ plan_json_input: ['text', 0] });
  assert.throws(() => validatePlanSourceEdits(nodes, edits, shared), /every consumer/);
});

test('a primitive edit cannot switch a connected Plan branch or activate a named-branch override', () => {
  const nodes = graph();
  const edits = [{ node: 'text', widget: 'value', before: nodes.text.inputs.value, after: JSON.stringify({ shots: [], _branch_id: '2'.repeat(32) }) }];
  assert.throws(() => validatePlanSourceEdits(nodes, edits), /working branch/);
  nodes.text.inputs.value = '';
  assert.throws(() => validatePlanSourceEdits(nodes, edits), /working branch/);
});

test('draft reconciliation preserves a connected-source draft on rewiring or a remote branch switch', () => {
  const nodes = graph(), base = { binding: 'same', nodes }, draft = { prompt: nodes };
  draft.prompt = structuredClone(nodes); draft.prompt.text.inputs.value = json('local edit');
  const next = structuredClone(base); next.nodes.newText = text(json('other')); next.nodes.reroute.inputs[''] = ['newText', 0];
  assert.match(rebaseDraft(base, next, draft).conflicts[0], /text connection changed/);
  assert.equal(rebaseDraft(base, next, draft).draft, draft);
  next.nodes = structuredClone(nodes); next.nodes.text.inputs.value = JSON.stringify({ shots: [], _branch_id: '2'.repeat(32) });
  assert.match(rebaseDraft(base, next, draft).conflicts[0], /effective Plan working branch/);
});

test('native Primitive writes use callbacks and never evaluate serializers during inspection', async () => {
  let callbacks = 0, serializations = 0;
  const graph = { id: 'workflow', _nodes: [], links: { 1: { origin_id: 2, origin_slot: 0 } } };
  const primitive = { id: 2, type: 'PrimitiveNode', graph, widgets: [{ name: 'value', value: json('effective'), callback() { callbacks++; } }], inputs: [], properties: {} };
  const plan = { id: 1, type: 'MiniMaxH3ChainPlan', graph, widgets: [{ name: 'run_name', value: 'film' }, { name: 'plan_json', value: json('fallback') }], inputs: [{ name: 'plan_json_input', link: 1 }] };
  graph._nodes = [plan, primitive];
  const adapter = createAdapter({ graph }, {}), before = adapter.snapshot();
  assert.equal(resolvePlanDocument(before.nodes, '1').nodeId, '2');
  await adapter.command({ action: 'patch', binding: before.binding, revision: before.revision, edits: [{ node: '2', widget: 'value', before: primitive.widgets[0].value, after: json('changed') }] });
  assert.equal(callbacks, 1);
  assert.equal(plan.widgets[1].value, json('fallback'));
  primitive.widgets[0].serializeValue = () => { serializations++; return json('runtime'); };
  assert.equal(resolvePlanDocument(adapter.snapshot().nodes, '1').status, 'unresolved');
  assert.equal(serializations, 0);
});
