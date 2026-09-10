// ComfyUI frontend 1.51: capture through its tracker and persist the exact
// workflow object through the exposed workflow store. Never use a global Save
// command that could target whichever tab becomes active after an await.
export function workflowFileStatus(app) {
  const store = app.extensionManager?.workflow, workflow = store?.activeWorkflow;
  const state = workflow?.isTemporary === true ? 'temporary' : workflow?.isPersisted === true
    ? workflow.isModified === true ? 'modified' : workflow.isModified === false ? 'saved' : 'unknown' : 'unknown';
  const supported = typeof store?.saveWorkflow === 'function' && typeof workflow?.changeTracker?.prepareForSave === 'function';
  const canSave = supported && workflow?.isPersisted === true && typeof workflow.path === 'string' && workflow.path.startsWith('workflows/');
  return { path: typeof workflow?.path === 'string' ? workflow.path : '', state, canSave,
    reason: !supported ? 'This ComfyUI frontend does not expose the supported workflow-save interface.'
      : !canSave ? 'Name and save this workflow in ComfyUI once before saving it here.' : '' };
}

export async function saveWorkflowFile(app, assertCurrent, beforeWrite = () => {}) {
  const status = workflowFileStatus(app);
  if (!status.canSave) throw new Error(status.reason);
  const store = app.extensionManager.workflow, workflow = store.activeWorkflow;
  if (store.isBusy) throw new Error('ComfyUI is already changing or saving a workflow. Wait for it to finish.');
  assertCurrent();
  workflow.changeTracker.prepareForSave();
  assertCurrent();
  // Save this object, not a subsequent activeWorkflow value.
  beforeWrite();
  await store.saveWorkflow(workflow);
  if (workflow.path !== status.path) return { path: status.path, warning: 'The workflow path changed during saving. Check the saved file in ComfyUI before saving again.' };
  let warning;
  try { assertCurrent(); }
  catch {
    // Native save resets its dirty marker on completion. New edits must remain
    // visibly unsaved if the graph changed while persistence was in flight.
    workflow.isModified = true;
    warning = 'The workflow save completed, but its graph or active tab changed during saving. Review the current workflow before continuing.';
  }
  return { path: status.path, ...(warning ? { warning } : {}) };
}
