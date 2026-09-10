import { effectiveInputs, isActiveNode, isConnection, planChoices, PLAN_TYPES, traceSource } from './binding-core.mjs';

const errors = node => node.inputErrors ?? node._meta?.inputErrors ?? [];
const metadata = (node, name) => node[name] ?? node._meta?.[name];
const fail = (reason, path = []) => ({ status: 'unresolved', reason, path, text: null, nodeId: '', widget: '' });
const key = source => `${source.nodeId}:${source.widget}`;
const ROUTING = ['Reroute', 'Reroute (rgthree)', 'GetNode', 'SetNode'];
const TEXT = ['PrimitiveString', 'PrimitiveStringMultiline'];

export function needsPlanSourceAdapter(nodes) {
  return planChoices(nodes).some(([, node]) => isConnection(node.inputs.plan_json) || errors(node).includes('plan_json')
    || node.class_type !== 'MiniMaxH3ChainPlanStudio' && (Object.hasOwn(node.inputs, 'plan_json_input') || errors(node).includes('plan_json_input')));
}

export function stringInputSource(nodes, nodeId, widget, seen = new Set()) {
  const node = nodes[nodeId], identity = `${nodeId}:${widget}`;
  if (!node || !isActiveNode(node)) return fail(`Text source ${nodeId} is missing, inactive, or shared across subgraph instances.`, [nodeId]);
  if (seen.has(identity) || seen.size >= 128) return fail('The text connection is cyclic or exceeds the inspection limit.', [nodeId]);
  const next = new Set(seen); next.add(identity);
  if (errors(node).includes(widget)) return fail(`Input ${nodeId}.${widget} has a broken connection.`, [nodeId]);
  const value = effectiveInputs(node)[widget];
  if (typeof value === 'string') {
    if (metadata(node, 'runtimeText')?.includes(widget)) return fail(`Input ${nodeId}.${widget} is transformed during native serialization; its runtime text is not known yet.`, [nodeId]);
    return { status: 'resolved', text: value, nodeId, widget, path: [nodeId], editable: metadata(node, 'editable')?.includes(widget) ?? true };
  }
  if (!isConnection(value)) return fail(`Input ${nodeId}.${widget} has no supported literal text.`, [nodeId]);
  const traced = traceSource(nodes, value), path = [nodeId, ...traced.path];
  if (traced.status !== 'resolved') return { ...fail(traced.reason, path), status: traced.status };
  const upstream = nodes[traced.nodeId];
  if (traced.slot !== 0) return fail(`Output ${traced.nodeId}:${traced.slot} has no supported literal-text contract.`, path);
  let input;
  if (TEXT.includes(upstream.class_type)) input = 'value';
  else if (upstream.class_type === 'PrimitiveNode') input = metadata(upstream, 'literalWidget');
  if (!input) return fail(`${upstream.class_type} #${traced.nodeId} produces text at runtime or needs a source adapter. The Plan fallback is not its effective output.`, path);
  const source = stringInputSource(nodes, traced.nodeId, input, next);
  return { ...source, path: [...new Set([...path, ...source.path])] };
}

export function resolvePlanDocument(nodes, planId) {
  const node = nodes[planId];
  if (!node || !PLAN_TYPES.includes(node.class_type)) return { ...fail('Select an H3 authoring Plan.'), planId, input: '', fallback: false };
  if (!planChoices(nodes).some(([id]) => id === planId)) return { ...fail('Select the upstream authoring Plan instead of this connected Studio.'), planId, input: '', fallback: false };
  let override = null;
  if (node.class_type !== 'MiniMaxH3ChainPlanStudio' && (Object.hasOwn(node.inputs, 'plan_json_input') || errors(node).includes('plan_json_input'))) {
    override = stringInputSource(nodes, planId, 'plan_json_input');
    if (override.status !== 'resolved') return { ...override, planId, input: 'plan_json_input', fallback: false };
    if (override.text.trim()) return { ...override, planId, input: 'plan_json_input', fallback: false };
  }
  return { ...stringInputSource(nodes, planId, 'plan_json'), planId, input: 'plan_json', fallback: Boolean(override), ...(override ? { emptyOverride: override } : {}) };
}

