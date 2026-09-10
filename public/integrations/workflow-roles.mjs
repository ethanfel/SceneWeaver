import { effectiveInputs, isActiveNode, isConnection, planChoices, tracePlanSource, traceSource } from './binding-core.mjs';

// Audited H3 typed socket contracts. Never infer ownership by traversing model,
// image, audio, or arbitrary third-party inputs. Unknown producers stay unknown.
export const ROLE_LABELS = {
  policy: 'Generation policy', authoring: 'Prompt editors', preflight: 'Preflight',
  checkpoint: 'Checkpoint managers', loop: 'Generation loops', review: 'Live review',
  pendingReview: 'Deferred review policy', handoff: 'Loop continuation',
  delivery: 'Assembly / chapter delivery', export: 'PNG / WAV export',
};
const failed = (reason, path = [], status = 'unresolved') => ({ status, reason, path, planIds: [], loopIds: [] });
const errors = node => node.inputErrors ?? node._meta?.inputErrors ?? [];
const unique = values => [...new Set(values)];

export function traceProductionSource(nodes, source, domain, seen = new Set()) {
  if (domain === 'plan') {
    const result = tracePlanSource(nodes, source);
    return result.status === 'resolved' ? { ...result, planIds: [result.nodeId], loopIds: [] } : { ...result, planIds: [], loopIds: [] };
  }
  const result = traceSource(nodes, source);
  if (result.status !== 'resolved') return { ...result, planIds: [], loopIds: [] };
  const { nodeId: id, slot, path } = result, node = nodes[id], key = `${id}:${slot}:${domain}`;
  if (seen.has(key) || seen.size >= 128) return failed('The production connection contains a cycle or exceeds the inspection limit.', path);
  const next = new Set(seen); next.add(key);
  let inputs;
  if (node.class_type === 'MiniMaxH3ChainLoopStart' && (domain === 'flow' && slot === 0 || domain === 'state' && slot === 1)) {
    inputs = [['plan', 'plan']];
    // An imported initial state can carry another execution context. Its
    // semantics need a specific adapter before this loop becomes a target.
    if (isConnection(effectiveInputs(node).initial_state) || errors(node).includes('initial_state')) return failed('Loop Start has an external initial state; its execution context needs validation.', path);
  } else if (slot === 0) {
    const contracts = {
      MiniMaxH3ChainCurrent: ['state', [['state', 'state']]],
      MiniMaxH3ChainSegmentSave: ['segment', [['state', 'state']]],
      MiniMaxH3ChainReview: ['segment', [['state', 'state'], ['segment', 'segment']]],
      MiniMaxH3ChainLoopEnd: ['manifest', [['flow', 'flow'], ['state', 'state'], ['segment', 'segment']]],
      MiniMaxH3ChainManifestLoad: ['manifest', [['plan', 'plan']]],
      MiniMaxH3ChainChapterDelivery: ['manifest', [['manifest', 'manifest']]],
    };
    if (contracts[node.class_type]?.[0] === domain) inputs = contracts[node.class_type][1];
    if (domain === 'manifest' && node.class_type === 'MiniMaxH3ChainCheckpointManager') return failed('This checkpoint output can be pinned independently of its authoring Plan. Inspect its exact saved selection before using it as a delivery source.', path);
    if (domain === 'manifest' && node.class_type === 'MiniMaxH3ChainChapterLoad') return failed('This chapter is an independent saved manifest; a matching project name does not bind it to the selected Plan.', path);
  }
  if (!inputs) return failed(`${node.class_type} #${id} output ${slot} has no supported ${domain} provenance adapter.`, path);
  const dependencies = inputs.map(([name, kind]) => traceInput(nodes, id, name, kind, next));
  const allPath = unique([...path, ...dependencies.flatMap(item => item.path)]);
  const problem = dependencies.find(item => item.status !== 'resolved');
  if (problem) return { ...problem, path: allPath };
  const planIds = unique(dependencies.flatMap(item => item.planIds));
  const loopIds = unique([...dependencies.flatMap(item => item.loopIds), ...(node.class_type === 'MiniMaxH3ChainLoopStart' ? [id] : [])]);
  if (planIds.length !== 1 || loopIds.length > 1) return { ...failed('The connected state, flow, or segment belongs to different Plans or generation loops.', allPath, 'ambiguous'), planIds, loopIds };
  return { status: 'resolved', planIds, loopIds, path: allPath };
}

function traceInput(nodes, id, name, domain, seen) {
  const node = nodes[id];
  if (!isActiveNode(node)) return failed(`Node ${id} is inactive or shared across subgraph instances.`, [id], 'inactive');
  if (errors(node).includes(name)) return failed(`Node ${id} has a broken ${name} connection.`, [id]);
  if (!isConnection(effectiveInputs(node)[name])) return failed(`Node ${id} has no connected ${name} source.`, [id]);
  const result = traceProductionSource(nodes, effectiveInputs(node)[name], domain, seen);
  return { ...result, path: unique([id, ...result.path]) };
}

