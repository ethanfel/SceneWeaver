import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { productionRoles, traceProductionSource } from '../public/integrations/workflow-roles.mjs';
import { resolvePlanBinding, tracePlanSource } from '../public/integrations/binding-core.mjs';

const node = (class_type, inputs = {}, extra = {}) => ({ class_type, inputs, ...extra });
function graph() {
  return {
    p: node('MiniMaxH3ChainPlanModern', { run_name: 'film', plan_json: '{}', chain_policy: ['policy', 0] }),
    policy: node('MiniMaxH3GenerationProfile'),
    editor: node('MiniMaxH3ChainScenePromptEditor', { plan: ['p', 0] }),
    studio: node('MiniMaxH3ChainPlanStudio', { plan: ['editor', 0], plan_json: '{}' }),
    loop: node('MiniMaxH3ChainLoopStart', { plan: ['studio', 0] }),
    current: node('MiniMaxH3ChainCurrent', { state: ['loop', 1] }),
    segment: node('MiniMaxH3ChainSegmentSave', { state: ['current', 0] }),
    review: node('MiniMaxH3ChainReview', { state: ['current', 0], segment: ['segment', 0], pending_review: ['pending', 0] }),
    pending: node('MiniMaxH3PendingReview'),
    end: node('MiniMaxH3ChainLoopEnd', { state: ['current', 0], flow: ['loop', 0], segment: ['review', 0] }),
    assemble: node('MiniMaxH3ChainAssemble', { manifest: ['end', 0] }),
    checkpoint: node('MiniMaxH3ChainCheckpointManager', { plan: ['studio', 0] }),
  };
}

test('typed native connections identify production controls through authoring and presentation nodes', () => {
  const nodes = graph(), report = productionRoles(nodes, 'p');
  assert.deepEqual(resolvePlanBinding(nodes, 'p').studioIds, ['studio']);
  for (const [role, id] of Object.entries({ policy: 'policy', authoring: 'editor', preflight: 'studio', loop: 'loop', review: 'review', pendingReview: 'pending', handoff: 'end', delivery: 'assemble', checkpoint: 'checkpoint' })) {
    assert.equal(report.roles[role].status, 'bound', role);
    assert.deepEqual(report.roles[role].nodes.map(node => node.nodeId), [id], role);
  }
  assert.deepEqual(report.roles.delivery.nodes[0].loopIds, ['loop']);
  assert.ok(report.roles.delivery.nodes[0].path.includes('editor'));
  assert.equal(report.unassigned.length, 0);
});

test('never associates another Plan via a shared model, project name, or an independent pinned manifest', () => {
  const nodes = graph();
  nodes.other = node('MiniMaxH3ChainPlan', { run_name: 'film', plan_json: '{}' });
  nodes.external = node('ThirdPartyState', { model: ['p', 0] });
  nodes.segment.inputs.state = ['external', 0];
  nodes.assemble.inputs.manifest = ['checkpoint', 0];
  const report = productionRoles(nodes, 'p');
  assert.equal(report.roles.review.status, 'missing');
  assert.equal(report.roles.delivery.status, 'missing');
  assert.match(report.unassigned.find(item => item.nodeId === 'assemble').reason, /pinned independently/);
  assert.equal(report.roles.checkpoint.status, 'bound');
  assert.equal(productionRoles(nodes, 'other').roles.loop.status, 'missing');
});

test('rejects crossed state/segment/flow between two loops, including loops sharing a Plan', () => {
  const nodes = graph();
  nodes.loop2 = node('MiniMaxH3ChainLoopStart', { plan: ['p', 0] });
  nodes.segment.inputs.state = ['loop2', 1];
  assert.equal(traceProductionSource(nodes, ['end', 0], 'manifest').status, 'ambiguous');
  const report = productionRoles(nodes, 'p');
  assert.equal(report.roles.loop.status, 'multiple');
  assert.equal(report.roles.handoff.status, 'missing');
  nodes.other = node('MiniMaxH3ChainPlan', { run_name: 'other', plan_json: '{}' });
  nodes.loop2.inputs.plan = ['other', 0];
  assert.equal(traceProductionSource(nodes, ['review', 0], 'segment').status, 'ambiguous');
});

test('reports shared policies and multiple deliveries without silently choosing a target', () => {
  const nodes = graph();
  nodes.other = node('MiniMaxH3ChainPlan', { run_name: 'other', plan_json: '{}', chain_policy: ['policy', 0] });
  nodes.override = node('MiniMaxH3AdvancedPolicy', { chain_policy: ['policy', 0] });
  nodes.p.inputs.chain_policy = ['override', 0];
  nodes.second = node('MiniMaxH3ChainAssemble', { manifest: ['end', 0] });
  const report = productionRoles(nodes, 'p');
  assert.equal(report.roles.policy.status, 'shared');
  assert.deepEqual(report.roles.policy.nodes.find(item => item.nodeId === 'policy').planIds, ['p', 'other']);
  assert.equal(report.roles.delivery.status, 'multiple');
});

test('preserves routing failure evidence, wrong slots, muted sources and cycles', () => {
  const nodes = graph();
  nodes.loop.inputs.plan = ['studio', 1];
  assert.match(productionRoles(nodes, 'p').unassigned.find(item => item.nodeId === 'loop').reason, /not a supported Plan output/);
  nodes.loop.inputs.plan = ['studio', 0]; nodes.studio.mode = 4;
  assert.equal(productionRoles(nodes, 'p').roles.loop.status, 'missing');
  nodes.studio.mode = 0; nodes.editor.inputs.plan = ['studio', 0];
  assert.match(tracePlanSource(nodes, ['studio', 0]).reason, /cycle/);
  nodes.editor.inputs.plan = ['p', 0]; nodes.loop.inputErrors = ['plan'];
  assert.match(productionRoles(nodes, 'p').unassigned.find(item => item.nodeId === 'loop').reason, /broken plan/);
  nodes.loop.inputErrors = []; nodes.loop.inputs.initial_state = ['current', 0];
  assert.match(productionRoles(nodes, 'p').unassigned.find(item => item.nodeId === 'loop').reason, /initial state/);
});

const fixtures = JSON.parse(await readFile(new URL('./fixtures/h3-production-topology.json', import.meta.url), 'utf8'));
for (const fixture of fixtures.cases) test(`upstream topology: ${fixture.name}`, () => {
  const nodes = fixture.nodes, planId = Object.entries(nodes).find(([, node]) => node.class_type === 'MiniMaxH3ChainPlanModern')?.[0];
  const report = productionRoles(nodes, planId || '');
  if (!fixture.name.includes('Deferred')) {
    assert.ok(planId);
    for (const role of ['policy', 'preflight', 'loop', 'review', 'handoff', 'checkpoint']) assert.equal(report.roles[role].status, 'bound', role);
    assert.equal(report.roles.delivery.status, 'bound');
    assert.equal(report.roles.delivery.nodes.length, 1);
    // Upstream ships a second, inactive assembly path for saved manifests.
    assert.equal(report.unassigned.length, 1);
    assert.equal(report.unassigned[0].role, 'delivery');
    assert.equal(report.unassigned[0].status, 'inactive');
  } else {
    assert.equal(planId, undefined);
    assert.equal(report.roles.delivery.nodes.length, 0);
    assert.ok(report.unassigned.some(item => item.role === 'checkpoint'));
  }
});
