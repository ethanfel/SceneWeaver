// Discover browser helpers independently: a broken optional module must not
// hide working integrations. Source markers are reported as inference, never
// as an installed pack version or proof that a backend route will succeed.
export async function discoverH3(api, options = {}) {
  const origin = new URL(options.baseUrl || location.href);
  const readText = options.readText || (async url => { const response = await fetch(url); if (!response.ok) throw new Error('Extension fetch failed.'); return response.text(); });
  const importModule = options.importModule || (url => import(url));
  const diagnostics = { version: 1, adapter: 'h3-browser-v1', comfyVersion: '', h3Version: '', frontendVersion: '', checks: [] };
  const adapters = { diagnostics };
  const check = (id, status, detail) => diagnostics.checks.push({ id, status, detail });
  const readJson = async path => { const response = await api.fetchApi(path); if (!response.ok) throw new Error('Discovery request failed.'); return response.json(); };
  const [extensions, stats] = await Promise.allSettled([readJson('/extensions'), readJson('/system_stats')]);
  if (stats.status === 'fulfilled' && typeof stats.value?.system?.comfyui_version === 'string') diagnostics.comfyVersion = stats.value.system.comfyui_version;
  check('versions', 'unknown', 'H3 pack revision and installed frontend version are not published by this integration. Helper query strings are cache keys, not version evidence.');
  if (extensions.status !== 'fulfilled' || !Array.isArray(extensions.value) || extensions.value.some(path => typeof path !== 'string')) {
    check('discovery', 'unavailable', 'Cannot read the ComfyUI extension list. Reopen the companion after the server is reachable.'); return adapters;
  }
  const urls = [];
  for (const path of extensions.value) {
    try { const url = new URL(path, origin); if (url.origin === origin.origin && url.pathname.startsWith('/extensions/')) urls.push(url); }
    catch { /* Invalid unrelated entries cannot prevent native attachment. */ }
  }
  const managers = urls.filter(url => url.pathname.endsWith('/h3_project_asset_manager.js'));
  if (managers.length !== 1) {
    check('discovery', 'unavailable', managers.length ? 'Multiple H3 Asset Carousel extensions are installed. Resolve the duplicate pack before attaching mutation helpers.' : 'The H3 Asset Carousel extension was not found.'); return adapters;
  }
  check('discovery', 'available', 'One H3 Asset Carousel extension located on the attached server.');
  const base = new URL('./', managers[0]);
  const entry = async name => {
    const matches = urls.filter(url => new URL('./', url).href === base.href && url.pathname.endsWith(`/${name}`));
    if (matches.length !== 1) throw new Error('Extension missing or duplicated.');
    return { url: matches[0], source: await readText(matches[0].href) };
  };
  const module = async (entry, name) => {
    const reference = entry.source.match(new RegExp(`["'](\\./${name.replaceAll('.', '\\.')}(?:\\?[^"']*)?)["']`))?.[1];
    if (!reference) throw new Error('Helper import not exposed.');
    return importModule(new URL(reference, entry.url).href);
  };
  const functions = (value, names) => names.every(name => typeof value[name] === 'function');
  const probe = async (id, detail, action) => {
    try { await action(); check(id, 'available', detail); }
    catch { check(id, 'unavailable', `The installed H3 ${id} helper is missing, could not load, or has an unsupported export contract.`); }
  };
  const [assets, studio, manager] = await Promise.allSettled([entry('h3_project_asset_manager.js'), entry('h3_chain_plan_studio.js'), entry('h3_chain_checkpoint_manager.js')]);
  await probe('generation', 'H3 top-level queue hooks available. ComfyUI serializes the attached graph; the companion validates the requested production scope before submission.', async () => {
    const source = await entry('h3_chain_top_level_requeue.js');
    const value = await module(source, 'h3_chain_top_level_requeue_coordinator.mjs');
    if (!functions(value, ['runBeforeQueuedHooks', 'submitWithPromptIdentity'])) throw new Error();
    adapters.generationHooks = value;
  });
  if (assets.status === 'fulfilled') {
    await probe('ownership', 'Native projectMutationOptions function available; project permission is checked at each write.', async () => {
      const value = await module(assets.value, 'h3_project_ownership.mjs');
      if (!functions(value, ['projectMutationOptions'])) throw new Error(); adapters.ownershipOptions = value.projectMutationOptions;
    });
    await probe('catalog', 'Native asset catalog synchronization functions available.', async () => {
      const value = await module(assets.value, 'h3_project_asset_sync_core.mjs');
      if (!functions(value, ['serializedProjectAssetCatalog', 'publishProjectAssetCatalogChanged'])) throw new Error();
      adapters.publishCatalog = (node, project, catalog) => {
        const widget = node.widgets?.find(item => item.name === 'catalog_json');
        if (widget) { widget.value = JSON.stringify(value.serializedProjectAssetCatalog(catalog, project)); widget.callback?.(widget.value); }
        value.publishProjectAssetCatalogChanged(node, catalog);
      };
    });
    await probe('audioTracks', 'Native grouped audio-track binding function available.', async () => {
      const value = await module(assets.value, 'h3_project_asset_editor_core.mjs');
      if (!functions(value, ['projectAudioTrackBindings'])) throw new Error(); adapters.audioTracks = value;
    });
  } else check('assets', 'unavailable', 'The H3 Asset Carousel extension could not be read.');
  if (studio.status === 'fulfilled') {
    await probe('workingBranches', 'Native working-branch identity and request-path helpers available. Branch writes still require a dedicated command adapter.', async () => {
      const value = await module(studio.value, 'h3_working_branches.mjs');
      if (!functions(value, ['workingBranchId', 'branchRequestPath']) || !studio.value.source.includes('working_branch_id')) throw new Error();
      adapters.workingBranches = true;
    });
    adapters.finalCut = studio.value.source.includes('base_revision:') && studio.value.source.includes('/minimax_h3_context_loop/editorial');
    check('finalCut', adapters.finalCut ? 'inferred' : 'unavailable', adapters.finalCut ? 'Revision-checked editorial saves inferred from native Studio source markers. The backend validates each save.' : 'Revision-checked editorial save markers were not found.');
  } else check('studio', 'unavailable', 'Plan Studio extension missing, duplicated, or unreadable in this H3 pack.');
  if (manager.status === 'fulfilled') await probe('checkpoints', 'Native checkpoint eligibility, lineage, Plan restore, and editor synchronization functions available.', async () => {
    const [core, plan, review, restore, prompts] = await Promise.all(['h3_checkpoint_manager_core.mjs', 'h3_chain_plan_core.mjs', 'h3_chain_review_core.mjs', 'h3_plan_restore_core.mjs', 'h3_prompt_companion_sync.mjs'].map(name => module(manager.value, name)));
    if (!functions(core, ['checkpointActivationMode', 'checkpointRevisionLineage']) || !functions(plan, ['parsePlanJson', 'planToJson', 'promptValueToText']) || !functions(review, ['applyCheckpointRevisionSet']) || !functions(restore, ['refreshRestoredPlanEditors']) || !functions(prompts, ['publishCompanionPrompt'])) throw new Error();
    adapters.checkpoints = {
      checkpointActivationMode: core.checkpointActivationMode, checkpointRevisionLineage: core.checkpointRevisionLineage,
      restorePlan: (value, revisions) => plan.planToJson(review.applyCheckpointRevisionSet(plan.parsePlanJson(String(value)), revisions, { useEffectivePrompts: true, useTipSharedPrompt: true })),
      refreshPlan: (node, revisions) => {
        restore.refreshRestoredPlanEditors(node);
        const document = plan.parsePlanJson(String(node.widgets.find(item => item.name === 'plan_json').value));
        for (const item of revisions) prompts.publishCompanionPrompt(node, node, item.scene - 1, plan.promptValueToText(document.shots[item.scene - 1]?.prompt));
      },
    };
  });
  else check('checkpoints', 'unavailable', 'Checkpoint Manager extension missing, duplicated, or unreadable in this H3 pack.');
  return adapters;
}
