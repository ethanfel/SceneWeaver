import { PROTOCOL, validateEdits } from './bridge-core.mjs';

const H3 = '/minimax_h3_context_loop';
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
const privateWidget = /ownership|operation_json|api[_ -]?key|password|secret|access[_ -]?token/i;
const token = () => [...crypto.getRandomValues(new Uint8Array(24))].map(v => v.toString(16).padStart(2, '0')).join('');
const widget = (node, name) => node.widgets?.find(item => item.name === name);

export function createAdapter(app, api, { ownershipOptions, publishCatalog } = {}) {
  let revision = 0, previous = '', bindings = new WeakMap();
  const refs = new Map();
  function root() { return app.graph?.rootGraph || app.graph; }
  function describe() {
    const graph = root(), active = app.extensionManager?.workflow?.activeWorkflow;
    if (!graph) throw new Error('ComfyUI has no open graph.');
    if (!bindings.has(graph)) bindings.set(graph, token());
    const identity = String(active?.activeState?.id || active?.path || graph.id || bindings.get(graph));
    return { binding: `${identity}:${bindings.get(graph)}`, workflowId: String(graph.id || ''), name: String(active?.filename || active?.path || 'Unsaved ComfyUI workflow') };
  }
  function snapshot() {
    const descriptor = describe(), nodes = {}; refs.clear();
    function visit(graph, prefix = '', seen = new Set()) {
      if (seen.has(graph)) return; seen.add(graph);
      for (const node of graph._nodes || []) {
        const id = prefix + node.id, inputs = {}, editable = [];
        for (const item of node.widgets || []) {
          if (!item.name || privateWidget.test(item.name) || !scalar(item.value)) continue;
          inputs[item.name] = item.value;
          if (item.name !== 'catalog_json' && !['button', 'converted-widget'].includes(item.type) && !item.disabled && !item.options?.readOnly && !node.inputs?.some(input => input.name === item.name && input.link != null)) editable.push(item.name);
        }
        for (const input of node.inputs || []) {
          if (input.link == null) continue;
          const link = graph.links?.get?.(input.link) || graph.links?.[input.link];
          if (link) inputs[input.name] = [prefix + link.origin_id, link.origin_slot];
        }
        nodes[id] = { class_type: node.comfyClass || node.type, title: node.title || node.type, mode: node.mode || 0, inputs, editable };
        refs.set(id, node);
        if (node.subgraph) visit(node.subgraph, `${id}/`, seen);
      }
    }
    visit(root());
    const document = { ...descriptor, nodes }, serialized = JSON.stringify(document);
    if (serialized !== previous) { previous = serialized; revision++; }
    return { ...document, revision };
  }
  const assertCurrent = command => {
    const current = snapshot();
    if (current.binding !== command.binding || current.revision !== command.revision) throw new Error('The attached workflow changed. Refresh before performing this action.');
    return current;
  };
  function projectNode(command) {
    assertCurrent(command);
    const node = refs.get(command.node);
    if (!node || (node.comfyClass || node.type) !== 'MiniMaxH3ProjectAssetManager' || widget(node, 'run_name')?.value !== command.project) throw new Error('The asset carousel no longer belongs to the attached project.');
    return node;
  }
  async function projectRequest(command, path, body, options = {}) {
    const node = projectNode(command);
    let requestOptions = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options };
    if (widget(node, 'ownership_json')) {
      if (!ownershipOptions) throw new Error('This H3 version requires its native ownership adapter. Use the Project Asset Carousel in ComfyUI.');
      requestOptions = await ownershipOptions(node, command.project, requestOptions);
    }
    assertCurrent(command); // Ownership checks yield; a tab/project may change meanwhile.
    const response = await api.fetchApi(path, requestOptions), data = await response.json();
    if (!response.ok) throw new Error(data.error || `H3 returned HTTP ${response.status}`);
    // A completed server write is never redirected onto a newly selected graph.
    if (snapshot().binding !== command.binding || refs.get(command.node) !== node || widget(node, 'run_name')?.value !== command.project) return { data, warning: 'The server action completed, but the ComfyUI tab or project changed. Reattach to refresh it.' };
    if (data.catalog) {
      if (data.catalog.project !== command.project) throw new Error('H3 returned a catalog for a different project. Refresh in ComfyUI before continuing.');
      root().beforeChange?.();
      try {
      if (publishCatalog) publishCatalog(node, command.project, data.catalog);
      else {
        const catalog = widget(node, 'catalog_json');
        if (catalog) { catalog.value = JSON.stringify(data.catalog); catalog.callback?.(catalog.value); }
      }
      root().change?.(); root().setDirtyCanvas?.(true, true);
      } finally { root().afterChange?.(); }
    }
    return { data, snapshot: snapshot() };
  }
  return {
    snapshot,
    async command(command) {
      if (command.action === 'snapshot') return { snapshot: snapshot() };
      if (command.action === 'patch') {
        const current = snapshot(), edits = validateEdits(current, command);
        const graph = root();
        const changes = edits.map(edit => ({ edit, node: refs.get(edit.node), item: widget(refs.get(edit.node), edit.widget) }));
        if (changes.some(change => !change.item)) throw new Error('A widget disappeared. Refresh the workflow.');
        graph.beforeChange?.();
        try {
          // Check all widgets before writing any, and run native widget callbacks.
          for (const { edit, item } of changes) item.value = edit.after;
          for (const { edit, item, node } of changes) item.callback?.call(item, edit.after, app.canvas, node, app.canvas?.graph_mouse, {});
          graph.change?.(); graph.setDirtyCanvas?.(true, true);
        } catch (error) {
          for (const { edit, item, node } of changes) { item.value = edit.before; try { item.callback?.call(item, edit.before, app.canvas, node, app.canvas?.graph_mouse, {}); } catch {} }
          throw error;
        } finally { graph.afterChange?.(); }
        return { snapshot: snapshot() };
      }
      if (command.action === 'export') {
        assertCurrent(command);
        return { workflow: root().serialize(), name: describe().name };
      }
      if (command.action === 'focus') {
        assertCurrent(command);
        const node = refs.get(command.node);
        if (!node || node.graph !== app.canvas?.graph) throw new Error('Open this node’s graph in ComfyUI first.');
        app.canvas.selectNode?.(node); app.canvas.centerOnNode?.(node);
        return { ok: true };
      }
      if (command.action === 'queue') {
        assertCurrent(command);
        // The native queue path retains frontend hooks, ownership proofs, seeds,
        // subgraph expansion, and custom node serialization.
        const queued = await app.queuePrompt(0, 1);
        if (queued === false) throw new Error('ComfyUI rejected the queue request. Check its validation message.');
        return { queued: true, snapshot: snapshot() };
      }
      if (command.action === 'asset-update') {
        const allowed = ['tag', 'role', 'enabled', 'lyrics'];
        if (!command.changes || Object.keys(command.changes).some(key => !allowed.includes(key))) throw new Error('Unsupported asset change.');
        if (!Object.keys(command.changes).length || Object.keys(command.changes).some(key => !Object.hasOwn(command.before || {}, key))) throw new Error('Include the original value of every changed asset field.');
        projectNode(command);
        const response = await api.fetchApi(`${H3}/project-assets?${new URLSearchParams({ project: command.project })}`);
        const catalog = await response.json();
        if (!response.ok) throw new Error(catalog.error || 'Cannot verify the asset before editing.');
        const asset = catalog.assets?.find(asset => asset.id === command.asset_id);
        if (!asset || Object.entries(command.before || {}).some(([key, value]) => JSON.stringify(key === 'enabled' ? asset.enabled !== false : asset[key]) !== JSON.stringify(value))) throw new Error('This asset changed in ComfyUI. Refresh the asset list before applying.');
        return projectRequest(command, `${H3}/project-assets/update`, { project: command.project, asset_id: command.asset_id, changes: command.changes });
      }
      if (command.action === 'asset-upload') {
        if (!(command.file instanceof Blob)) throw new Error('Choose a file to upload.');
        const form = new FormData(); form.append('project', command.project); form.append('role', command.role || ''); form.append('tag', command.tag || ''); form.append('file', command.file, command.filename);
        return projectRequest(command, `${H3}/project-assets/upload`, null, { headers: {}, body: form });
      }
      if (command.action === 'asset-import') return projectRequest(command, `${H3}/project-assets/import`, { project: command.project, source: 'input', path: command.path, role: command.role || '', tag: command.tag || '' });
      throw new Error('Unsupported companion action.');
    },
  };
}