function policyRoute(nodes, planId) {
  const node = nodes[planId], path = [], ids = [];
  if (!isActiveNode(node)) return { ids, ...failed('The Plan is inactive or shared across subgraph instances.') };
  let source = effectiveInputs(node).chain_policy;
  if (errors(node).includes('chain_policy')) return { ids, ...failed('The Plan has a broken policy connection.') };
  if (!isConnection(source)) return { ids, status: 'missing', path, reason: 'No separate policy is connected; inspect the Plan defaults.' };
  while (path.length < 128) {
    const result = traceSource(nodes, source); path.push(...result.path);
    if (result.status !== 'resolved') return { ids, ...result, path };
    const { nodeId: id, slot } = result, item = nodes[id];
    if (slot !== 0 || ids.includes(id)) return { ids, ...failed('The policy output is unsupported or cyclic.', path) };
    if (!['MiniMaxH3GenerationProfile', 'MiniMaxH3ChainPolicy', 'MiniMaxH3AdvancedPolicy', 'MiniMaxH3Legacy04PolicyAdapter'].includes(item.class_type)) return { ids, ...failed(`Policy ${item.class_type} #${id} needs an adapter.`, path) };
    ids.push(id);
    if (errors(item).includes('chain_policy')) return { ids, ...failed(`Policy ${id} has a broken upstream connection.`, path) };
    const upstream = effectiveInputs(item).chain_policy;
    if (['MiniMaxH3AdvancedPolicy', 'MiniMaxH3Legacy04PolicyAdapter'].includes(item.class_type) && isConnection(upstream)) { source = upstream; continue; }
    if (item.class_type === 'MiniMaxH3AdvancedPolicy') return { ids, ...failed(`Advanced Policy ${id} has no base policy.`, path) };
    return { ids, status: 'resolved', path };
  }
  return { ids, ...failed('The policy route exceeds the inspection limit.', path) };
}

export function productionRoles(nodes, planId) {
  const roles = Object.fromEntries(Object.keys(ROLE_LABELS).map(role => [role, { status: 'missing', nodes: [], issues: [] }]));
  const unassigned = [], associations = [];
  const inspect = (nodeId, role, result, note = '') => associations.push({ ...result, nodeId, role, note });
  for (const [id, node] of Object.entries(nodes)) {
    const type = node.class_type;
    if (['MiniMaxH3ChainScenePromptEditor', 'MiniMaxH3ChainRichScenePromptEditor'].includes(type)) inspect(id, 'authoring', traceInput(nodes, id, 'plan', 'plan'));
    if (type === 'MiniMaxH3ChainPreflight' || type === 'MiniMaxH3ChainPlanStudio') inspect(id, 'preflight', traceProductionSource(nodes, [id, 0], 'plan'));
    if (type === 'MiniMaxH3ChainCheckpointManager') inspect(id, 'checkpoint', traceInput(nodes, id, 'plan', 'plan'), 'Plan association is for authoring restoration. Its manifest output may be pinned to a different saved source.');
    if (type === 'MiniMaxH3ChainLoopStart') inspect(id, 'loop', traceProductionSource(nodes, [id, 1], 'state'));
    if (type === 'MiniMaxH3ChainReview') {
      const review = traceProductionSource(nodes, [id, 0], 'segment'); inspect(id, 'review', review);
      if (isConnection(effectiveInputs(node).pending_review) || errors(node).includes('pending_review')) {
        const pending = traceSource(nodes, effectiveInputs(node).pending_review);
        if (!errors(node).includes('pending_review') && review.status === 'resolved' && pending.status === 'resolved' && pending.slot === 0 && nodes[pending.nodeId].class_type === 'MiniMaxH3PendingReview') inspect(pending.nodeId, 'pendingReview', { ...review, path: unique([...review.path, ...pending.path]) });
        else inspect(id, 'pendingReview', failed(`Review ${id} has an unresolved deferred-review policy or production binding.`, [id]));
      }
    }
    if (type === 'MiniMaxH3ChainLoopEnd') inspect(id, 'handoff', traceProductionSource(nodes, [id, 0], 'manifest'));
    if (['MiniMaxH3ChainAssemble', 'MiniMaxH3ChainChapterDelivery'].includes(type)) inspect(id, 'delivery', traceInput(nodes, id, 'manifest', 'manifest'));
    if (type === 'MiniMaxH3ChainExportPNG') inspect(id, 'export', traceInput(nodes, id, 'manifest', 'manifest'));
  }
  const policyOwners = new Map();
  for (const [id] of planChoices(nodes)) {
    const route = policyRoute(nodes, id);
    if (route.status === 'resolved') for (const policy of route.ids) policyOwners.set(policy, [...(policyOwners.get(policy) || []), id]);
    if (id === planId) {
      roles.policy.status = route.status === 'resolved' ? 'bound' : route.status;
      if (route.reason) roles.policy.issues.push(route.reason);
      if (route.status === 'resolved') for (const policy of route.ids) inspect(policy, 'policy', { status: 'resolved', planIds: [id], loopIds: [], path: route.path });
    }
  }
  for (const item of associations) {
    if (item.status !== 'resolved') { unassigned.push(item); continue; }
    if (!item.planIds.includes(planId)) continue;
    const owners = item.role === 'policy' ? policyOwners.get(item.nodeId) : unique(associations.filter(other => other.status === 'resolved' && other.role === item.role && other.nodeId === item.nodeId).flatMap(other => other.planIds));
    const group = roles[item.role];
    if (!group.nodes.some(other => other.nodeId === item.nodeId)) group.nodes.push({ ...item, planIds: owners || item.planIds, status: owners?.length > 1 ? 'shared' : 'bound' });
  }
  for (const [role, group] of Object.entries(roles)) if (group.nodes.length) {
    group.status = group.nodes.some(item => item.status === 'shared') ? 'shared' : group.nodes.length > 1 && role !== 'policy' ? 'multiple' : 'bound';
  }
  return { version: 1, planId, roles, unassigned };
}
