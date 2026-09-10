const endpoint = '/minimax_h3_context_loop/project-assets';
const actions = new Set(['folder_create', 'folder_update', 'folder_delete', 'folder_reorder', 'asset_update', 'asset_duplicate', 'asset_delete', 'asset_reorder', 'asset_copy', 'asset_derive']);

export function createAssetLibrary({ api, verify, write, imageSizing }) {
  const retained = new Map();
  const key = command => JSON.stringify([command.binding, command.node, command.project]);
  const validate = (catalog, command) => {
    if (catalog?.project !== command.project || !Array.isArray(catalog.assets) || !Array.isArray(catalog.folders ?? [])) throw new Error('H3 returned a library for an unexpected project.');
    for (const values of [catalog.assets, catalog.folders || []]) {
      const ids = values.map(item => item?.id);
      if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('H3 returned invalid library identities.');
    }
    return catalog;
  };
  const present = (catalog, command) => ({ catalog, writable: catalog.library_command_version === 1 && /^(empty|[0-9a-f]{32})$/.test(catalog.library_revision || ''),
    pending: retained.has(key(command)) ? { operation_id: retained.get(key(command)).operation_id, action: retained.get(key(command)).action } : null });
  async function read(command, operation) {
    verify(command);
    const response = await api.fetchApi(`${endpoint}?${new URLSearchParams({ project: command.project, create: 'false', ...(operation ? { operation_id: operation } : {}) })}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Cannot read the project library.');
    verify(command); return result;
  }
  async function inspect(command) {
    const pending = retained.get(key(command)), result = await read(command, pending?.operation_id);
    const catalog = validate(pending ? result.catalog : result, command);
    let message = '';
    if (pending && result.receipt) {
      if (result.receipt.operation_id !== pending.operation_id || result.receipt.project !== command.project) throw new Error('H3 returned an unexpected library receipt.');
      retained.delete(key(command)); message = 'The pending library change committed. Current library is shown.';
    }
    return { ...present(catalog, command), message };
  }
  async function source(command) {
    verify(command);
    if (command.source_project === command.project) throw new Error('Choose another project.');
    const params = command.source_project ? { project: command.source_project, create: 'false' } : {};
    const response = await api.fetchApi(`${endpoint}${command.source_project ? `?${new URLSearchParams(params)}` : '/projects'}`);
    const value = await response.json(); verify(command);
    if (!response.ok) throw new Error(value.error || 'Cannot browse other projects.');
    if (command.source_project) return validate(value, { project: command.source_project });
    if (!Array.isArray(value.items) || value.items.some(item => typeof item.project !== 'string')) throw new Error('H3 returned an invalid project list.');
    return { items: value.items.filter(item => item.project !== command.project) };
  }
  async function preview(command) {
    verify(command);
    if (!command.source_project || command.source_project === command.project) throw new Error('Choose another project.');
    const response = await api.fetchApi(`${endpoint}?${new URLSearchParams({ project: command.project, create: 'false', copy_source: command.source_project, copy_asset: command.asset_id, enabled: String(command.enabled), folder_id: command.folder_id || '' })}`);
    const value = await response.json(); verify(command);
    if (!response.ok) throw new Error(value.error || 'Cannot review this copy.');
    if (value.project !== command.project || value.source_project !== command.source_project || value.asset_id !== command.asset_id || value.enabled !== command.enabled || value.folder_id !== (command.folder_id || '') || !Array.isArray(value.assets) || !/^[0-9a-f]{64}$/.test(value.preview_revision || '')) throw new Error('H3 returned a copy preview for an unexpected selection.');
    return value;
  }
  async function inspectImage(command) {
    verify(command);
    const response = await api.fetchApi(`${endpoint}?${new URLSearchParams({ project: command.project, create: 'false', image_asset: command.asset_id, ...(command.edit ? { image_edit: JSON.stringify(command.edit) } : {}) })}`);
    const value = await response.json(); verify(command);
    if (!response.ok) throw new Error(value.error || 'Cannot inspect this image.');
    if (value.project !== command.project || value.asset_id !== command.asset_id || value.asset?.id !== command.asset_id || !Number.isInteger(value.source?.width) || !Number.isInteger(value.source?.height) || value.source.width < 1 || value.source.height < 1 || !Array.isArray(value.resampling) || command.edit && !/^[0-9a-f]{64}$/.test(value.preview_revision || '')) throw new Error('H3 returned an image review for an unexpected source.');
    return value;
  }
  function dimensions(command) {
    verify(command);
    if (!imageSizing) throw new Error('The installed H3 image-sizing helpers are unavailable.');
    const value = command.size;
    if (!value || ![1, 8, 16, 32, 64].includes(value.multiple) || !Number.isFinite(value.ratio) || value.ratio <= 0 || ![value.width, value.height, value.megapixels].filter(item => item !== undefined).every(item => Number.isFinite(item) && item > 0)) throw new Error('Image size and aspect ratio must be positive.');
    if (value.mode === 'megapixels') {
      if (!(Number.isFinite(value.megapixels) && value.megapixels > 0)) throw new Error('Target megapixels must be positive.');
      return imageSizing.dimensionsForMegapixels(value.megapixels, value.ratio, value.multiple);
    }
    if (![value.width, value.height].every(item => Number.isFinite(item) && item > 0)) throw new Error('Output dimensions must be positive.');
    if (!['width', 'height'].includes(value.changed)) throw new Error('Choose the dimension to update.');
    return imageSizing.coupledOutputDimensions(value.width, value.height, value.changed, value.ratio, value.locked === true, value.multiple);
  }
  async function mutate(command) {
    verify(command);
    let body = retained.get(key(command));
    if (command.retry) {
      if (!body && (command.resume_copy || command.resume_operation)) {
        const status = await read(command, command.operation_id);
        validate(status.catalog, command);
        const recovered = (status.pending_operation || status.pending_copy)?.request;
        if (status.receipt?.operation_id === command.operation_id && status.receipt.project === command.project) return { data: present(status.catalog, command) };
        if (!recovered || recovered.project !== command.project || recovered.operation_id !== command.operation_id || !['asset_copy', ...(command.resume_operation ? ['asset_derive'] : [])].includes(recovered.action) || recovered.command_version !== 1) throw new Error('No matching recoverable media operation was found in H3.');
        body = recovered; retained.set(key(command), body);
      }
      if (!body || body.operation_id !== command.operation_id) throw new Error('No matching library request is retained in this ComfyUI tab.');
    } else {
      if (body) throw new Error('Check the pending library change before sending another.');
      const catalog = validate(await read(command), command);
      if (!present(catalog, command).writable) throw new Error('Update H3 to enable conditional library edits.');
      if (catalog.library_revision !== command.base_revision) throw new Error('The library changed. Refresh and review before applying.');
      if (!actions.has(command.library_action)) throw new Error('Unsupported library action.');
      if (command.library_action === 'asset_copy' && catalog.library_copy_version !== 1) throw new Error('Update H3 to enable reviewed project copies.');
      if (command.library_action === 'asset_derive' && catalog.library_image_version !== 1) throw new Error('Update H3 to enable reviewed image variants.');
      const fields = Object.fromEntries(['asset_id', 'folder_id', 'name', 'color', 'tag', 'changes', 'asset_ids', 'folder_ids', 'source_project', 'enabled', 'preview_revision', 'crop', 'target', 'resample'].filter(field => Object.hasOwn(command, field)).map(field => [field, command[field]]));
      body = { command_version: 1, project: command.project, action: command.library_action,
        operation_id: crypto.randomUUID().replaceAll('-', ''), base_revision: catalog.library_revision, ...fields };
      retained.set(key(command), body);
    }
    try {
      const result = await write(command, `${endpoint}/library`, body);
      const catalog = validate(result.data.catalog, command);
      if (result.data.receipt?.operation_id !== body.operation_id || result.data.receipt?.project !== command.project) throw new Error('The library change was not confirmed. Check its result before retrying.');
      retained.delete(key(command));
      return { ...result, data: { ...present(catalog, command), receipt: result.data.receipt, replayed: result.data.replayed } };
    } catch (error) {
      if ([400, 409, 423].includes(error.httpStatus)) { retained.delete(key(command)); error.outcome = 'rejected'; }
      throw error;
    }
  }
  return { inspect, mutate, source, preview, inspectImage, dimensions };
}
