// Shared inspection rules. These never flatten or rewrite the native graph.
export const PLAN_TYPES = ['MiniMaxH3ChainPlan', 'MiniMaxH3ChainPlanModern', 'MiniMaxH3ChainPlanStudio'];
const CAROUSEL = 'MiniMaxH3ProjectAssetManager';
const STUDIO = 'MiniMaxH3ChainPlanStudio';
const link = value => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1]);
const graphScope = id => id.slice(0, id.lastIndexOf('/') + 1);
const live = node => (node.scopeActive ?? node._meta?.scopeActive) !== false && ![2, 4].includes(Number(node.mode ?? node._meta?.mode ?? 0));
const effectiveInputs = node => ({ ...node.inputs, ...(node.inputSources ?? node._meta?.inputSources) });
const failure = (reason, path = [], status = 'unresolved') => ({ status, reason, path });
export { link as isConnection, live as isActiveNode, effectiveInputs };

export function traceSource(nodes, source) {
  const path = [], seen = new Set();
  let current = source;
  while (link(current)) {
    const [id, slot] = current, node = nodes[id];
    const key = `${id}:${slot}`;
    if (seen.has(key) || path.length >= 128) return failure('The connection contains a cycle or exceeds the inspection limit.', path);
    seen.add(key); path.push(id);
    if (!node) return failure(`Connection source ${id} is unavailable.`, path);
    if (!live(node)) return failure(`Node ${id} is muted or bypassed; its effective routing needs an adapter.`, path);
    const outputs = node.outputSources ?? node._meta?.outputSources;
    if (outputs) {
      if (!link(outputs[slot])) return failure(`Subgraph ${id} output ${slot} has no supported source.`, path);
      current = outputs[slot]; continue;
    }
    if (node.class_type === 'GetNode') {
      const key = node.inputs.Constant;
      if (slot !== 0) return failure(`Get node ${id} has an unsupported output slot.`, path);
      if (typeof key !== 'string' || !key) return failure(`Get node ${id} has no literal bus name.`, path);
      let scope = graphScope(id), matches = [];
      const ancestors = node.routing?.busAncestors ?? node._meta?.routing?.busAncestors;
      while (true) {
        matches = Object.entries(nodes).filter(([candidate, item]) => graphScope(candidate) === scope && item.class_type === 'SetNode' && item.inputs.Constant === key);
        if (matches.length || !scope || !ancestors) break;
        scope = graphScope(scope.slice(0, -1));
      }
      if (matches.length !== 1) return failure(`Bus “${key}” has ${matches.length} Set nodes in its supported scope.`, path, matches.length > 1 ? 'ambiguous' : 'unresolved');
      if (scope !== graphScope(id)) {
        const visible = Object.entries(nodes).filter(([candidate, item]) => graphScope(id).startsWith(graphScope(candidate)) && item.class_type === 'SetNode' && item.inputs.Constant === key);
        if (visible.length !== 1) return failure(`Bus “${key}” has multiple Set nodes in ancestor scopes.`, path, 'ambiguous');
      }
      current = [matches[0][0], 0]; continue;
    }
    if (['Reroute', 'Reroute (rgthree)', 'SetNode'].includes(node.class_type)) {
      const sources = Object.values(effectiveInputs(node)).filter(link);
      if ((node.inputErrors ?? node._meta?.inputErrors)?.length || sources.length !== 1 || slot !== 0) return failure(`Routing node ${id} does not have one supported source.`, path);
      current = sources[0]; continue;
    }
    return { status: 'resolved', nodeId: id, slot, path };
  }
  return failure('This input has no inspectable connection.', path);
}

export function planChoices(nodes) {
  return Object.entries(nodes).filter(([, node]) => PLAN_TYPES.includes(node.class_type)
    && !(node.class_type === STUDIO && (link(node.inputs.plan) || (node.inputErrors ?? node._meta?.inputErrors)?.includes('plan'))));
}

