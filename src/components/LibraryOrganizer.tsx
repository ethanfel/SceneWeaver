import { useState } from 'react';
import type { ProjectAsset, ProjectCatalog } from '../types';
import { Modal } from './Controls';

export type LibraryFolder = { id: string; name: string; color?: string };
export type LibraryState = { catalog: ProjectCatalog; writable: boolean; pending: { action: string; operation_id: string } | null; message?: string };
export type LibraryMutation = (action: string, options: Record<string, unknown>) => Promise<boolean>;
export type LibrarySelection = { kind: 'new' } | { kind: 'folder' | 'asset'; id: string };
export const foldersFor = (catalog: ProjectCatalog | null): LibraryFolder[] => Array.isArray(catalog?.folders) ? catalog.folders as LibraryFolder[] : [];
export function moved(ids: string[], selected: string, direction: number) {
  const result = [...ids], index = ids.indexOf(selected), next = index + direction;
  if (index >= 0 && next >= 0 && next < ids.length) [result[index], result[next]] = [result[next], result[index]];
  return result;
}
export function LibraryBins(p: { catalog: ProjectCatalog; selected: string; select: (id: string) => void; editable: boolean; manage: (value: LibrarySelection) => void; move: (id: string, folder: string) => void }) {
  const folders = foldersFor(p.catalog);
  const bin = (id: string, label: string, count: number) => <button key={id} className={p.selected === id ? 'selected' : ''} aria-pressed={p.selected === id} onClick={() => p.select(id)} onDragOver={event => { if (p.editable && id !== '*') event.preventDefault(); }} onDrop={event => { const asset = event.dataTransfer.getData('application/x-sceneweaver-asset'); if (p.editable && id !== '*' && p.catalog.assets.some(item => item.id === asset)) { event.preventDefault(); p.move(asset, id); } }}><span>{label}</span><small>{count}</small></button>;
  return <nav className="library-bins" aria-label="Project media folders"><strong>Folders</strong>
    <button disabled={!p.editable} onClick={() => p.manage({ kind: 'new' })}>New folder</button>
    {folders.some(item => item.id === p.selected) && <button onClick={() => p.manage({ kind: 'folder', id: p.selected })}>Edit folder</button>}
    <div className="library-bin-list">{bin('*', 'All media', p.catalog.assets.length)}{bin('', 'Unfiled', p.catalog.assets.filter(item => !item.folder_id).length)}
    {folders.map(folder => bin(folder.id, folder.name, p.catalog.assets.filter(item => item.folder_id === folder.id).length))}</div>
  </nav>;
}
export function LibraryOrganizer(p: { catalog: ProjectCatalog; selection: LibrarySelection; editable: boolean; visibleIds: string[]; mentions: (asset: ProjectAsset) => string[]; mutate: LibraryMutation; close: () => void }) {
  const selectedId = 'id' in p.selection ? p.selection.id : '';
  const folders = foldersFor(p.catalog), asset = p.selection.kind === 'asset' ? p.catalog.assets.find(item => item.id === selectedId) : undefined;
  const folder = p.selection.kind === 'folder' ? folders.find(item => item.id === selectedId) : undefined;
  const [base] = useState(p.catalog.library_revision), [name, setName] = useState(folder?.name || ''), [color, setColor] = useState(folder?.color || '#46596b');
  const [tag, setTag] = useState(''), [destination, setDestination] = useState(String(asset?.folder_id || '')), [deleting, setDeleting] = useState(false), [busy, setBusy] = useState(false);
  const stale = base !== p.catalog.library_revision, enabled = p.editable && !busy && !stale;
  async function apply(library_action: string, fields: Record<string, unknown>) {
    if (!enabled) return; setBusy(true);
    try { if (await p.mutate('asset-library-mutate', { library_action, base_revision: base, ...fields })) p.close(); }
    finally { setBusy(false); }
  }
  const owners = asset ? p.catalog.assets.filter(item => item.id !== asset.id && Object.values((item.options as { audio_tracks?: Record<string, string> } | undefined)?.audio_tracks || {}).includes(asset.id)) : [];
  const shares = asset?.relative_path ? p.catalog.assets.filter(item => item.id !== asset.id && item.relative_path === asset.relative_path) : [];
  const position = asset ? p.visibleIds.indexOf(asset.id) : -1;
  const orderAsset = (direction: number) => {
    if (!asset) return;
    const neighbor = p.visibleIds[position + direction], ids = p.catalog.assets.map(item => item.id), a = ids.indexOf(asset.id), b = ids.indexOf(neighbor);
    if (a >= 0 && b >= 0) { [ids[a], ids[b]] = [ids[b], ids[a]]; void apply('asset_reorder', { asset_ids: ids }); }
  };
  return <Modal title={asset ? `Organize ${asset.tag}` : folder ? `Folder: ${folder.name}` : 'New project folder'} onClose={p.close}>
    <div className="modal-body library-organizer">
      <p>{p.catalog.project} · shared across working branches</p>
      {stale && <p role="alert">The library changed. Close this dialog and review its current contents before editing.</p>}
      {!p.editable && <p>Editing is currently unavailable. Check the connection, pending action and H3 update status.</p>}
      {asset ? <>
        <dl><dt>Kind / role</dt><dd>{asset.kind} / {asset.role}</dd><dt>Source</dt><dd>{asset.original_name || 'Unbound media'}</dd><dt>Provenance</dt><dd>{String(asset.source_kind || 'Not reported')}{asset.parent_asset_id ? ` · parent ${String(asset.parent_asset_id)}` : ''}</dd></dl>
        <label className="field"><span>Asset folder</span><select aria-label="Asset folder" value={destination} onChange={event => setDestination(event.target.value)}><option value="">Unfiled</option>{folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button disabled={!enabled || destination === String(asset.folder_id || '')} onClick={() => void apply('asset_update', { asset_id: asset.id, changes: { folder_id: destination } })}>Move to folder</button>
        <div className="project-actions"><button disabled={!enabled || position <= 0} onClick={() => orderAsset(-1)}>Move earlier</button><button disabled={!enabled || position < 0 || position >= p.visibleIds.length - 1} onClick={() => orderAsset(1)}>Move later</button></div><p>Ordering swaps adjacent cards in the current filter and keeps other cards in place.</p>
        <label className="field"><span>Duplicate tag (optional)</span><input value={tag} maxLength={64} onChange={event => setTag(event.target.value)} placeholder="Let H3 choose a unique tag"/></label><button disabled={!enabled} onClick={() => void apply('asset_duplicate', { asset_id: asset.id, folder_id: destination, ...(tag.trim() ? { tag: tag.trim() } : {}) })}>Duplicate card</button>
        <p>The duplicate shares its media bytes and retains source/derived metadata. A duplicated Source track starts disabled.</p>
        <div className="library-usage"><strong>Usage in this view</strong><p>Plan tag mentions: {p.mentions(asset).join(', ') || 'None in the selected Plan'}.</p><p>Track groups: {owners.map(item => item.tag).join(', ') || 'None'}. Shared media cards: {shares.map(item => item.tag).join(', ') || 'None'}.</p><p>Tag mentions are text references, not proof of activation. Other Plans, saved branches, schedules and archives are not covered by this view.</p></div>
        <button disabled={!enabled || Boolean(owners.length)} onClick={() => setDeleting(true)}>Delete asset…</button>
        {!!owners.length && <p>Detach this asset from its track group before deleting it.</p>}
        {deleting && <div className="library-delete-review"><p>Remove this card and its unshared project-owned input media, previews and H3 backup? The original imported file is retained. Prompt mentions are not rewritten.</p><button disabled={!enabled || Boolean(owners.length)} onClick={() => void apply('asset_delete', { asset_id: asset.id })}>Confirm asset deletion</button><button onClick={() => setDeleting(false)}>Cancel deletion</button></div>}
      </> : p.selection.kind === 'new' || folder ? <>
        <label className="field"><span>Folder name</span><input value={name} maxLength={80} onChange={event => setName(event.target.value)}/></label><label className="field"><span>Folder color</span><input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#46596b'} onChange={event => setColor(event.target.value)}/></label>
        <button disabled={!enabled || !name.trim()} onClick={() => void apply(folder ? 'folder_update' : 'folder_create', folder ? { folder_id: folder.id, changes: { name, color } } : { name, color })}>{folder ? 'Save folder' : 'Create folder'}</button>
        {folder && <><div className="project-actions"><button disabled={!enabled || folders[0]?.id === folder.id} onClick={() => void apply('folder_reorder', { folder_ids: moved(folders.map(item => item.id), folder.id, -1) })}>Folder earlier</button><button disabled={!enabled || folders.at(-1)?.id === folder.id} onClick={() => void apply('folder_reorder', { folder_ids: moved(folders.map(item => item.id), folder.id, 1) })}>Folder later</button></div><p>Removing a folder moves its {p.catalog.assets.filter(item => item.folder_id === folder.id).length} cards to Unfiled; it does not delete their media.</p><button disabled={!enabled} onClick={() => void apply('folder_delete', { folder_id: folder.id })}>Remove folder</button></>}
      </> : <p>This library item is no longer available.</p>}
    </div><footer><button onClick={p.close}>Close organizer</button></footer>
  </Modal>;
}
