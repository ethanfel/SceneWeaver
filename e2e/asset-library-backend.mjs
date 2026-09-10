// Synthetic HTTP fixture. Native Python tests exercise real catalog/file writes.
import { createHash, randomUUID } from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export function assetLibraryFixture() {
  let catalog, sources, pending = {}, actions = [], receipts = {}, legacy = false, failure = '';
  const reset = () => {
    catalog = { project: 'sceneweaver_first_film', folders: [{ id: 'cast', name: 'Cast', color: '#567080' }, { id: 'places', name: 'Locations', color: '#705680' }], assets: [
      { id: 'hero', tag: 'hero', kind: 'image', role: 'picture', enabled: true, original_name: 'hero.png', relative_path: 'images/hero.png', folder_id: 'cast', source_kind: 'input' },
      { id: 'room', tag: 'room', kind: 'image', role: 'semantic_anchor', enabled: true, original_name: 'room.png', relative_path: 'images/room.png', folder_id: 'places' },
      { id: 'mix', tag: 'score', kind: 'audio', role: 'source_track', enabled: true, options: { audio_tracks: { full_mix: 'mix', vocals: 'vocals' } } },
      { id: 'vocals', tag: 'vocals', kind: 'audio', role: 'audio_reference', enabled: true },
    ] }; actions = []; receipts = {}; pending = {}; legacy = false; failure = '';
    sources = { source_film: { project: 'source_film', folders: [], assets: [
      { id: 'source_hero', tag: 'hero', kind: 'image', role: 'picture', enabled: true, original_name: 'hero.png', source_kind: 'derived_image', parent_asset_id: 'original_picture' },
      { id: 'source_mix', tag: 'imported_score', kind: 'audio', role: 'source_track', enabled: true, original_name: 'score.wav', options: { audio_tracks: { full_mix: 'source_mix', vocals: 'source_vocals', instrumental: '' } } },
      { id: 'source_vocals', tag: 'imported_vocals', kind: 'audio', role: 'audio_reference', enabled: false, original_name: 'vocals.wav' },
    ] }, empty_source: { project: 'empty_source', folders: [], assets: [] } };
  };
  reset();
  const operations = () => Object.values(pending).map(request => ({ operation_id: request.operation_id, action: request.action, asset_id: request.asset_id, phase: 'prepared' }));
  const listing = () => structuredClone({ ...catalog, revision: hash(catalog.assets.map(item => [item.id, item.tag, item.enabled])), ...(legacy ? {} : { library_command_version: 1, library_copy_version: 1, library_image_version: 1, library_capture_version: 1, library_pending_operations: operations(), library_pending_copies: operations().filter(item => item.action === 'asset_copy'), library_revision: hash(catalog) }) });
  const imageReview = (assetId, edit) => {
    const asset = catalog.assets.find(item => item.id === assetId);
    if (!asset || asset.kind !== 'image') return { error: 'Source image is unavailable.' };
    const info = { project: catalog.project, asset_id: assetId, asset, base_revision: hash(catalog), source: { width: 240, height: 160 }, max_pixels: 268435456, resampling: ['lanczos', 'bicubic', 'bilinear', 'nearest', 'box', 'hamming'] };
    if (!edit) return info;
    const { crop, target } = edit;
    if (!crop || !target || ![crop.x, crop.y, crop.width, crop.height, target.width, target.height].every(Number.isInteger) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > 240 || crop.y + crop.height > 160 || target.width < 1 || target.height < 1 || target.width * target.height > info.max_pixels) return { error: 'Crop or output dimensions exceed the native image bounds.' };
    return { ...info, ...edit, preview_revision: hash([info, edit]).repeat(2), copyable: true, issue: '' };
  };
  const review = (source, assetId, enabled, folder) => {
    const root = sources[source]?.assets.find(item => item.id === assetId);
    if (!root) return { error: 'Source asset is missing.' };
    const ids = new Set([root.id, ...Object.values(root.options?.audio_tracks || {}).filter(Boolean)]);
    const copyable = !(enabled && root.role === 'source_track' && catalog.assets.some(item => item.role === 'source_track' && item.enabled));
    return { project: catalog.project, source_project: source, asset_id: assetId, base_revision: hash(catalog), enabled, folder_id: folder,
      preview_revision: hash([catalog, sources[source], assetId, enabled, folder]).repeat(2), assets: sources[source].assets.filter(item => ids.has(item.id)), copyable, issue: copyable ? '' : 'The destination already has an enabled Source track. Copy this one disabled.' };
  };
  const frameReview = selection => {
    if (!selection.source?.file?.filename || !/^[0-9a-f]{32}$/.test(selection.source.revision) || !Number.isFinite(selection.time_seconds) || selection.time_seconds < 0 || selection.time_seconds >= 4.5) return { error: 'Choose a frame inside a saved clip.' };
    if (selection.folder_id && !catalog.folders.some(item => item.id === selection.folder_id)) return { error: 'Capture folder is unavailable.' };
    return { project: catalog.project, ...selection, base_revision: hash(catalog), preview_revision: hash([catalog, selection]).repeat(2), copyable: true, issue: '' };
  };
  async function handle(path, options = {}) {
    const url = new URL(path, 'http://fixture');
    if (!options.body) {
      if (url.searchParams.has('capture_frame')) { const value = frameReview(JSON.parse(url.searchParams.get('capture_frame'))); return Response.json(value, { status: value.error ? 400 : 200 }); }
      if (url.searchParams.has('image_asset')) { const value = imageReview(url.searchParams.get('image_asset'), url.searchParams.has('image_edit') ? JSON.parse(url.searchParams.get('image_edit')) : null); return Response.json(value, { status: value.error ? 400 : 200 }); }
      if (url.pathname.endsWith('/projects')) return Response.json({ items: [catalog, ...Object.values(sources)].map(item => ({ project: item.project, asset_count: item.assets.length })) });
      if (url.searchParams.has('copy_source')) return Response.json(review(url.searchParams.get('copy_source'), url.searchParams.get('copy_asset'), url.searchParams.get('enabled') === 'true', url.searchParams.get('folder_id') || ''));
      if (sources[url.searchParams.get('project')]) return Response.json(sources[url.searchParams.get('project')]);
      const operation = url.searchParams.get('operation_id'); return Response.json(operation ? { catalog: listing(), receipt: receipts[operation]?.receipt || null, pending_operation: pending[operation] ? { request: pending[operation], phase: 'prepared' } : null, pending_copy: pending[operation]?.action === 'asset_copy' ? { request: pending[operation], phase: 'prepared' } : null } : listing());
    }
    const body = JSON.parse(options.body);
    if (failure === 'before') { failure = ''; throw new Error('Dropped library request'); }
    if (failure === 'conflict' || failure === 'ownership') { const status = failure === 'conflict' ? 409 : 423; failure = ''; return Response.json({ error: status === 409 ? 'The library changed. Refresh and review.' : 'Project is read-only.' }, { status }); }
    const saved = receipts[body.operation_id];
    if (saved) return saved.fingerprint === hash(body) ? Response.json({ catalog: listing(), receipt: saved.receipt, replayed: true }) : Response.json({ error: 'Changed operation' }, { status: 400 });
    if (legacy || body.command_version !== 1) return Response.json({ error: 'Unsupported library command' }, { status: 400 });
    if (body.project !== catalog.project || body.base_revision !== listing().library_revision) return Response.json({ error: 'The library changed. Refresh and review.' }, { status: 409 });
    if (['asset_copy', 'asset_derive', 'asset_capture'].includes(body.action) && failure === 'prepared') { pending[body.operation_id] = structuredClone(body); failure = ''; throw new Error('Interrupted prepared media'); }
    const asset = catalog.assets.find(item => item.id === body.asset_id), folder = catalog.folders.find(item => item.id === body.folder_id);
    const beforeAssets = catalog.assets.map(item => item.id), beforeFolders = catalog.folders.map(item => item.id);
    const reorder = (values, ids) => {
      if (!Array.isArray(ids) || ids.length !== values.length || new Set(ids).size !== ids.length || ids.some(id => !values.some(item => item.id === id))) throw new Error('Order must contain every current ID exactly once.');
      return ids.map(id => values.find(item => item.id === id));
    };
    try {
      if (body.action === 'asset_capture') {
        const selection = Object.fromEntries(['source', 'time_seconds', 'tag', 'folder_id'].map(key => [key, body[key]])), value = frameReview(selection);
        if (value.error || value.preview_revision !== body.preview_revision) return Response.json({ error: value.error || 'Saved source changed after review.' }, { status: 409 });
        catalog.assets.push({ id: id('capture'), tag: body.tag, kind: 'image', role: 'picture', enabled: true, folder_id: body.folder_id, original_name: 'frame_capture.png', relative_path: `images/${body.operation_id}.png`, source_kind: 'frame_capture',
          source_origin: { project: catalog.project, kind: 'saved_frame', ...body.source, time_seconds: body.time_seconds } });
        delete pending[body.operation_id];
      }
      else if (body.action === 'asset_derive') {
        const edit = Object.fromEntries(['crop', 'target', 'resample', 'tag', 'folder_id'].map(key => [key, body[key]])), value = imageReview(body.asset_id, edit);
        if (value.error || value.preview_revision !== body.preview_revision) return Response.json({ error: value.error || 'Image source changed after review.' }, { status: 409 });
        catalog.assets.push({ ...structuredClone(asset), id: id('image'), tag: body.tag || `${asset.tag}_variant`, parent_asset_id: asset.id, source_kind: 'derived_image', enabled: true, folder_id: body.folder_id,
          metadata: { ...body.target }, relative_path: `images/${body.operation_id}.png`, transform: { kind: 'crop_resize', crop: body.crop, target: body.target, resample: body.resample, source: value.source, operation_id: body.operation_id } });
        delete pending[body.operation_id];
      }
      else if (body.action === 'asset_copy') {
        const preview = review(body.source_project, body.asset_id, body.enabled, body.folder_id);
        if (!preview.copyable || preview.preview_revision !== body.preview_revision) return Response.json({ error: preview.issue || 'Source changed after review.' }, { status: 409 });
        const mapped = Object.fromEntries(preview.assets.map(item => [item.id, id('copy')]));
        catalog.assets.push(...preview.assets.map((item, index) => ({ ...structuredClone(item), id: mapped[item.id], tag: item.tag === 'hero' ? 'hero_2' : item.tag,
          parent_asset_id: undefined, source_kind: 'project', source_origin: { project: body.source_project, asset_id: item.id, parent_asset_id: item.parent_asset_id },
          enabled: index === 0 ? body.enabled : false, role: index === 0 ? item.role : 'audio_reference', folder_id: body.folder_id,
          options: item.options?.audio_tracks ? { audio_tracks: Object.fromEntries(Object.entries(item.options.audio_tracks).map(([key, value]) => [key, mapped[value] || ''])) } : {} })));
        delete pending[body.operation_id];
      }
      else if (body.action === 'folder_create') { if (catalog.folders.some(item => item.name === body.name)) throw new Error('Folder already exists'); catalog.folders.push({ id: id('folder'), name: body.name, color: body.color }); }
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
  return { reset, handle, listing, actions: () => actions, configure: value => { legacy = Boolean(value.legacy); failure = value.failure || ''; if (value.rename) catalog.folders[0].name = value.rename; if (value.sourceRename) sources.source_film.assets[0].tag = value.sourceRename; } };
}
export function installAssetLibraryFixture(app) {
  const fixture = assetLibraryFixture(); let enabled = false;
  app.post('/test/asset-library', (req, res) => { enabled = true; fixture.configure(req.body || {}); res.json({}); });
  app.get('/test/asset-library', (_req, res) => res.json({ catalog: fixture.listing(), actions: fixture.actions() }));
  app.use(['/minimax_h3_context_loop/project-assets', '/minimax_h3_context_loop/project-assets/library'], async (req, res, next) => {
    if (!enabled || !/^\/minimax_h3_context_loop\/project-assets(?:\/library|\/projects)?(?:\?|$)/.test(req.originalUrl)) return next();
    try { const value = await fixture.handle(req.originalUrl, req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}); res.status(value.status).json(await value.json()); }
    catch { res.status(200).type('application/json').end('{"'); }
  });
  return { reset: () => { enabled = false; fixture.reset(); } };
}
