import { effectiveInputs, isActiveNode, isConnection, resolvePlanBinding } from './binding-core.mjs';
import { planBranchSource, resolvePlanDocument } from './plan-source.mjs';
import { productionRoles, traceProductionSource } from './workflow-roles.mjs';

const scopeTypes = new Set(['MiniMaxH3ChainLoopStart', 'MiniMaxH3ChainPlanStudio', 'MiniMaxH3ChainPreflight']);
export const executionId = id => String(id).replaceAll('/', ':');

export function generationTargets(nodes, planId) {
  const roles = productionRoles(nodes, planId);
  return roles.roles.delivery.nodes.filter(item => nodes[item.nodeId]?.class_type === 'MiniMaxH3ChainAssemble' && item.loopIds.length === 1)
    .map(item => ({ id: item.nodeId, title: nodes[item.nodeId].title || `H3 assembly #${item.nodeId}`, loop: item.loopIds[0], path: item.path }));
}

/** Scope only the existing production graph. Native H3 still validates media/history. */
export function generationProposal(snapshot, options) {
  const { nodes } = snapshot, { plan: planId, target: targetId, start, end, verify } = options;
  const binding = resolvePlanBinding(nodes, planId), branch = planBranchSource(nodes, planId), document = resolvePlanDocument(nodes, planId);
  if (binding.status !== 'bound' || binding.project !== options.project || branch.id !== options.branch_id) throw new Error('The generation Plan, project or working branch is unresolved or changed.');
  if (document.status !== 'resolved') throw new Error(document.reason || 'The effective Plan text is unresolved.');
  let plan;
  try { plan = JSON.parse(document.text); } catch { throw new Error('The Plan is not valid JSON.'); }
  const shots = Array.isArray(plan) ? plan : plan?.shots;
  if (!Array.isArray(shots) || !shots.length) throw new Error('The Plan has no scene list.');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > shots.length) throw new Error(`Choose one continuous scene range within 1–${shots.length}.`);
  if (typeof verify !== 'boolean') throw new Error('Choose whether to verify predecessor history.');
  const target = generationTargets(nodes, planId).find(item => item.id === targetId);
  if (!target) throw new Error('Select an assembly output connected to exactly one generation loop for this Plan.');
  if (effectiveInputs(nodes[target.loop]).initial_state != null) throw new Error('Loop Start carries an imported execution state. Use its native continuation controls.');
  const roles = productionRoles(nodes, planId);
  const ends = roles.roles.handoff.nodes.filter(item => item.loopIds.includes(target.loop) && target.path.includes(item.nodeId));
  if (ends.length !== 1) throw new Error('The selected output needs one unambiguous Loop End.');
  const mode = effectiveInputs(nodes[ends[0].nodeId]).execution_mode;
  if (isConnection(mode) || ![undefined, 'recursive', 'recursive_legacy', 'top_level_requeue'].includes(mode)) throw new Error('The loop execution mode cannot be verified.');
  if (mode === 'top_level_requeue' && start !== end) throw new Error('Top-level continuation currently queues the whole workflow. Generate one scene at a time here until native handoffs retain the selected output scope.');
  const scope = [...new Set([target.loop, ...target.path.filter(id => scopeTypes.has(nodes[id]?.class_type))])];
  const edits = [];
  for (const id of scope) {
    const node = nodes[id];
    if (!isActiveNode(node)) throw new Error(`Scope node #${id} is inactive or shared.`);
    for (const [name, value] of [['start_clip', start], ['scene_range', start === end ? String(start) : `${start}:${end}`], ['verify_resume_history', verify]]) {
      if (!node.editable?.includes(name) || isConnection(effectiveInputs(node)[name])) throw new Error(`#${id}.${name} needs a directly editable native widget. Connected scope controls need their own source adapter.`);
      edits.push({ node: id, widget: name, before: node.inputs[name], after: value });
    }
    if (node.class_type === 'MiniMaxH3ChainPlanStudio' && Object.hasOwn(node.inputs, 'alternate_take_json')) {
      let alternate;
      try { alternate = JSON.parse(String(node.inputs.alternate_take_json)); } catch { throw new Error('Plan Studio has not published a queue-safe ALT state yet. Refresh its scene controls before generating.'); }
      if (alternate !== null) throw new Error('Plan Studio has an ALT draft. Clear it before generating the original scene range; ALT generation needs its own companion adapter.');
    }
  }
  const reviews = roles.roles.review.nodes.filter(item => item.loopIds.includes(target.loop) && target.path.includes(item.nodeId)).map(item => ({ id: item.nodeId, inputs: nodes[item.nodeId].inputs }));
  return { version: 1, planId, planText: document.text, project: binding.project, branch: branch.id, target, loopEnd: ends[0].nodeId, start, end, verify, edits, reviews, mode: mode || 'recursive', sceneIds: shots.slice(start - 1, end).map((shot, index) => typeof shot === 'object' && shot ? String(shot.id || `Scene ${start + index}`) : `Scene ${start + index}`) };
}

