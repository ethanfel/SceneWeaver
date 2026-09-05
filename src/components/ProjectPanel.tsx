import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, Film, FolderOpen, Image, Music2, RefreshCw, Upload } from 'lucide-react';
import type { LiveResult, ProjectAsset, ProjectCatalog, Revision, Workflow } from '../types';
import { comfy, H3, mediaUrl } from '../lib/api';
import { downloadJSON } from '../lib/workflow';
import { timecode } from '../lib/h3';

type Command = (action: string, options?: Record<string, unknown>) => Promise<LiveResult>;
const roles: Record<string, string[]> = { image: ['picture', 'semantic_anchor'], video: ['video', 'motion'], audio: ['audio_reference', 'source_track'] };
const assetUrl = (project: string, id: string, variant = 'preview') => `/comfy${H3}/project-assets/media?${new URLSearchParams({ project, asset: id, variant })}`;
function AssetCard({ asset, project, save, preview, editable }: { asset: ProjectAsset; project: string; save: (asset: ProjectAsset, changes: Record<string, unknown>) => Promise<void>; preview: (url: string, name: string) => void; editable: boolean }) {
  const [base, setBase] = useState(asset);
  const [tag, setTag] = useState(asset.tag), [role, setRole] = useState(asset.role), [enabled, setEnabled] = useState(asset.enabled !== false), [busy, setBusy] = useState(false);
  const dirty = tag !== base.tag || role !== base.role || enabled !== (base.enabled !== false);
  const changed = asset.tag !== base.tag || asset.role !== base.role || (asset.enabled !== false) !== (base.enabled !== false);
  const reset = () => { setBase(asset); setTag(asset.tag); setRole(asset.role); setEnabled(asset.enabled !== false); };
  useEffect(() => { if (!dirty || tag === asset.tag && role === asset.role && enabled === (asset.enabled !== false)) reset(); }, [asset.tag, asset.role, asset.enabled]);
  return <article className="asset-card"><button className="asset-preview" onClick={() => preview(assetUrl(project, asset.id), asset.original_name || `${asset.tag}.${asset.kind === 'image' ? 'png' : asset.kind === 'audio' ? 'wav' : 'mp4'}`)}>
    {asset.kind === 'image' || asset.kind === 'video' ? <img loading="lazy" src={assetUrl(project, asset.id, 'thumbnail')} alt={asset.tag}/> : <Music2 size={30}/>}<span>{asset.kind}</span>
  </button><div className="asset-card-fields"><label className="field"><span>Reference tag</span><input aria-label={`Tag for ${asset.tag}`} value={tag} disabled={!editable} onChange={e => setTag(e.target.value)}/></label><label className="field"><span>Role</span><select aria-label={`Role for ${asset.tag}`} value={role} disabled={!editable} onChange={e => setRole(e.target.value)}>{[...new Set([asset.role, ...roles[asset.kind] || []])].map(value => <option key={value}>{value}</option>)}</select></label><div className="asset-card-actions"><label><input type="checkbox" checked={enabled} disabled={!editable} onChange={e => setEnabled(e.target.checked)}/>Enabled</label><button disabled={!editable || !dirty || busy || changed} onClick={async () => { setBusy(true); try { await save(base, { tag, role, enabled }); } finally { setBusy(false); } }}><Check size={12}/>Apply</button><a className="button" aria-label={`Download ${asset.tag}`} href={assetUrl(project, asset.id, 'original')} download={asset.original_name}><ArrowDownToLine size={13}/></a></div>{changed && dirty && <p className="asset-conflict">Changed in ComfyUI. <button onClick={reset}>Reload asset</button></p>}</div></article>;
}
export function ProjectPanel({ tab, project, workflow, connected, editable, command, preview, report }: { tab: 'assets' | 'takes'; project: string; workflow: Workflow; connected: boolean; editable: boolean; command: Command; preview: (url: string, name: string) => void; report: (error: string) => void }) {
  const [catalog, setCatalog] = useState<ProjectCatalog | null>(null), [revisions, setRevisions] = useState<Revision[]>([]), [busy, setBusy] = useState(false), [inputPath, setInputPath] = useState('');
  const [filter, setFilter] = useState('all'), [writing, setWriting] = useState(false);
  const requestRef = useRef<AbortController | null>(null), epoch = useRef(0), reportRef = useRef(report); reportRef.current = report;
  const manager = Object.entries(workflow.prompt).find(([, node]) => node.class_type === 'MiniMaxH3ProjectAssetManager' && node.inputs.run_name === project)?.[0];
  const catalogVersion = manager ? workflow.prompt[manager].inputs.catalog_json : '';
  const checkpointManager = Object.entries(workflow.prompt).find(([, node]) => node.class_type === 'MiniMaxH3ChainCheckpointManager')?.[0];
  const read = useCallback(async () => {
    requestRef.current?.abort();
    if (!project || !connected) return;
    const controller = new AbortController(); requestRef.current = controller;
    setBusy(true);
    try {
      if (tab === 'assets') {
        const value = await comfy<ProjectCatalog>(`${H3}/project-assets?${new URLSearchParams({ project })}`, { signal: controller.signal });
        if (value.project !== project || !Array.isArray(value.assets)) throw new Error('H3 returned an unexpected asset catalog.');
        if (!controller.signal.aborted) setCatalog(value);
      } else {
        const data = await comfy<{ revisions: Revision[] }>(`${H3}/checkpoints?${new URLSearchParams({ run_name: project, include_graph: 'true' })}`, { signal: controller.signal });
        if (!controller.signal.aborted) setRevisions(data.revisions || []);
      }
    } catch (e) { if (!controller.signal.aborted) reportRef.current(String(e)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [project, tab, connected]);
  useEffect(() => {
    setCatalog(null); setRevisions([]); setFilter('all');
    return () => { epoch.current++; requestRef.current?.abort(); };
  }, [read]);
  useEffect(() => { void read(); return () => requestRef.current?.abort(); }, [read, catalogVersion]);
  const mutate = async (action: string, options: Record<string, unknown>) => {
    if (!manager || !editable || writing) { report('Attach the live project and apply its prompt draft before managing assets.'); return; }
    const started = epoch.current; setWriting(true);
    try {
      const result = await command(action, { node: manager, project, ...options });
      if (result.warning) reportRef.current(result.warning);
      if (epoch.current === started) await read();
    } catch (e) { reportRef.current(String(e)); } finally { setWriting(false); }
  };
  if (!project) return <div className="empty-large"><FolderOpen size={32}/><h3>Attach an H3 project</h3><p>The selected workflow’s Plan and Asset Carousel identify its project.</p></div>;
  return <div className="project-panel"><div className="section-heading"><div><h2>{tab === 'assets' ? 'Project assets' : 'Checkpoints & takes'}</h2><p>{project} · shared with the original H3 project</p></div><button disabled={busy || !connected} onClick={() => void read()}><RefreshCw size={13}/>{busy ? 'Reading…' : 'Refresh'}</button></div>
    {tab === 'assets' ? <>
      <div className="project-actions"><label className={`button ${!editable || !manager ? 'disabled' : ''}`}><Upload size={14}/>Upload to project<input type="file" hidden accept="image/*,video/*,audio/*" disabled={!editable || !manager || busy || writing} onChange={async e => { const input = e.currentTarget, file = input.files?.[0]; if (file) await mutate('asset-upload', { file, filename: file.name }); input.value = ''; }}/></label>{manager && editable && <button onClick={() => void command('focus', { node: manager }).catch(e => report(String(e)))}><ArrowUpRight size={13}/>Show carousel in ComfyUI</button>}</div>
      {!editable && <p className="hint">Attach the live workflow and apply its prompt draft to manage assets. Existing assets remain available for preview and download.</p>}
      <div className="asset-import"><input aria-label="ComfyUI input media path" placeholder="Existing ComfyUI input path, e.g. references/hero.png" value={inputPath} onChange={e => setInputPath(e.target.value)} disabled={!editable || !manager}/><button disabled={!editable || !manager || !inputPath.trim() || busy || writing} onClick={() => void mutate('asset-import', { path: inputPath })}><FolderOpen size={13}/>Import</button></div>
      <div className="asset-grid">{catalog?.assets.map(asset => <AssetCard key={`${project}:${asset.id}`} asset={asset} project={project} editable={editable && Boolean(manager) && !writing} preview={preview} save={(asset, changes) => mutate('asset-update', { asset_id: asset.id, changes, before: { tag: asset.tag, role: asset.role, enabled: asset.enabled !== false } })}/>)}</div>
      {catalog && !catalog.assets.length && <div className="empty-large"><Image size={30}/><p>No media in this project yet.</p></div>}
      {!!catalog?.reference_slots?.length && <p className="hint">{catalog.reference_slots.length} reference slots are defined. Bind or reorganize slots in the original Asset Carousel.</p>}
    </> : <>
      <div className="project-actions"><select aria-label="Filter checkpoint scenes" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All scenes</option>{[...new Set(revisions.map(item => item.scene))].sort((a, b) => a - b).map(scene => <option value={String(scene)} key={scene}>Scene {scene}</option>)}</select><button disabled={!revisions.length} onClick={() => downloadJSON(`${project}.checkpoints.json`, { run_name: project, revisions })}><ArrowDownToLine size={14}/>Export checkpoint list</button>{checkpointManager && editable && <button onClick={() => void command('focus', { node: checkpointManager }).catch(e => report(String(e)))}><ArrowUpRight size={13}/>Manage branches in ComfyUI</button>}</div>
      {revisions.filter(item => filter === 'all' || String(item.scene) === filter).map(item => <article className="take-card" key={`${item.scene}:${item.revision}`}><div className="take-card-title"><Film size={17}/><strong>{item.scene_id} · {item.revision.slice(0, 8)}</strong><span className={item.active ? 'active-take' : 'muted'}>{item.active ? 'Active take' : 'Alternative'}</span></div><div className="take-details"><span>Scene {item.scene}</span><span>{timecode(item.delivered_frames / 24)}</span><span>{item.steps} steps</span><span className="code">Seed {item.seed}</span></div><p>{item.prompt || 'No saved prompt.'}</p><small className="hint">{item.lineage_status} · {item.descendant_count || 0} downstream takes{item.dependencies?.length ? ` · Depends on ${item.dependencies.map(dep => `scene ${dep.scene} / ${dep.revision.slice(0, 8)}`).join(', ')}` : ''}</small><div className="project-actions"><button disabled={!item.video && !item.preview_video} onClick={() => preview(mediaUrl(item.preview_video || item.video), item.scene_id)}>Preview take</button>{item.video && <a className="button" href={mediaUrl(item.video)} download={item.video.filename}><ArrowDownToLine size={13}/>Download clip</a>}</div></article>)}
      {!revisions.length && !busy && <div className="empty-large"><Film size={30}/><p>No saved takes found for this project.</p></div>}
    </>}
  </div>;
}
