// Browser fixture only; the real Python store/HTTP tests cover disk persistence.
import { createHash, randomUUID } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');
export function promptHistoryFixture() {
  const entries = new Map(); let actions = [], legacy = false, ignoreBranch = false, failure = '';
  const entry = (run, scene, branch = 'main') => {
    const key = JSON.stringify([run, scene, branch]);
    if (!entries.has(key)) {
      const first = { id: 'a'.repeat(32), parent_id: null, label: 'Executed opening', prompt: 'Saved first prompt.\n\nKeep the rain.', executed_at: '2026-09-09T12:00:00Z', created_at: '2026-09-09T11:00:00Z', archived_at: null };
      const second = { id: 'b'.repeat(32), parent_id: first.id, label: 'Draft variation', prompt: 'A different saved prompt.', executed_at: null, created_at: '2026-09-09T13:00:00Z', archived_at: null };
      entries.set(key, { format: 'h3_scene_prompt_history_v1', run_name: run, scene_id: scene, working_branch_id: branch, active_revision: branch === 'main' ? second.id : null, values: branch === 'main' ? [first, second] : [], receipts: {} });
    }
    return entries.get(key);
  };
  const listing = state => {
    const value = { format: state.format, run_name: state.run_name, scene_id: state.scene_id, working_branch_id: state.working_branch_id,
      active_revision: state.active_revision, revisions: state.values.map(({ prompt, ...meta }) => ({ ...meta, prompt_sha256: hash(prompt) })) };
    return legacy ? value : { ...value, command_version: 1, history_revision: hash(JSON.stringify(value)) };
  };
  async function handle(path, options = {}) {
    const url = new URL(path, 'http://mock'), body = options.body ? JSON.parse(options.body) : null;
    const run = url.searchParams.get('run_name') || body?.run_name, scene = url.searchParams.get('scene_id') || body?.scene_id;
    const branch = ignoreBranch ? 'main' : url.searchParams.get('branch_id') || 'main';
    const state = entry(run, scene, branch), history = listing(state);
    if (!body) {
      const operation = url.searchParams.get('operation_id'), id = url.searchParams.get('revision');
      if (operation) return Response.json({ history, receipt: state.receipts[operation] || null });
      if (id) {
        const value = state.values.find(item => item.id === id);
        return value ? Response.json({ ...value, format: history.format, run_name: run, scene_id: scene, working_branch_id: branch, prompt_sha256: hash(value.prompt), history_revision: history.history_revision }) : Response.json({ error: 'Missing revision' }, { status: 400 });
      }
      return Response.json(history);
    }
    if (failure === 'before') { failure = ''; throw new Error('Simulated dropped request'); }
    if (failure === 'conflict') { failure = ''; return Response.json({ error: 'Prompt history changed. Reload and review it.' }, { status: 409 }); }
    if (failure === 'ownership') { failure = ''; return Response.json({ error: 'Project is read-only.' }, { status: 423 }); }
    if (state.receipts[body.operation_id]) return Response.json({ history, receipt: state.receipts[body.operation_id], replayed: true });
    if (legacy || body.command_version !== 1) return Response.json({ error: 'Unsupported command' }, { status: 400 });
    if (body.base_revision !== history.history_revision) return Response.json({ error: 'Prompt history changed. Reload and review it.' }, { status: 409 });
    const revision = state.values.find(item => item.id === body.revision), active = state.values.find(item => item.id === state.active_revision);
    if (body.action === 'save' || body.action === 'fork') {
      let target = body.action === 'save' && active && !active.executed_at ? active : null;
      if (!target) { target = { id: randomUUID().replaceAll('-', ''), parent_id: body.action === 'fork' ? revision?.id : active?.id, label: '', created_at: '2026-09-10T12:00:00Z', executed_at: null, archived_at: null }; state.values.push(target); }
      target.prompt = body.prompt.trim(); state.active_revision = target.id;
    } else if (body.action === 'activate') { state.active_revision = revision.id; revision.archived_at = null; }
    else if (body.action === 'label') revision.label = body.label;
    else if (body.action === 'archive') {
      if (body.archived && revision.id === state.active_revision) return Response.json({ error: 'Active revision cannot be archived' }, { status: 400 });
      revision.archived_at = body.archived ? '2026-09-10T12:00:00Z' : null;
    } else if (body.action === 'delete') {
      if (revision.id === state.active_revision || revision.executed_at || state.values.some(item => item.parent_id === revision.id)) return Response.json({ error: 'Protected revision' }, { status: 400 });
      state.values = state.values.filter(item => item !== revision);
    }
    actions.push(structuredClone(body)); const after = listing(state);
    const receipt = state.receipts[body.operation_id] = { operation_id: body.operation_id, action: body.action, result_revision: state.active_revision, after_revision: after.history_revision };
    if (failure === 'after') { failure = ''; throw new Error('Simulated lost acknowledgement'); }
    return Response.json({ history: after, receipt, replayed: false });
  }
  return { handle, entry, listing, actions: () => actions, configure: options => { legacy = Boolean(options.legacy); ignoreBranch = Boolean(options.ignoreBranch); failure = options.failure || ''; }, reset: () => { entries.clear(); actions = []; legacy = false; ignoreBranch = false; failure = ''; } };
}
export function installPromptHistoryFixture(app) {
  const fixture = promptHistoryFixture();
  app.post('/test/prompt-history', (req, res) => { fixture.configure(req.body || {}); res.json({}); });
  app.get('/test/prompt-history', (_req, res) => res.json({ actions: fixture.actions() }));
  app.all('/minimax_h3_context_loop/prompt-history', async (req, res) => {
    try { const result = await fixture.handle(req.originalUrl, req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}); res.status(result.status).json(await result.json()); }
    // A truncated acknowledgement reaches JSON parsing but cannot confirm the
    // write. An empty socket close can make Chromium retry the POST itself.
    catch { res.status(200).type('application/json').end('{"'); }
  });
  return fixture;
}
