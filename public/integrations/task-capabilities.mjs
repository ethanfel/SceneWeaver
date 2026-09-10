import { resolvePlanBinding } from './binding-core.mjs';
import { needsPlanSourceAdapter, planBranchSource, resolvePlanDocument } from './plan-source.mjs';

// Availability means the companion has a command adapter, not that permission,
// media validation, or a later native request has already succeeded.
export function planTaskCapabilities(snapshot, planId) {
  const caps = snapshot.capabilities || {}, nodes = snapshot.nodes;
  const binding = resolvePlanBinding(nodes, planId), document = resolvePlanDocument(nodes, planId);
  const projectReady = ['bound', 'unmanaged'].includes(binding.status);
  const bindingReason = binding.issues.join(' ') || 'Select the production Plan.';
  const bridgeReady = !needsPlanSourceAdapter(nodes) || caps.planSourceVersion === 1;
  const writablePlan = bridgeReady && projectReady && document.status === 'resolved' && document.editable;
  const planReason = !bridgeReady ? 'Refresh the ComfyUI tab and reopen SceneWeaver to load connected Plan-source support.' : !projectReady ? bindingReason : document.reason || 'The effective Plan text source is read-only.';
  const branch = planBranchSource(nodes, planId);
  const branchReady = branch.id && (branch.id === 'main' || caps.workingBranches);
  const managed = binding.status === 'bound' && branchReady;
  const managedReason = !branch.id ? branch.reason : !branchReady ? 'Named branches are not supported by the installed helper contract.' : bindingReason;
  const nativeRestore = document.status === 'resolved' && document.nodeId === planId && document.widget === 'plan_json' && document.editable;
  const nativeOwnership = caps.ownership === true;
  const assetsReady = binding.status === 'bound' && (nativeOwnership || !nodes[binding.managerId]?.requiresOwnership);
  const tasks = [];
  const task = (id, label, ready, detail) => tasks.push({ id, label, status: ready ? 'available' : 'unavailable', detail });
  task('patch', 'Apply Plan draft', writablePlan, writablePlan ? `Edits the effective text source ${document.nodeId}.${document.widget} through native callbacks. Shared consumers require review; applying does not save branch authoring.` : planReason);
  task('workflow-save', 'Save workflow file', snapshot.workflowFile?.canSave, snapshot.workflowFile?.canSave ? 'Saves the existing native workflow file. Apply outstanding drafts first.' : snapshot.workflowFile?.reason || 'Native workflow file saving is not available.');
  task('queue', 'Queue whole workflow', projectReady && caps.nativeQueue, !projectReady ? bindingReason : caps.nativeQueue ? 'Uses the native ComfyUI queue hooks. Every active output in the workflow may execute; this is not a selected-scene action.' : 'The native queue function is unavailable.');
  task('asset-update', 'Manage project assets', assetsReady, assetsReady ? 'Upload, import, and edit project-shared asset metadata. H3 checks ownership and current values when writing.' : binding.status !== 'bound' ? bindingReason : 'This Carousel requires an ownership helper that could not be loaded.');
  task('asset-audio-tracks', 'Bind synchronized audio tracks', binding.status === 'bound' && caps.audioTracks, binding.status !== 'bound' ? bindingReason : caps.audioTracks ? 'Uses native full-mix / vocals / instrumental bindings. It does not change player monitoring.' : 'Native audio-track and ownership helpers are required.');
  task('take-final-cut', 'Choose saved final-cut picture', managed && caps.finalCut, !managed ? managedReason : caps.finalCut ? 'Saves an eligible existing picture take using the current editorial revision.' : 'Revision-checked final-cut and ownership integration is unavailable.');
  task('checkpoint-preview', 'Preview / restore checkpoint lineage', managed && nativeRestore && caps.checkpoints, !managed ? managedReason : !nativeRestore ? 'Native restoration targets the Plan backing widget. A connected or read-only text source needs a source-aware restoration adapter.' : caps.checkpoints ? 'Previews the selected saved lineage before restoring it. Requires an idle native queue and current project state.' : 'Native checkpoint restoration and ownership helpers are required.');
  task('branch-save', 'Save / switch working branch', false, 'A dedicated native branch command adapter is still required. Workflow file saving does not save branch authoring.');
  task('generate-range', 'Generate selected scene / range', false, 'Loop nodes can be inspected, but validated range commands are not implemented yet.');
  task('deliver', 'Run an isolated delivery', false, 'Assembly nodes can be inspected. Queuing the whole workflow is not an isolated delivery command.');
  task('finish', 'Run finishing recipe', false, 'Requires exact saved-source selection and a native processing recipe adapter.');
  return { version: 1, planId, tasks };
}

export function unregisteredNodes(snapshot, schemas) {
  if (!schemas || !Object.keys(schemas).length) return [];
  return Object.entries(snapshot.nodes).filter(([, node]) => !node.virtual && !Object.hasOwn(schemas, node.class_type))
    .map(([nodeId, node]) => ({ nodeId, classType: node.class_type }));
}
