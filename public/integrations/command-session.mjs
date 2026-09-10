const reads = new Set(['snapshot', 'export', 'focus', 'checkpoint-preview']);

// Receipts live in the parent tab, so a companion refresh can recover the
// outcome without replaying a mutation. They are not durable H3 job records.
export function createCommandSession(adapter, publish = () => {}, { limit = 100, maxIds = 10000, now = () => Date.now() } = {}) {
  const records = new Map(), seen = new Set();
  let processing = false;
  const recent = () => [...records.values()].map(value => ({ ...value }));
  const update = receipt => {
    records.set(receipt.id, receipt);
    while (records.size > limit) records.delete(records.keys().next().value);
    publish({ ...receipt });
  };
  async function execute(id, command) {
    if (!id || typeof id !== 'string' || id.length > 128 || !command || typeof command.action !== 'string') return { error: 'Invalid companion command.', outcome: 'rejected' };
    if (command.action === 'command-status') return { result: { data: records.get(command.request_id) || null } };
    if (seen.has(id)) return { error: 'This action ID was already accepted. Check its receipt and current ComfyUI state instead of submitting it again.', outcome: records.get(id)?.status || 'uncertain', receipt: records.get(id) };
    if (processing && command.action !== 'snapshot') return { error: 'Another companion action is in progress.', outcome: 'rejected' };
    const tracked = !reads.has(command.action);
    if (tracked && seen.size >= maxIds) return { error: 'This companion session has reached its action limit. Reopen SceneWeaver from ComfyUI.', outcome: 'rejected' };
    if (tracked) seen.add(id);
    const receipt = { id, action: command.action, binding: command.binding, plan: command.plan || '', project: command.project || '', branch: command.branch_id || '', revision: command.revision, status: 'running', startedAt: now() };
    if (tracked) update(receipt);
    // Snapshot/status reads remain available while a long upload/save runs.
    const locks = command.action !== 'snapshot';
    if (locks) processing = true;
    try {
      const result = await adapter.command(command);
      const completed = { ...receipt, ...(result?.prompt_id ? { prompt_id: result.prompt_id } : {}), status: result?.warning ? 'partial' : 'succeeded', finishedAt: now(), message: result?.warning || '' };
      if (tracked) update(completed);
      return { result, ...(tracked ? { receipt: completed } : {}) };
    } catch (error) {
      const completed = { ...receipt, status: error.outcome === 'rejected' ? 'rejected' : 'uncertain', finishedAt: now(), message: error.message || String(error) };
      if (tracked) update(completed);
      return { error: completed.message, outcome: completed.status, ...(tracked ? { receipt: completed } : {}) };
    } finally { if (locks) processing = false; }
  }
  return { execute, recent, get processing() { return processing; } };
}