export function planBranchSource(nodes, planId) {
  const node = nodes[planId], source = resolvePlanDocument(nodes, planId);
  if (source.status !== 'resolved') return { id: '', reason: source.reason };
  // Standalone Studio's dedicated branch input is authoritative. Ordinary
  // Plans carry branch identity in the effective serialized document.
  if (node.class_type === 'MiniMaxH3ChainPlanStudio' && Object.hasOwn(node.inputs, 'working_branch_id')) {
    const branch = stringInputSource(nodes, planId, 'working_branch_id');
    if (branch.status !== 'resolved') return { id: '', reason: branch.reason };
    return validBranch(branch.text);
  }
  try {
    const document = JSON.parse(source.text);
    if (source.emptyOverride?.text && document?._branch_id && document._branch_id !== 'main') return { id: '', reason: 'The override contains only whitespace while the fallback selects a named branch. Native Plan parsing and branch scoping differ here; clear the override to an empty string in ComfyUI.' };
    return validBranch(document?._branch_id || 'main');
  } catch { return { id: '', reason: 'The effective Plan JSON is invalid; its working branch cannot be verified.' }; }
}

function validBranch(value) {
  return typeof value === 'string' && (value === 'main' || /^[0-9a-f]{32}$/.test(value))
    ? { id: value, reason: '' } : { id: '', reason: 'The effective Plan has an invalid working branch identity.' };
}

export function textConsumers(nodes, source) {
  const result = [];
  if (source.status !== 'resolved') return result;
  for (const [id, node] of Object.entries(nodes)) {
    if (!isActiveNode(node) || ROUTING.includes(node.class_type) || TEXT.includes(node.class_type) || node.class_type === 'PrimitiveNode' || metadata(node, 'outputSources')) continue;
    for (const [name, value] of Object.entries(effectiveInputs(node))) {
      if (!isConnection(value) && !(id === source.nodeId && name === source.widget)) continue;
      const incoming = stringInputSource(nodes, id, name);
      if (incoming.status === 'resolved' && key(incoming) === key(source)) result.push({ node: id, widget: name });
    }
  }
  return result.sort((a, b) => `${a.node}:${a.widget}`.localeCompare(`${b.node}:${b.widget}`));
}

export function sharedPlanEdits(nodes, edits) {
  const documents = planChoices(nodes).map(([id]) => resolvePlanDocument(nodes, id));
  return edits.flatMap(edit => {
    // Include a blank connected override too: changing it can become the Plan.
    const plans = documents.filter(source => [source, source.emptyOverride].some(item => item?.status === 'resolved' && item.nodeId === edit.node && item.widget === edit.widget));
    if (!plans.length) return [];
    const source = stringInputSource(nodes, edit.node, edit.widget), consumers = textConsumers(nodes, source);
    return consumers.length > 1 ? [{ node: edit.node, widget: edit.widget, plans: plans.map(source => source.planId), consumers }] : [];
  });
}

export function validatePlanSourceEdits(nodes, edits, acknowledged = []) {
  const next = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { ...node, inputs: { ...node.inputs } }]));
  for (const edit of edits) next[edit.node].inputs[edit.widget] = edit.after;
  for (const [id] of planChoices(nodes)) {
    const before = planBranchSource(nodes, id), after = planBranchSource(next, id);
    if (before.id && before.id !== after.id || !before.id && after.id && after.id !== 'main') throw new Error(`Plan ${id} would change its working branch or make its identity unknown. Switch branches through the native branch controls.`);
  }
  for (const shared of sharedPlanEdits(nodes, edits)) {
    const accepted = Array.isArray(acknowledged) && acknowledged.some(item => item.node === shared.node && item.widget === shared.widget && JSON.stringify(item.consumers) === JSON.stringify(shared.consumers));
    if (!accepted) throw new Error('Review every consumer of the shared Plan source before applying this draft.');
  }
}