async function h3Adapters(api) {
  try {
    const paths = await (await api.fetchApi('/extensions')).json();
    const path = paths.find(path => path.endsWith('/h3_project_asset_manager.js'));
    if (!path) return {};
    const source = await (await fetch(path)).text(), base = new URL(path, location.href);
    const ownershipPath = source.match(/["'](\.\/h3_project_ownership\.mjs[^"']*)["']/)?.[1];
    const syncPath = source.match(/["'](\.\/h3_project_asset_sync_core\.mjs[^"']*)["']/)?.[1];
    const ownership = ownershipPath ? await import(new URL(ownershipPath, base).href) : {};
    const sync = syncPath ? await import(new URL(syncPath, base).href) : {};
    return { ownershipOptions: ownership.projectMutationOptions, publishCatalog: sync.publishProjectAssetCatalogChanged ? (node, project, catalog) => {
      const value = widget(node, 'catalog_json');
      if (value) { value.value = JSON.stringify(sync.serializedProjectAssetCatalog?.(catalog, project) || catalog); value.callback?.(value.value); }
      sync.publishProjectAssetCatalogChanged(node, catalog);
    } : undefined };
  } catch { return {}; }
}

export async function launch(child, companionOrigin = new URL(import.meta.url).origin) {
  if (!child) throw new Error('Allow the SceneWeaver window to open, then try again.');
  if (globalThis.__sceneweaverCompanion) globalThis.__sceneweaverCompanion.stop();
  const [{ app }, { api }] = await Promise.all([import(new URL('/scripts/app.js', location.origin).href), import(new URL('/scripts/api.js', location.origin).href)]);
  const adapter = createAdapter(app, api, await h3Adapters(api));
  const session = token(); let stopped = false, ready = false, processing = false;
  const send = message => { if (!stopped && !child.closed) child.postMessage({ protocol: PROTOCOL, session, ...message }, companionOrigin); };
  const listener = async event => {
    if (event.source !== child || event.origin !== companionOrigin || event.data?.protocol !== PROTOCOL || event.data.session !== session) return;
    const message = event.data;
    if (message.kind === 'hello') { ready = true; send({ kind: 'snapshot', snapshot: adapter.snapshot() }); return; }
    if (message.kind !== 'command') return;
    if (processing) { send({ kind: 'result', id: message.id, error: 'Another companion action is in progress.' }); return; }
    processing = true;
    try { send({ kind: 'result', id: message.id, result: await adapter.command(message.command) }); }
    catch (error) { send({ kind: 'result', id: message.id, error: error.message }); }
    finally { processing = false; }
  };
  window.addEventListener('message', listener);
  const events = ['execution_start', 'executing', 'progress', 'execution_success', 'execution_error', 'execution_interrupted'];
  const forward = event => send({ kind: 'execution', event: { type: event.type, data: event.detail } });
  events.forEach(name => api.addEventListener(name, forward));
  const interval = setInterval(() => {
    if (child.closed) { stop(); return; }
    if (ready && !processing) { try { send({ kind: 'snapshot', snapshot: adapter.snapshot() }); } catch (error) { send({ kind: 'unavailable', error: error.message }); } }
  }, 2000);
  function stop() { stopped = true; clearInterval(interval); window.removeEventListener('message', listener); events.forEach(name => api.removeEventListener(name, forward)); }
  globalThis.__sceneweaverCompanion = { stop };
  child.location = `${companionOrigin}/#${new URLSearchParams({ sceneweaver_session: session, comfy_origin: location.origin })}`;
  return { stop };
}