// Native Plan outputs are carried through these authoring/presentation nodes.
// This is data provenance only: a Studio or editor can change the effective
// Plan, so the path must remain visible to future authoring/preflight actions.
export function tracePlanSource(nodes, source) {
  const path = [], seen = new Set();
  let current = source;
  while (path.length < 128) {
    const traced = traceSource(nodes, current);
    path.push(...traced.path);
    if (traced.status !== 'resolved') return { ...traced, path };
    const { nodeId: id, slot } = traced, node = nodes[id];
    if (seen.has(id)) return failure('The Plan connection contains a cycle.', path);
    seen.add(id);
    if (slot !== 0) return failure(`Node ${id} output ${slot} is not a supported Plan output.`, path);
    const carriesPlan = ['MiniMaxH3ChainScenePromptEditor', 'MiniMaxH3ChainRichScenePromptEditor', 'MiniMaxH3ChainPreflight', STUDIO].includes(node.class_type);
    if (carriesPlan && (node.inputErrors ?? node._meta?.inputErrors)?.includes('plan')) return failure(`Node ${id} has a broken Plan connection.`, path);
    if (carriesPlan && link(effectiveInputs(node).plan)) { current = effectiveInputs(node).plan; continue; }
    if (PLAN_TYPES.includes(node.class_type)) return { ...traced, path };
    return failure(`Node ${id} (${node.class_type}) has no supported upstream Plan.`, path);
  }
  return failure('The Plan connection exceeds the inspection limit.', path);
}

export function resolvePlanBinding(nodes, planId) {
  const node = nodes[planId];
  const result = { planId, project: '', managerId: '', status: 'unresolved', method: '', assetPath: [], studioIds: [], issues: [] };
  if (!node || !PLAN_TYPES.includes(node.class_type)) return { ...result, issues: ['Select an H3 Plan to identify its project.'] };
  if (node.class_type === STUDIO && (node.inputErrors ?? node._meta?.inputErrors)?.includes('plan')) return { ...result, issues: ['The Studio upstream Plan connection is missing.'] };
  if (node.class_type === STUDIO && link(node.inputs.plan)) {
    const source = tracePlanSource(nodes, effectiveInputs(node).plan);
    return { ...result, issues: [source.status === 'resolved' && PLAN_TYPES.includes(nodes[source.nodeId]?.class_type)
      ? `This Studio displays upstream Plan ${source.nodeId}. Select that Plan for authoring.`
      : `The Studio upstream Plan cannot be identified. ${source.reason || ''}`.trim()] };
  }
  result.studioIds = Object.entries(nodes).filter(([, item]) => item.class_type === STUDIO && live(item) && link(item.inputs.plan)
    && tracePlanSource(nodes, effectiveInputs(item).plan).nodeId === planId).map(([id]) => id);
  if (node.class_type === STUDIO) result.studioIds.unshift(planId);
  if (!live(node)) return { ...result, issues: ['The selected Plan or its subgraph is inactive or shared across instances. Its project is not bound for operations.'] };
  if ((node.inputErrors ?? node._meta?.inputErrors)?.includes('project_assets')) return { ...result, issues: ['The Plan has a project-assets connection whose source is missing.'] };
  if (link(node.inputs.project_assets)) {
    const source = traceSource(nodes, effectiveInputs(node).project_assets);
    result.assetPath = source.path;
    if (source.status !== 'resolved') return { ...result, status: source.status, issues: [source.reason] };
    const owner = nodes[source.nodeId];
    if (owner.class_type !== CAROUSEL || source.slot !== 0) return { ...result, issues: [`Project assets resolve to ${owner.class_type} #${source.nodeId}, not a supported Asset Carousel output.`] };
    if (typeof owner.inputs.run_name !== 'string' || !owner.inputs.run_name.trim()) return { ...result, issues: ['The connected Carousel project name is empty or controlled by a connection.'] };
    return { ...result, status: 'bound', method: 'connection', project: owner.inputs.run_name, managerId: source.nodeId };
  }
  if (typeof node.inputs.run_name !== 'string' || !node.inputs.run_name.trim()) return { ...result, issues: ['The Plan project name is empty or controlled by a connection.'] };
  result.project = node.inputs.run_name;
  const matches = Object.entries(nodes).filter(([, item]) => item.class_type === CAROUSEL && item.inputs.run_name === result.project && live(item));
  if (matches.length > 1) return { ...result, status: 'ambiguous', issues: ['Several Asset Carousels use this project name. Connect the intended Carousel to the Plan to bind it.'] };
  if (!matches.length) return { ...result, status: 'unmanaged', issues: ['No active Asset Carousel is bound to this Plan. Project mutation controls are unavailable.'] };
  return { ...result, status: 'bound', method: 'project-name', managerId: matches[0][0] };
}

export function workflowBindings(nodes) {
  return { version: 1, plans: planChoices(nodes).map(([id]) => resolvePlanBinding(nodes, id)) };
}
