// Synthetic HTTP fixture. Native Python tests exercise real catalog/file writes.
import { createHash, randomUUID } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export function assetLibraryFixture() {
  let catalog, actions = [], receipts = {}, legacy = false, failure = '';
  const reset = () => {
    catalog = { project: 'sceneweaver_first_film', folders: [{ id: 'cast', name: 'Cast', color: '#567080' }, { id: 'places', name: 'Locations', color: '#705680' }], assets: [
      { id: 'hero', tag: 'hero', kind: 'image', role: 'picture', enabled: true, original_name: 'hero.png', relative_path: 'images/hero.png', folder_id: 'cast', source_kind: 'input' },
      { id: 'room', tag: 'room', kind: 'image', role: 'semantic_anchor', enabled: true, original_name: 'room.png', relative_path: 'images/room.png', folder_id: 'places' },
      { id: 'mix', tag: 'score', kind: 'audio', role: 'source_track', enabled: true, options: { audio_tracks: { full_mix: 'mix', vocals: 'vocals' } } },
      { id: 'vocals', tag: 'vocals', kind: 'audio', role: 'audio_reference', enabled: true },
    ] }; actions = []; receipts = {}; legacy = false; failure = '';
  };
  reset();
  const listing = () => structuredClone({ ...catalog, revision: hash(catalog.assets.map(item => [item.id, item.tag, item.enabled])), ...(legacy ? {} : { library_command_version: 1, library_revision: hash(catalog) }) });
  async function handle(path, options = {}) {
    const url = new URL(path, 'http://fixture');
    if (!options.body) { const operation = url.searchParams.get('operation_id'); return Response.json(operation ? { catalog: listing(), receipt: receipts[operation]?.receipt || null } : listing()); }
    const body = JSON.parse(options.body);
    if (failure === 'before') { failure = ''; throw new Error('Dropped library request'); }
    if (failure === 'conflict' || failure === 'ownership') { const status = failure === 'conflict' ? 409 : 423; failure = ''; return Response.json({ error: status === 409 ? 'The library changed. Refresh and review.' : 'Project is read-only.' }, { status }); }
    const saved = receipts[body.operation_id];
    if (saved) return saved.fingerprint === hash(body) ? Response.json({ catalog: listing(), receipt: saved.receipt, replayed: true }) : Response.json({ error: 'Changed operation' }, { status: 400 });
    if (legacy || body.command_version !== 1) return Response.json({ error: 'Unsupported library command' }, { status: 400 });
    if (body.project !== catalog.project || body.base_revision !== listing().library_revision) return Response.json({ error: 'The library changed. Refresh and review.' }, { status: 409 });
    const asset = catalog.assets.find(item => item.id === body.asset_id), folder = catalog.folders.find(item => item.id === body.folder_id);
    const beforeAssets = catalog.assets.map(item => item.id), beforeFolders = catalog.folders.map(item => item.id);
    const reorder = (values, ids) => {
      if (!Array.isArray(ids) || ids.length !== values.length || new Set(ids).size !== ids.length || ids.some(id => !values.some(item => item.id === id))) throw new Error('Order must contain every current ID exactly once.');
      return ids.map(id => values.find(item => item.id === id));
    };
    try {
      if (body.action === 'folder_create') { if (catalog.folders.some(item => item.name === body.name)) throw new Error('Folder already exists'); catalog.folders.push({ id: id('folder'), name: body.name, color: body.color }); }
      else if (body.action === 'folder_update') Object.assign(folder, body.changes);
      else if (body.action === 'folder_delete') { catalog.folders = catalog.folders.filter(item => item !== folder); catalog.assets.forEach(item => { if (item.folder_id === body.folder_id) item.folder_id = ''; }); }
      else if (body.action === 'folder_reorder') catalog.folders = reorder(catalog.folders, body.folder_ids);
      else if (body.action === 'asset_reorder') catalog.assets = reorder(catalog.assets, body.asset_ids);
      else if (body.action === 'asset_update') Object.assign(asset, body.changes);
      else if (body.action === 'asset_duplicate') {
        const clone = structuredClone(asset); clone.id = id('asset'); clone.parent_asset_id = asset.id; clone.source_kind = 'catalog_duplicate'; clone.folder_id = body.folder_id ?? asset.folder_id ?? ''; clone.tag = body.tag || `${asset.tag}_copy`;
        if (clone.role === 'source_track') clone.enabled = false;
        if (clone.options?.audio_tracks) clone.options.audio_tracks = Object.fromEntries(Object.entries(clone.options.audio_tracks).map(([key, value]) => [key, value === asset.id ? clone.id : value]));
        catalog.assets.push(clone);
      } else if (body.action === 'asset_delete') {
        if (catalog.assets.some(item => item.id !== asset.id && Object.values(item.options?.audio_tracks || {}).includes(asset.id))) throw new Error('Detach this audio from its track group before deleting it.');
        catalog.assets = catalog.assets.filter(item => item !== asset);
      } else throw new Error('Unsupported library action');
    } catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
    actions.push(structuredClone(body));
    const receipt = { project: catalog.project, operation_id: body.operation_id, action: body.action, after_revision: listing().library_revision,
      created_assets: catalog.assets.map(item => item.id).filter(id => !beforeAssets.includes(id)), created_folders: catalog.folders.map(item => item.id).filter(id => !beforeFolders.includes(id)) };
    receipts[body.operation_id] = { receipt, fingerprint: hash(body) };
    if (failure === 'after') { failure = ''; throw new Error('Lost library acknowledgement'); }
    return Response.json({ catalog: listing(), receipt, replayed: false });
  }
  return { reset, handle, listing, actions: () => actions, configure: value => { legacy = Boolean(value.legacy); failure = value.failure || ''; if (value.rename) catalog.folders[0].name = value.rename; } };
}
export function installAssetLibraryFixture(app) {
  const fixture = assetLibraryFixture(); let enabled = false;
  app.post('/test/asset-library', (req, res) => { enabled = true; fixture.configure(req.body || {}); res.json({}); });
  app.get('/test/asset-library', (_req, res) => res.json({ catalog: fixture.listing(), actions: fixture.actions() }));
  app.use(['/minimax_h3_context_loop/project-assets', '/minimax_h3_context_loop/project-assets/library'], async (req, res, next) => {
    if (!enabled || !/^\/minimax_h3_context_loop\/project-assets(?:\/library)?(?:\?|$)/.test(req.originalUrl)) return next();
    try { const value = await fixture.handle(req.originalUrl, req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}); res.status(value.status).json(await value.json()); }
    catch { res.status(200).type('application/json').end('{"'); }
  });
  return { reset: () => { enabled = false; fixture.reset(); } };
}
