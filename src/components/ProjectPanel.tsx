import { ImageEditor } from './ImageEditor';
import { ProjectImport } from './ProjectImport';
import { LibraryBins, LibraryOrganizer, foldersFor, type LibraryState, type LibrarySelection } from './LibraryOrganizer';
import { readPlan, promptText } from '../lib/h3';
import { resolvePlanDocument } from '../../public/integrations/plan-source.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, FolderOpen, Image, Music2, RefreshCw, Upload } from 'lucide-react';
import type { LiveResult, PreviewMedia, ProjectAsset, ProjectCatalog, Workflow } from '../types';
import { comfy, H3 } from '../lib/api';
import { resolvePlanBinding } from '../../public/integrations/binding-core.mjs';

type Command = (action: string, options?: Record<string, unknown>) => Promise<LiveResult>;
type Mutate = (action: string, options: Record<string, unknown>) => Promise<boolean>;
const roles: Record<string, string[]> = { image: ['picture', 'semantic_anchor'], video: ['video', 'motion', 'source_track'], audio: ['audio_reference', 'source_track'] };
const assetUrl = (project: string, id: string, variant = 'preview') => `/comfy${H3}/project-assets/media?${new URLSearchParams({ project, asset: id, variant })}`;
const trackRoles = [['full_mix', 'Full mix · final soundtrack'], ['vocals', 'Vocals · lip-sync driver'], ['instrumental', 'Instrumental · optional backing']];
const optionsFor = (asset: ProjectAsset) => asset.options as Record<string, unknown> || {};
const tracksFor = (asset: ProjectAsset): Record<string, string> => Object.fromEntries(trackRoles.map(([role]) => [role, String((optionsFor(asset).audio_tracks as Record<string, string> | undefined)?.[role] ?? (optionsFor(asset).audio_tracks ? '' : role === 'full_mix' ? asset.id : ''))]));
const assetFields = (asset: ProjectAsset) => ({ tag: asset.tag, role: asset.role, enabled: asset.enabled !== false, lyrics: asset.lyrics || '' });
function planMentions(workflow: Workflow, planId: string, asset: ProjectAsset): string[] {
  const source = resolvePlanDocument(workflow.prompt, planId);
  if (source.status !== 'resolved') return ['Plan text is unresolved'];
  try {
    const plan = readPlan(source.text);
    const mentions = (text: unknown) => (promptText(text).match(/[@#][A-Za-z][A-Za-z0-9_-]{0,63}/g) || []).some(token => token.slice(1) === asset.tag);
    return [...(mentions(plan.prompt_prefix ?? plan.global_prompt) ? ['Shared direction'] : []), ...plan.shots.flatMap((shot, index) => mentions(shot.prompt) ? [shot.id || `Scene ${index + 1}`] : [])];
  } catch { return ['Plan text could not be read']; }
}

function AudioTracks({ asset, assets, editable, mutate }: { asset: ProjectAsset; assets: ProjectAsset[]; editable: boolean; mutate: Mutate }) {
  const [base, setBase] = useState(asset), [tracks, setTracks] = useState(() => tracksFor(asset));
  const dirty = JSON.stringify(tracks) !== JSON.stringify(tracksFor(base));
  const changed = JSON.stringify(optionsFor(asset)) !== JSON.stringify(optionsFor(base));
  const reset = () => { setBase(asset); setTracks(tracksFor(asset)); };
  useEffect(() => { if (!dirty || JSON.stringify(tracks) === JSON.stringify(tracksFor(asset))) reset(); }, [asset]);
  const ids = Object.values(tracks).filter(Boolean);
  const valid = ids.length > 0 && ids.every(id => assets.some(item => item.id === id && item.enabled !== false && ['audio', 'video'].includes(item.kind)));
  return <fieldset className="audio-tracks" disabled={!editable}><legend>Synchronized audio tracks</legend><p>Keep stems at the full song length, including silence. A full mix is used unchanged; otherwise vocals and instrumental are mixed. Set scene Lip-sync in Plan Studio.</p>
    {trackRoles.map(([role, label]) => <label className="field" key={role}><span>{label}</span><select aria-label={`${label} for ${asset.tag}`} value={tracks[role]} onChange={event => { const id = event.target.value; setTracks(old => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, key === role ? id : id && value === id ? '' : value]))); }}><option value="">None</option>{assets.filter(item => ['audio', 'video'].includes(item.kind) && item.enabled !== false || item.id === tracks[role]).map(item => <option value={item.id} key={item.id}>{item.tag || item.original_name}{item.enabled === false ? ' (disabled)' : ''}</option>)}{tracks[role] && !assets.some(item => item.id === tracks[role]) && <option value={tracks[role]}>Missing asset</option>}</select></label>)}
    <div className="project-actions"><button disabled={!dirty || changed || !valid} onClick={() => void mutate('asset-audio-tracks', { asset_id: asset.id, tracks, before_options: optionsFor(base) })}>Apply audio tracks</button><button disabled={changed || !optionsFor(base).audio_tracks} onClick={() => void mutate('asset-audio-tracks', { asset_id: asset.id, tracks: null, before_options: optionsFor(base) })}>Reset to single track</button></div>
    {!valid && <p className="asset-conflict">Select at least one enabled audio or video asset.</p>}{changed && dirty && <p className="asset-conflict">Tracks changed in ComfyUI. <button onClick={reset}>Reload tracks</button></p>}
  </fieldset>;
}
function AssetCard({ hidden, asset, assets, project, mutate, preview, editable, audioTracks, organize, drag, imageEdit, imageSupported }: { imageEdit?: () => void; imageSupported?: boolean; organize?: () => void; drag?: boolean; hidden?: boolean; asset: ProjectAsset; assets: ProjectAsset[]; project: string; mutate: Mutate; preview: (url: string, name: string, details?: Partial<PreviewMedia>) => void; editable: boolean; audioTracks?: boolean }) {
  const [base, setBase] = useState(asset), [fields, setFields] = useState(() => assetFields(asset));
  const dirty = JSON.stringify(fields) !== JSON.stringify(assetFields(base));
  const changed = JSON.stringify(assetFields(asset)) !== JSON.stringify(assetFields(base));
  const reset = () => { setBase(asset); setFields(assetFields(asset)); };
  useEffect(() => { if (!dirty || JSON.stringify(fields) === JSON.stringify(assetFields(asset))) reset(); }, [asset]);
  const sound = ['audio', 'video'].includes(asset.kind);
  return <article className="asset-card" hidden={hidden} draggable={drag} onDragStart={event => { if (drag) event.dataTransfer.setData('application/x-sceneweaver-asset', asset.id); }}><button className="asset-preview" onClick={() => preview(assetUrl(project, asset.id), asset.original_name || `${asset.tag}.${asset.kind === 'image' ? 'png' : asset.kind === 'audio' ? 'wav' : 'mp4'}`, { kind: asset.kind as PreviewMedia['kind'] })}>
    {asset.kind === 'image' || asset.kind === 'video' ? <img loading="lazy" src={assetUrl(project, asset.id, 'thumbnail')} alt={asset.tag}/> : <Music2 size={30}/>}<span>{asset.kind}</span>
  </button><div className="asset-card-fields"><label className="field"><span>Reference tag</span><input aria-label={`Tag for ${asset.tag}`} value={fields.tag} disabled={!editable} onChange={e => setFields({ ...fields, tag: e.target.value })}/></label><label className="field"><span>Role</span><select aria-label={`Role for ${asset.tag}`} value={fields.role} disabled={!editable} onChange={e => setFields({ ...fields, role: e.target.value })}>{[...new Set([asset.role, ...roles[asset.kind] || []])].map(value => <option key={value}>{value}</option>)}</select></label>
    {sound && <label className="field"><span>Lyrics / SRT captions</span><textarea aria-label={`Lyrics and captions for ${asset.tag}`} rows={4} value={fields.lyrics} disabled={!editable} onChange={event => setFields({ ...fields, lyrics: event.target.value })}/></label>}
    <div className="asset-card-actions"><label><input type="checkbox" checked={fields.enabled} disabled={!editable} onChange={e => setFields({ ...fields, enabled: e.target.checked })}/>Enabled</label><button disabled={!editable || !dirty || changed} onClick={() => { const before = assetFields(base), changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => before[key as keyof typeof before] !== value)); void mutate('asset-update', { asset_id: asset.id, changes, before: Object.fromEntries(Object.keys(changes).map(key => [key, before[key as keyof typeof before]])) }); }}><Check size={12}/>Apply</button><a className="button" aria-label={`Download ${asset.tag}`} href={assetUrl(project, asset.id, 'original')} download={asset.original_name}><ArrowDownToLine size={13}/></a></div>{organize && <button onClick={organize}>Organize {asset.tag}</button>}{imageEdit && <button disabled={!imageSupported} title={imageSupported ? 'Crop, resize and create a derived picture' : 'Update H3 to enable reviewed image variants'} onClick={imageEdit}>Edit image {asset.tag}</button>}{changed && dirty && <p className="asset-conflict">Changed in ComfyUI. <button onClick={reset}>Reload asset</button></p>}
    {sound && asset.role === 'source_track' && (audioTracks ? <AudioTracks asset={asset} assets={assets} editable={editable && !dirty} mutate={mutate}/> : <p className="hint">Open the Asset Carousel to manage soundtrack stems. Refresh ComfyUI and reopen SceneWeaver to detect synchronized audio support.</p>)}
  </div></article>;
}
export function ProjectPanel({ project, planId, branchId, workflow, connected, editable, audioTracks, libraryBridge, copyBridge, imageBridge, command, preview, report, scope = 'all' }: { imageBridge?: boolean; copyBridge?: boolean; libraryBridge?: boolean; scope?: 'all' | 'audio'; project: string; planId: string; branchId: string; workflow: Workflow; connected: boolean; editable: boolean; audioTracks?: boolean; command: Command; preview: (url: string, name: string, details?: Partial<PreviewMedia>) => void; report: (error: string) => void }) {
  const [catalog, setCatalog] = useState<ProjectCatalog | null>(null), [busy, setBusy] = useState(false), [inputPath, setInputPath] = useState(''), [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [writing, setWriting] = useState(false);
  const [imageEditing, setImageEditing] = useState<ProjectAsset | null>(null);
  const [importing, setImporting] = useState(false);
  const [library, setLibrary] = useState<LibraryState | null>(null), [folder, setFolder] = useState('*'), [organizing, setOrganizing] = useState<LibrarySelection | null>(null);
  const commandRef = useRef(command); commandRef.current = command;
  const requestRef = useRef<AbortController | null>(null), epoch = useRef(0), reportRef = useRef(report); reportRef.current = report;
  const binding = resolvePlanBinding(workflow.prompt, planId);
  const manager = binding.status === 'bound' && binding.project === project ? binding.managerId : undefined;
  const catalogVersion = manager ? workflow.prompt[manager].inputs.catalog_json : '';
  const read = useCallback(async () => {
    requestRef.current?.abort(); if (!project || !connected) return;
    const controller = new AbortController(); requestRef.current = controller; setBusy(true);
    try {
      const next = libraryBridge && manager ? (await commandRef.current('asset-library-inspect', { node: manager, plan: planId, branch_id: branchId, project })).data as LibraryState : null;
      const value = next?.catalog || await comfy<ProjectCatalog>(`${H3}/project-assets?${new URLSearchParams({ project, create: 'false' })}`, { signal: controller.signal });
      if (value.project !== project || !Array.isArray(value.assets)) throw new Error('H3 returned an unexpected asset catalog.');
      if (!controller.signal.aborted) { setCatalog(value); setLibrary(next); }
    } catch (error) { if (!controller.signal.aborted) { setLibrary(null); reportRef.current(String(error)); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [project, connected, manager, libraryBridge, planId, branchId]);
  useEffect(() => { void read(); const timer = setInterval(() => void read(), 15000); return () => { clearInterval(timer); epoch.current++; requestRef.current?.abort(); }; }, [read, catalogVersion]);
  useEffect(() => { if (folder !== '*' && folder && catalog && !foldersFor(catalog).some(item => item.id === folder)) setFolder(''); }, [catalog, folder]);
  const mutate: Mutate = async (action, options) => {
    if (!manager || !editable || writing) { report('Attach the live project and apply its prompt draft before managing assets.'); return false; }
    if (action === 'asset-update' && library?.writable) {
      options = { ...options, library_action: 'asset_update', base_revision: catalog?.library_revision };
      action = 'asset-library-mutate';
    }
    const started = epoch.current; setWriting(true);
    try { const result = await command(action, { node: manager, plan: planId, branch_id: branchId, project, ...options }); if (result.warning) reportRef.current(result.warning); if (epoch.current === started) await read(); return true; }
    catch (error) { reportRef.current(String(error)); if (epoch.current === started) await read(); return false; } finally { setWriting(false); }
  };
  if (!project) return <div className="empty-large"><FolderOpen size={32}/><h3>Attach an H3 project</h3><p>The selected workflow’s Plan and Asset Carousel identify its project.</p></div>;
  const filterKind = scope === 'audio' && kind === 'image' ? 'all' : kind;
  const libraryWritable = Boolean(editable && manager && library?.writable && !library.pending && !writing && !busy);
  const visible = catalog?.assets.filter(asset => (scope === 'audio' || folder === '*' || String(asset.folder_id || '') === folder) && (scope === 'all' || ['audio', 'video'].includes(asset.kind)) && (filterKind === 'all' || asset.kind === filterKind) && `${asset.tag} ${asset.original_name || ''} ${asset.role}`.toLowerCase().includes(search.toLowerCase())) || [];
  return <div className="project-panel"><div className="section-heading"><div><h2>{scope === 'audio' ? 'Soundtrack & captions' : 'Project assets'}</h2><p>{project} · assets are shared across working branches</p></div><button disabled={busy || writing || !connected} onClick={() => void read()}><RefreshCw size={13}/>{busy ? 'Reading…' : 'Refresh'}</button></div>
    {scope === 'audio' && <p className="hint">Manage full mix, vocals, instrumental and caption text. Lip-sync, source offsets and saved subtitle mode remain in Plan Studio.</p>}
    <div className="project-actions">{scope === 'all' && copyBridge && manager && <button disabled={!connected || writing} onClick={() => setImporting(true)}><FolderOpen size={14}/>Other projects</button>}<label className={`button ${!editable || !manager ? 'disabled' : ''}`}><Upload size={14}/>Upload to project<input type="file" hidden accept="image/*,video/*,audio/*" disabled={!editable || !manager || busy || writing} onChange={async e => { const input = e.currentTarget, file = input.files?.[0]; if (file) await mutate('asset-upload', { file, filename: file.name }); input.value = ''; }}/></label>{manager && editable && <button onClick={() => void command('focus', { node: manager }).catch(e => report(String(e)))}><ArrowUpRight size={13}/>Show carousel in ComfyUI</button>}</div>
    {!editable && <p className="hint">Attach the live workflow and apply its prompt draft to manage assets. Existing assets remain available for preview and download.</p>}
    {binding.issues.map(issue => <p className="hint" key={issue}>{issue}</p>)}
    <div className="asset-import"><input aria-label="ComfyUI input media path" placeholder="Existing ComfyUI input path, e.g. references/hero.png" value={inputPath} onChange={e => setInputPath(e.target.value)} disabled={!editable || !manager}/><button disabled={!editable || !manager || !inputPath.trim() || busy || writing} onClick={() => void mutate('asset-import', { path: inputPath })}><FolderOpen size={13}/>Import</button></div>
    <div className="asset-filters"><input aria-label="Search project assets" placeholder="Find a tag, filename or role…" value={search} onChange={e => setSearch(e.target.value)}/><select aria-label="Filter asset type" value={filterKind} onChange={e => setKind(e.target.value)}>{(scope === 'audio' ? ['all', 'video', 'audio'] : ['all', 'image', 'video', 'audio']).map(value => <option key={value}>{value}</option>)}</select><span>{visible.length} assets</span></div>
    {scope === 'all' && catalog && <>{!library?.writable && <p className="hint">Folder browsing is available. Update H3 to enable library organization.</p>}{library?.message && <p role="status">{library.message}</p>}{library?.pending && <div className="playback-notice"><p>Unconfirmed library change: {library.pending.action}. The ComfyUI tab retains its exact request.</p><button disabled={busy || writing} onClick={() => void read()}>Check library result</button><button disabled={!editable || busy || writing} onClick={() => void mutate('asset-library-mutate', { retry: true, operation_id: library.pending!.operation_id })}>Retry exact library change</button></div>}</>}
    {scope === 'all' && imageBridge && ((catalog?.library_pending_operations || []) as { action: string; operation_id: string; asset_id: string; phase: string }[]).filter(item => item.action === 'asset_derive').map(item => <div className="playback-notice" key={item.operation_id}><p>Unfinished image variant · {item.phase} · {catalog?.assets.find(asset => asset.id === item.asset_id)?.tag || item.asset_id}</p><button disabled={!libraryWritable} onClick={() => void mutate('asset-library-mutate', { retry: true, resume_operation: true, operation_id: item.operation_id })}>Resume image variant</button></div>)}
    <div className={scope === 'all' ? 'asset-library-layout' : ''}>
      {scope === 'all' && catalog && <LibraryBins catalog={catalog} selected={folder} select={setFolder} editable={libraryWritable} manage={setOrganizing} move={(asset, target) => void mutate('asset-library-mutate', { library_action: 'asset_update', base_revision: catalog.library_revision, asset_id: asset, changes: { folder_id: target } })}/>}
      <div className="asset-grid">{catalog?.assets.map(asset => <AssetCard hidden={!visible.includes(asset)} key={`${project}:${asset.id}`} asset={asset} assets={catalog?.assets || []} project={project} editable={editable && Boolean(manager) && !writing} audioTracks={audioTracks} preview={preview} mutate={mutate} imageEdit={scope === 'all' && imageBridge && manager && asset.kind === 'image' ? () => setImageEditing(asset) : undefined} imageSupported={connected && catalog?.library_image_version === 1} organize={scope === 'all' ? () => setOrganizing({ kind: 'asset', id: asset.id }) : undefined} drag={scope === 'all' && libraryWritable}/>)}</div>
    </div>
    {scope === 'all' && catalog && organizing && <LibraryOrganizer key={JSON.stringify(organizing)} catalog={catalog} selection={organizing} editable={libraryWritable} visibleIds={visible.map(item => item.id)} mentions={asset => planMentions(workflow, planId, asset)} mutate={mutate} close={() => setOrganizing(null)}/> }
    {scope === 'all' && catalog && imageEditing && <ImageEditor asset={catalog.assets.find(item => item.id === imageEditing.id) || imageEditing} catalog={catalog} editable={libraryWritable} command={(action, options) => command(action, { node: manager, plan: planId, branch_id: branchId, project, ...options })} mutate={mutate} close={() => setImageEditing(null)}/>}
    {scope === 'all' && catalog && importing && <ProjectImport catalog={catalog} editable={libraryWritable} command={(action, options) => command(action, { node: manager, plan: planId, branch_id: branchId, project, ...options })} mutate={mutate} close={() => setImporting(false)}/>}
    {catalog && !visible.length && <div className="empty-large"><Image size={30}/><p>{catalog.assets.length ? 'No matching assets.' : 'No media in this project yet.'}</p></div>}
    {!!catalog?.reference_slots?.length && <p className="hint">{catalog.reference_slots.length} reference slots are defined. Bind or reorganize slots in the original Asset Carousel.</p>}
  </div>;
}