/** Verify the actual native executable graph, after serializers and queue hooks. */
export function validateGenerationPrompt(prompt, proposal) {
  const nodes = prompt?.output;
  if (!nodes || !Object.keys(nodes).length) throw new Error('Native serialization returned no executable graph.');
  const targetId = executionId(proposal.target.id), loopId = executionId(proposal.target.loop), planId = executionId(proposal.planId);
  if (nodes[targetId]?.class_type !== 'MiniMaxH3ChainAssemble') throw new Error('The selected assembly output did not survive native serialization.');
  const provenance = traceProductionSource(nodes, nodes[targetId].inputs?.manifest, 'manifest');
  if (provenance.status !== 'resolved' || provenance.planIds[0] !== planId || provenance.loopIds.length !== 1 || provenance.loopIds[0] !== loopId) throw new Error('Native serialization changed the production path. Nothing was submitted.');
  const branch = planBranchSource(nodes, planId);
  if (branch.id !== proposal.branch || resolvePlanBinding(nodes, planId).project !== proposal.project) throw new Error('Native serialization changed the project or working branch. Nothing was submitted.');
  const document = resolvePlanDocument(nodes, planId);
  if (document.status !== 'resolved' || document.text !== proposal.planText) throw new Error('Native serialization changed the reviewed Plan. Nothing was submitted.');
  if ((nodes[executionId(proposal.loopEnd)]?.inputs?.execution_mode || 'recursive') !== proposal.mode || nodes[loopId]?.inputs?.initial_state != null) throw new Error('Native serialization changed the loop continuation state or mode. Nothing was submitted.');
  for (const edit of proposal.edits) if (nodes[executionId(edit.node)]?.inputs?.[edit.widget] !== edit.after) throw new Error(`Native serialization changed ${edit.node}.${edit.widget}. Nothing was submitted.`);
  const seen = new Set();
  function visit(id) {
    if (seen.has(id)) return; seen.add(id);
    const node = nodes[id]; if (!node) throw new Error(`Native execution has a missing dependency #${id}.`);
    if (node.class_type === 'MiniMaxH3ChainLoopStart' && id !== loopId) throw new Error('This output also depends on another generation loop. Choose a separate production output.');
    if (node.class_type === 'MiniMaxH3ChainPlanStudio' && Object.hasOwn(node.inputs, 'alternate_take_json')) {
      let alternate; try { alternate = JSON.parse(node.inputs.alternate_take_json); } catch { /* Rejected below. */ }
      if (alternate !== null) throw new Error('The serialized Studio has an armed or unresolved ALT draft. Nothing was submitted.');
    }
    for (const value of Object.values(node.inputs || {})) if (isConnection(value)) visit(String(value[0]));
  }
  visit(targetId);
  // H3 recursive expansion inspects all output nodes in the original prompt,
  // even when ComfyUI receives partial_execution_targets. Keep the native
  // serialized nodes intact, but omit everything outside this dependency set.
  // The full native workflow metadata remains available for reproduction.
  return { target: targetId, prompt: { ...prompt, output: Object.fromEntries(Object.entries(nodes).filter(([id]) => seen.has(id))) } };
}
