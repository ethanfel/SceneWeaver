import { branchPath, verifyBranch } from './branches-core.mjs';

const endpoint = '/minimax_h3_context_loop/prompt-history';
const revisionId = value => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
function validateHistory(history, command) {
  if (history?.format !== 'h3_scene_prompt_history_v1' || history.run_name !== command.project || history.scene_id !== command.scene_id || !Array.isArray(history.revisions)) throw new Error('H3 returned prompt history for an unexpected scene or project.');
  verifyBranch(history, command.branch_id);
  const ids = history.revisions.map(item => item?.id);
  if (ids.some(id => !revisionId(id)) || new Set(ids).size !== ids.length || history.active_revision && !ids.includes(history.active_revision)) throw new Error('H3 prompt history has invalid revision identities.');
  return history;
}
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v => v.toString(16).padStart(2, '0')).join('');

export function createPromptHistory({ api, native, verify, write }) {
  const pending = new Map();
  const key = command => JSON.stringify([command.binding, command.plan, command.project, command.branch_id, command.scene_id]);
  const path = (command, extra = {}) => branchPath(`${endpoint}?${new URLSearchParams({ run_name: command.project, scene_id: command.scene_id, ...extra })}`, command.branch_id);
  async function get(command, extra) {
    verify(command);
    const response = await api.fetchApi(path(command, extra)), data = await response.json();
    if (!response.ok) throw new Error(data.error || `Cannot read prompt history (HTTP ${response.status}).`);
    verify(command); return data;
  }
  const present = (history, command) => ({ history, tree: native.promptRevisionTree(history, { includeArchived: true }), writable: history.command_version === 1 && /^[0-9a-f]{64}$/.test(history.history_revision || ''), pending: pending.has(key(command)) ? { action: pending.get(key(command)).action, operation_id: pending.get(key(command)).operation_id } : null });
  async function inspect(command) {
    const current = pending.get(key(command));
    const data = await get(command, current ? { operation_id: current.operation_id } : {});
    const history = validateHistory(current ? data.history : data, command);
    let message = '';
    if (current && data.receipt) {
      if (data.receipt.operation_id !== current.operation_id) throw new Error('H3 returned a different operation receipt.');
      pending.delete(key(command)); message = 'The pending history command committed. Current history is shown.';
    }
    return { ...present(history, command), message };
  }
  async function revision(command) {
    if (!revisionId(command.revision_id)) throw new Error('Choose a saved prompt revision.');
    const history = validateHistory(await get(command), command);
    const meta = history.revisions.find(item => item.id === command.revision_id);
    if (!meta) throw new Error('This prompt revision is no longer in the scene history.');
    const value = await get(command, { revision: meta.id });
    verifyBranch(value, command.branch_id);
    if (value.format !== history.format || value.id !== meta.id || typeof value.prompt !== 'string' || await digest(value.prompt) !== meta.prompt_sha256 || value.history_revision && value.history_revision !== history.history_revision) throw new Error('The saved prompt changed while loading. Refresh its history.');
    verify(command);
    return { ...present(history, command), revision: value };
  }
  async function mutate(command) {
    verify(command);
    let body = pending.get(key(command));
    if (command.retry) {
      if (!body || body.operation_id !== command.operation_id) throw new Error('No matching pending history command is retained in this ComfyUI tab.');
    } else {
      if (body) throw new Error('Check the pending history command before sending a new one.');
      const history = validateHistory(await get(command), command);
      if (!present(history, command).writable) throw new Error('Update H3 for conditional prompt-history commands. Reading and restoring text remain available.');
      if (command.base_revision !== history.history_revision) throw new Error('Prompt history changed. Reload and review before saving.');
      if (!['save', 'fork', 'activate', 'label', 'archive', 'delete'].includes(command.history_action)) throw new Error('Unsupported prompt history action.');
      const meta = history.revisions.find(item => item.id === command.revision_id);
      if (command.history_action !== 'save' && !meta) throw new Error('Choose a saved prompt revision.');
      if (['save', 'fork'].includes(command.history_action) && (typeof command.prompt !== 'string' || command.prompt.length > 200_000)) throw new Error('Prompt history accepts at most 200,000 characters.');
      body = { command_version: 1, operation_id: crypto.randomUUID().replaceAll('-', ''), base_revision: history.history_revision,
        run_name: command.project, scene_id: command.scene_id, action: command.history_action,
        ...(meta ? { revision: meta.id } : {}),
        ...(['save', 'fork'].includes(command.history_action) ? { prompt: command.prompt, parent_revision: history.active_revision } : {}),
        ...(command.history_action === 'label' ? { label: command.label } : {}),
        ...(command.history_action === 'archive' ? { archived: command.archived } : {}) };
      pending.set(key(command), body);
    }
    try {
      const result = await write(command, endpoint, body);
      const history = validateHistory(result.data.history, command);
      if (result.data.receipt?.operation_id !== body.operation_id) throw new Error('H3 did not confirm the history operation. Check its result before retrying.');
      pending.delete(key(command));
      return { ...result, data: { ...present(history, command), receipt: result.data.receipt, replayed: result.data.replayed } };
    } catch (error) {
      // These native rejections occur before any history mutation. Transport
      // failures retain the exact body/ID for receipt checking and safe replay.
      if ([400, 409, 423].includes(error.httpStatus)) { pending.delete(key(command)); error.outcome = 'rejected'; }
      throw error;
    }
  }
  return { inspect, revision, mutate };
}
