import { PROTOCOL, validateEdits } from './bridge-core.mjs';
import { finalCutDocument, checkpointImpact, checkpointStamp } from './takes-core.mjs';

import { workingBranch, branchPath, verifyBranch } from './branches-core.mjs';
import { resolvePlanBinding, workflowBindings } from './binding-core.mjs';
import { saveWorkflowFile, workflowFileStatus } from './workflow-file.mjs';
import { createCommandSession } from './command-session.mjs';
import { discoverH3 } from './h3-discovery.mjs';
import { productionRoles } from './workflow-roles.mjs';

const H3 = '/minimax_h3_context_loop';
const scalar = value => ['string', 'number', 'boolean'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
const privateWidget = /ownership|operation_json|api[_ -]?key|password|secret|access[_ -]?token/i;
const token = () => [...crypto.getRandomValues(new Uint8Array(24))].map(v => v.toString(16).padStart(2, '0')).join('');
const widget = (node, name) => node.widgets?.find(item => item.name === name);

export function createAdapter(app, api, { ownershipOptions, publishCatalog, checkpoints: nativeCheckpoints, finalCut = false, workingBranches = false, audioTracks, diagnostics } = {}) {
  let revision = 0, previous = '', bindings = new WeakMap();
  const refs = new Map();
  const previews = new Map();
  const effectsStarted = new WeakSet();
  function root() { return app.rootGraph || app.graph?.rootGraph || app.graph; }
  function describe() {
    const graph = root(), active = app.extensionManager?.workflow?.activeWorkflow;
    if (!graph) throw new Error('ComfyUI has no open graph.');
    if (!bindings.has(graph)) bindings.set(graph, token());
    const identity = String(active?.path || active?.activeState?.id || graph.id || bindings.get(graph));
    return { binding: `${identity}:${bindings.get(graph)}`, workflowId: String(graph.id || ''), workflowKey: String(active?.path || graph.id || identity), name: String(active?.filename || active?.path || 'Unsaved ComfyUI workflow') };
  }
  function snapshot() {
    const descriptor = describe(), nodes = {}; refs.clear();
    const graphPrefixes = new WeakMap();
    const graphLink = (graph, id) => graph.links?.get?.(id) || graph.links?.[id];
    function source(graph, link, prefix, boundary, depth = 0) {
      if (!link || depth > 64) return null;
      if (graph.inputNode && String(link.origin_id) === String(graph.inputNode.id)) {
        if (!boundary || [2, 4].includes(boundary.node.mode)) return null;
        const input = boundary.node.inputs?.[link.origin_slot];
        return input?.link == null ? null : source(boundary.graph, graphLink(boundary.graph, input.link), boundary.prefix, boundary.parent, depth + 1);
      }
      return [prefix + link.origin_id, link.origin_slot];
    }
    function visit(graph, prefix = '', seen = new Set(), boundary = null, scopeActive = true) {
      if (seen.has(graph)) {
        // Shared definitions do not provide an independent editable node object
        // per instance. Do not silently bind one instance using another's inputs.
        const originalPrefix = graphPrefixes.get(graph);
        for (const [id, node] of Object.entries(nodes)) if (id.startsWith(originalPrefix)) { node.scopeActive = false; node.editable = []; }
        return;
      }
      seen.add(graph);
      graphPrefixes.set(graph, prefix);
      for (const node of graph._nodes || []) {
        const id = prefix + node.id, inputs = {}, editable = [], inputErrors = [], inputSources = {};
        for (const item of node.widgets || []) {
          if (!item.name || privateWidget.test(item.name) || !scalar(item.value)) continue;
          inputs[item.name] = item.value;
          if (!['catalog_json', 'working_branch_id'].includes(item.name) && !['button', 'converted-widget'].includes(item.type) && !item.disabled && !item.options?.readOnly && !node.inputs?.some(input => input.name === item.name && input.link != null)) editable.push(item.name);
        }
        for (const input of node.inputs || []) {
          if (input.link == null) continue;
          const link = graphLink(graph, input.link);
          if (link) {
            inputs[input.name] = [prefix + link.origin_id, link.origin_slot];
            const resolved = source(graph, link, prefix, boundary);
            if (!resolved) inputErrors.push(input.name);
            else if (resolved[0] !== inputs[input.name][0]) inputSources[input.name] = resolved;
          }
          else inputErrors.push(input.name);
        }
        nodes[id] = { class_type: node.comfyClass || node.type, title: node.title || node.type, mode: node.mode || 0, inputs, editable, inputErrors, inputSources, scopeActive, virtual: Boolean(node.isVirtualNode || node.subgraph), requiresOwnership: Boolean(widget(node, 'ownership_json')),
          ...((node.comfyClass || node.type) === 'GetNode' ? { routing: { busAncestors: typeof node.resolveVirtualOutput === 'function' } } : {}) };
        refs.set(id, node);
        if (node.subgraph) {
          const child = { node, graph, prefix, parent: boundary }, childPrefix = `${id}/`;
          nodes[id].outputSources = {};
          for (const [index, slot] of (node.subgraph.outputNode?.slots || []).entries()) {
            try {
              const links = slot.getLinks?.() || [];
              nodes[id].outputSources[index] = links.length === 1 ? source(node.subgraph, links[0], childPrefix, child) : null;
            } catch { nodes[id].outputSources[index] = null; }
          }
          visit(node.subgraph, childPrefix, seen, child, scopeActive && ![2, 4].includes(node.mode));
        }
      }
    }
    visit(root());
    const document = { ...descriptor, nodes, projectBindings: workflowBindings(nodes), capabilities: { bindingVersion: 1, taskVersion: 1, nativeQueue: typeof app.queuePrompt === 'function', ownership: typeof ownershipOptions === 'function', diagnostics, workingBranches: Boolean(workingBranches), audioTracks: Boolean(audioTracks && ownershipOptions), finalCut: Boolean(finalCut && ownershipOptions), checkpoints: Boolean(nativeCheckpoints && ownershipOptions) } }, serialized = JSON.stringify(document);
    if (serialized !== previous) { previous = serialized; revision++; }
    return { ...document, revision, workflowFile: workflowFileStatus(app), productionBindings: document.projectBindings.plans.map(plan => productionRoles(nodes, plan.planId)) };
  }
  const assertCurrent = command => {
    const current = snapshot();
    if (current.binding !== command.binding || current.revision !== command.revision) throw new Error('The attached workflow changed. Refresh before performing this action.');
    return current;
  };
  function projectNode(command) {
    const current = assertCurrent(command);
    const node = refs.get(command.node);
    if (!node || (node.comfyClass || node.type) !== 'MiniMaxH3ProjectAssetManager' || widget(node, 'run_name')?.value !== command.project) throw new Error('The asset carousel no longer belongs to the attached project.');
    if (command.plan) {
      const binding = resolvePlanBinding(current.nodes, command.plan);
      if (binding.status !== 'bound' || binding.managerId !== command.node || binding.project !== command.project) throw new Error(`The Plan is connected to a different asset carousel or its binding is unresolved. ${binding.issues.join(' ')}`);
    }
    return node;
  }
  function projectPlan(command) {
    const manager = projectNode(command), plan = refs.get(command.plan);
    if (!plan || !['MiniMaxH3ChainPlan', 'MiniMaxH3ChainPlanModern', 'MiniMaxH3ChainPlanStudio'].includes(plan.comfyClass || plan.type) || !widget(plan, 'plan_json')) throw new Error('Select the attached H3 Plan before managing takes.');
    if ((plan.comfyClass || plan.type) === 'MiniMaxH3ChainPlanStudio' && plan.inputs?.some(input => input.name === 'plan' && input.link != null)) throw new Error('Select the upstream Plan instead of its connected Plan Studio before managing takes.');
    if (!snapshot().nodes[command.plan]?.editable.includes('plan_json')) throw new Error('The attached Plan JSON is controlled by a connection or is read-only.');
    const branch = workingBranch(snapshot().nodes[command.plan].inputs);
    if (branch !== (command.branch_id || 'main')) throw new Error('The Plan working branch changed. Refresh before managing takes.');
    if (branch !== 'main' && !workingBranches) throw new Error('This installed H3 adapter does not support named working branches.');
    return { manager, plan };
  }
  async function readTakes(command) {
    projectPlan(command);
    const response = await api.fetchApi(branchPath(`${H3}/checkpoints?${new URLSearchParams({ run_name: command.project, include_graph: 'true' })}`, command.branch_id));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Cannot read the saved takes.');
    if (data.run_name !== command.project || !Array.isArray(data.checkpoints) || !Array.isArray(data.revisions)) throw new Error('H3 returned unexpected checkpoint data. Refresh the project.');
    verifyBranch(data, command.branch_id);
    projectPlan(command);
    return data;
  }
  async function requireIdle() {
    const response = await api.fetchApi('/queue'), queue = await response.json();
    if (!response.ok || !Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error('Cannot verify the ComfyUI queue.');
    if (queue.queue_running.length || queue.queue_pending.length) throw new Error('Wait for the ComfyUI queue to finish before restoring a checkpoint branch.');
  }
  function refreshEditors() {
    for (const node of refs.values()) { try { node._h3PlanStudioRefresh?.(); node._h3CheckpointManagerRefresh?.(); } catch { /* Native polling also reconciles saved state. */ } }
  }
  async function projectRequest(command, path, body, options = {}) {
    const node = projectNode(command);
    let requestOptions = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options };
    if (ownershipOptions || widget(node, 'ownership_json')) {
      if (!ownershipOptions) throw new Error('This H3 version requires its native ownership adapter. Use the Project Asset Carousel in ComfyUI.');
      effectsStarted.add(command);
      requestOptions = await ownershipOptions(node, command.project, requestOptions);
    }
    assertCurrent(command); // Ownership checks yield; a tab/project may change meanwhile.
    if (command.plan) projectPlan(command);
    effectsStarted.add(command);
    const response = await api.fetchApi(command.plan ? branchPath(path, command.branch_id) : path, requestOptions), data = await response.json();
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
  async function execute(command) {
      if (command.action === 'snapshot') return { snapshot: snapshot() };
      if (command.action === 'patch') {
        const current = snapshot(), edits = validateEdits(current, command);
        const graph = root();
        const changes = edits.map(edit => ({ edit, node: refs.get(edit.node), item: widget(refs.get(edit.node), edit.widget) }));
        if (changes.some(change => !change.item)) throw new Error('A widget disappeared. Refresh the workflow.');
        graph.beforeChange?.();
        try {
          // Check all widgets before writing any, and run native widget callbacks.
          effectsStarted.add(command);
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
      if (command.action === 'workflow-save') {
        assertCurrent(command);
        const result = await saveWorkflowFile(app, () => assertCurrent(command), () => effectsStarted.add(command));
        return { ...result, saved: true, snapshot: snapshot() };
      }
      if (command.action === 'focus') {
        assertCurrent(command);
        const node = refs.get(command.node);
        if (!node || node.graph !== app.canvas?.graph) throw new Error('Open this node’s graph in ComfyUI first.');
        app.canvas.selectNode?.(node); app.canvas.centerOnNode?.(node);
        return { ok: true };
      }
      if (command.action === 'queue') {
        const current = assertCurrent(command);
        if (!command.plan && current.projectBindings.plans.length > 1) throw new Error('Select the production Plan before queuing this workflow.');
        if (command.plan) {
          const binding = resolvePlanBinding(current.nodes, command.plan);
          if (!['bound', 'unmanaged'].includes(binding.status)) throw new Error(binding.issues.join(' ') || 'The production Plan is not bound.');
        }
        // The native queue path retains frontend hooks, ownership proofs, seeds,
        // subgraph expansion, and custom node serialization.
        effectsStarted.add(command);
        const queued = await app.queuePrompt(0, 1);
        if (queued === false) throw Object.assign(new Error('ComfyUI rejected the queue request. Check its validation message.'), { outcome: 'rejected' });
        return { queued: true, snapshot: snapshot() };
      }
      if (command.action === 'take-final-cut') {
        if (!finalCut || !ownershipOptions) throw new Error('Reopen the companion from ComfyUI with an H3 version that supports revision-checked final-cut saves.');
        const payload = await readTakes(command), body = finalCutDocument(payload, command);
        const result = await projectRequest(command, `${H3}/editorial`, body);
        if (!result.warning) refreshEditors();
        return result;
      }
      if (command.action === 'checkpoint-preview') {
        if (!nativeCheckpoints || !ownershipOptions) throw new Error('This installed H3 checkpoint adapter is unavailable. Reopen the companion from ComfyUI or use its native checkpoint manager.');
        const payload = await readTakes(command);
        const impact = checkpointImpact(payload, command, nativeCheckpoints);
        await requireIdle();
        const { plan } = projectPlan(command);
        // Validate the native restoration against this exact Plan before the
        // user sees the confirmation. The backend returns authoritative values.
        nativeCheckpoints.restorePlan(widget(plan, 'plan_json').value, impact.restored.map(item => ({ ...item, scene_prompt: item.scene_prompt ?? item.prompt })));
        const stamp = await checkpointStamp(payload); projectPlan(command);
        const ticket = token(); previews.clear();
        previews.set(ticket, { command, impact, stamp });
        return { data: { ...impact, ticket }, snapshot: snapshot() };
      }
      if (command.action === 'checkpoint-activate') {
        const preview = previews.get(command.ticket); previews.delete(command.ticket);
        if (!preview || ['binding', 'revision', 'node', 'plan', 'project', 'branch_id'].some(key => preview.command[key] !== command[key])) throw new Error('Preview the checkpoint impact again before restoring it.');
        const payload = await readTakes(command);
        if (await checkpointStamp(payload) !== preview.stamp) throw new Error('The checkpoint graph or saved cut changed. Preview the impact again.');
        await requireIdle();
        const { plan } = projectPlan(command), originalPlan = widget(plan, 'plan_json').value;
        const { scope, lineage } = preview.impact;
        const result = await projectRequest(command, `${H3}/checkpoint-revisions/restore`, { run_name: command.project, activate_only: true, resume_scene: preview.command.scene + 1, scope_start_scene: scope.start, scope_end_scene: scope.end, revisions: lineage });
        if (result.warning) return result;
        if (snapshot().revision !== command.revision || widget(plan, 'plan_json').value !== originalPlan) return { ...result, warning: 'The checkpoint branch was restored, but the workflow changed while H3 was writing. Its Plan was left untouched. Review the branch in ComfyUI before continuing.' };
        try {
          if (result.data.run_name !== command.project || !Array.isArray(result.data.restored)) throw new Error('H3 returned an unexpected restoration result.');
          const value = nativeCheckpoints.restorePlan(originalPlan, result.data.restored);
          root().beforeChange?.();
          try {
            const target = widget(plan, 'plan_json'); target.value = value; target.callback?.(value);
            nativeCheckpoints.refreshPlan?.(plan, result.data.restored);
            root().change?.(); root().setDirtyCanvas?.(true, true);
          } finally { root().afterChange?.(); }
          refreshEditors();
          return { data: result.data, snapshot: snapshot() };
        } catch (error) { return { data: result.data, snapshot: snapshot(), warning: `H3 restored the branch, but the Plan could not be synchronized: ${error.message}. Review it in ComfyUI before queuing.` }; }
      }
      if (command.action === 'asset-audio-tracks') {
        if (!audioTracks || !ownershipOptions) throw new Error('Reopen SceneWeaver from an H3 version with synchronized audio tracks.');
        projectNode(command);
        const response = await api.fetchApi(`${H3}/project-assets?${new URLSearchParams({ project: command.project })}`);
        const catalog = await response.json();
        if (!response.ok || catalog.project !== command.project) throw new Error('Cannot verify project audio tracks.');
        const asset = catalog.assets?.find(item => item.id === command.asset_id);
        if (!asset || asset.role !== 'source_track' || JSON.stringify(asset.options || {}) !== JSON.stringify(command.before_options || {})) throw new Error('The source track changed in ComfyUI. Refresh before applying.');
        const tracks = command.tracks;
        if (tracks !== null) {
          if (!tracks || Object.keys(tracks).some(key => !['full_mix', 'vocals', 'instrumental'].includes(key)) || Object.values(tracks).some(id => typeof id !== 'string')) throw new Error('Invalid synchronized audio tracks.');
          const ids = Object.values(tracks).filter(Boolean);
          if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !catalog.assets.some(item => item.id === id && ['audio', 'video'].includes(item.kind) && item.enabled !== false))) throw new Error('Select distinct, enabled audio or video assets and keep at least one track.');
        }
        const normalized = tracks === null ? null : audioTracks.projectAudioTrackBindings({ ...asset, options: { ...asset.options, audio_tracks: tracks } });
        return projectRequest(command, `${H3}/project-assets/update`, { project: command.project, asset_id: asset.id, changes: { options: { audio_tracks: normalized } } });
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
        if (!asset || Object.entries(command.before || {}).some(([key, value]) => JSON.stringify(key === 'enabled' ? asset.enabled !== false : key === 'lyrics' ? asset.lyrics || '' : asset[key]) !== JSON.stringify(value))) throw new Error('This asset changed in ComfyUI. Refresh the asset list before applying.');
        return projectRequest(command, `${H3}/project-assets/update`, { project: command.project, asset_id: command.asset_id, changes: command.changes });
      }
      if (command.action === 'asset-upload') {
        if (!(command.file instanceof Blob)) throw new Error('Choose a file to upload.');
        const form = new FormData(); form.append('project', command.project); form.append('role', command.role || ''); form.append('tag', command.tag || ''); form.append('file', command.file, command.filename);
        return projectRequest(command, `${H3}/project-assets/upload`, null, { headers: {}, body: form });
      }
      if (command.action === 'asset-import') return projectRequest(command, `${H3}/project-assets/import`, { project: command.project, source: 'input', path: command.path, role: command.role || '', tag: command.tag || '' });
      throw new Error('Unsupported companion action.');
  }
  return {
    snapshot,
    async command(command) {
      try { return await execute(command); }
      catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (!failure.outcome) failure.outcome = effectsStarted.has(command) ? 'uncertain' : 'rejected';
        throw failure;
      } finally { effectsStarted.delete(command); }
    },
  };
}

export async function launch(child, companionOrigin = new URL(import.meta.url).origin) {
  if (!child) throw new Error('Allow the SceneWeaver window to open, then try again.');
  if (globalThis.__sceneweaverCompanion) globalThis.__sceneweaverCompanion.stop();
  const [{ app }, { api }] = await Promise.all([import(new URL('/scripts/app.js', location.origin).href), import(new URL('/scripts/api.js', location.origin).href)]);
  const adapter = createAdapter(app, api, await discoverH3(api));
  const session = token(); let stopped = false, ready = false;
  const send = message => { if (!stopped && !child.closed) child.postMessage({ protocol: PROTOCOL, session, ...message }, companionOrigin); };
  const commands = createCommandSession(adapter, receipt => send({ kind: 'receipt', receipt }));
  const listener = async event => {
    if (event.source !== child || event.origin !== companionOrigin || event.data?.protocol !== PROTOCOL || event.data.session !== session) return;
    const message = event.data;
    if (message.kind === 'hello') {
      ready = true;
      try { send({ kind: 'snapshot', snapshot: adapter.snapshot() }); send({ kind: 'receipts', receipts: commands.recent() }); }
      catch (error) { send({ kind: 'unavailable', error: error.message }); }
      return;
    }
    if (message.kind !== 'command') return;
    send({ kind: 'result', id: message.id, ...await commands.execute(message.id, message.command) });
  };
  window.addEventListener('message', listener);
  const events = ['execution_start', 'executing', 'progress', 'execution_success', 'execution_error', 'execution_interrupted'];
  const forward = event => send({ kind: 'execution', event: { type: event.type, data: event.detail } });
  events.forEach(name => api.addEventListener(name, forward));
  const interval = setInterval(() => {
    if (child.closed) { stop(); return; }
    if (ready && commands.processing) send({ kind: 'heartbeat' });
    if (ready && !commands.processing) { try { send({ kind: 'snapshot', snapshot: adapter.snapshot() }); } catch (error) { send({ kind: 'unavailable', error: error.message }); } }
  }, 2000);
  function stop() { stopped = true; clearInterval(interval); window.removeEventListener('message', listener); events.forEach(name => api.removeEventListener(name, forward)); }
  globalThis.__sceneweaverCompanion = { stop };
  child.location = `${companionOrigin}/#${new URLSearchParams({ sceneweaver_session: session, comfy_origin: location.origin })}`;
  return { stop };
}
