export function assertQueueGraph(graph) {
  // The frontend's promoted-widget controls are store-backed and are not
  // covered by H3's exported queue helper. Require a native adapter for them.
  if ((graph.nodes ?? graph._nodes ?? []).some(node => node.subgraph || node.isSubgraphNode?.())) throw new Error('Scene generation in subgraphs needs a native promoted-widget queue adapter. Use ComfyUI to queue this workflow.');
}

/** Uses H3's queue hooks and ComfyUI's serializer/API, then scopes native output. */
export async function submitBoundGeneration({ app, api, hooks, graph, current, validate, delivering, label = 'Generation' }) {
  current('before-hooks');
  assertQueueGraph(graph);
  if (app.processingQueue) throw new Error('ComfyUI is preparing another queue request. Wait for it to finish.');
  hooks.runBeforeQueuedHooks(graph, { isPartialExecution: true });
  current('after-hooks');
  const prompt = await app.graphToPrompt(graph);
  current('serialized');
  if (app.processingQueue) throw new Error('Another native queue request started during preparation. Nothing was submitted.');
  const scoped = validate(prompt);
  const widgets = [...new Set((graph.nodes ?? graph._nodes ?? []).flatMap(node => node.widgets ?? []))];
  delivering();
  let result;
  try { result = await api.queuePrompt(0, scoped.prompt, { partialExecutionTargets: [scoped.target] }); }
  catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    // ComfyUI puts node-specific validation details in PromptExecutionError's
    // formatter; its ordinary message only says "Prompt execution failed".
    if (thrown?.response && thrown.toString !== Error.prototype.toString) error.message = String(thrown) || error.message;
    // The native API distinguishes an HTTP rejection from transport loss.
    if (thrown?.status >= 400 && thrown.status < 500) error.outcome = 'rejected';
    throw error;
  }
  const promptId = String(result?.prompt_id || '');
  if (!promptId) throw new Error('ComfyUI returned no prompt ID. Submission is uncertain; check the queue before trying again.');
  let warning = '';
  try {
    current('accepted');
    for (const widget of widgets) widget.afterQueued?.({ isPartialExecution: true });
    app.canvas?.setDirty?.(true, true);
  } catch { warning = `${label} was accepted, but the native after-queue controls could not finish. Check the original workflow before another run.`; }
  return { prompt_id: promptId, target: scoped.target, warning };
}
