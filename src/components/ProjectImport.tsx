import { useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, X } from 'lucide-react';
import type { LiveResult, ProjectAsset, ProjectCatalog } from '../types';
import { H3 } from '../lib/api';
import { foldersFor, type LibraryMutation } from './LibraryOrganizer';

type Command = (action: string, options?: Record<string, unknown>) => Promise<LiveResult>;
type Source = { project: string; asset_count: number };
type Review = { project: string; source_project: string; asset_id: string; base_revision: string; preview_revision: string; assets: ProjectAsset[]; copyable: boolean; issue: string };
type Pending = { operation_id: string; phase: string };

export function ProjectImport({ catalog, editable, command, mutate, close }: {
  catalog: ProjectCatalog; editable: boolean; command: Command; mutate: LibraryMutation; close: () => void;
}) {
  const [projects, setProjects] = useState<Source[]>([]), [source, setSource] = useState(''), [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [selected, setSelected] = useState<ProjectAsset | null>(null), [search, setSearch] = useState(''), [folder, setFolder] = useState(''), [enabled, setEnabled] = useState(true);
  const [review, setReview] = useState<Review | null>(null), [reading, setReading] = useState(false), [reviewing, setReviewing] = useState(false), [writing, setWriting] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [refresh, setRefresh] = useState(0), [mediaError, setMediaError] = useState(false);
  const commandRef = useRef(command); commandRef.current = command;
  const dialog = useRef<HTMLElement | null>(null), closeRef = useRef(close), writingRef = useRef(writing);
  closeRef.current = close; writingRef.current = writing;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !writingRef.current) { event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], audio[controls], video[controls]') || []).filter(element => element.getClientRects().length);
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
    };
    document.addEventListener('keydown', handle, true);
    return () => { document.removeEventListener('keydown', handle, true); previous?.focus(); };
  }, []);
  const supported = catalog.library_copy_version === 1;
  useEffect(() => {
    let current = true; setReading(true); setError(''); setSelected(null); setAssets([]); setReview(null);
    void commandRef.current('asset-library-source', source ? { source_project: source } : {}).then(result => {
      if (!current) return;
      if (source) setAssets((result.data as ProjectCatalog).assets);
      else setProjects((result.data as { items: Source[] }).items);
    }).catch(reason => { if (current) setError(String(reason)); }).finally(() => { if (current) setReading(false); });
    return () => { current = false; };
  }, [catalog.project, source, refresh]);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  useEffect(() => {
    let current = true; setReview(null); setMediaError(false); setError('');
    if (!selected || !supported) { setReviewing(false); return; }
    setReviewing(true);
    void commandRef.current('asset-library-copy-preview', { source_project: source, asset_id: selected.id, enabled, folder_id: folder }).then(result => {
      if (current) setReview(result.data as Review);
    }).catch(reason => { if (current) setError(String(reason)); }).finally(() => { if (current) setReviewing(false); });
    return () => { current = false; };
  }, [catalog.project, selected, source, enabled, folder, reviewRefresh, supported]);
  const stale = Boolean(review && review.base_revision !== catalog.library_revision);
  const select = (asset: ProjectAsset) => {
    setSelected(asset); setMessage(''); setEnabled(asset.enabled !== false && !(asset.role === 'source_track' && catalog.assets.some(item => item.role === 'source_track' && item.enabled !== false)));
  };
  const url = selected ? `/comfy${H3}/project-assets/media?${new URLSearchParams({ project: source, asset: selected.id, variant: 'original' })}` : '';
  const pending = (catalog.library_pending_copies || []) as Pending[];
  const copy = async () => {
    if (!selected || !review || stale || writing) return;
    setWriting(true); setError('');
    try {
      const ok = await mutate('asset-library-mutate', { library_action: 'asset_copy', base_revision: review.base_revision, preview_revision: review.preview_revision,
        source_project: source, asset_id: selected.id, folder_id: folder, enabled });
      if (ok) { setMessage(`Copied ${review.assets.length} asset${review.assets.length === 1 ? '' : 's'} from ${source} into ${catalog.project}.`); setSelected(null); setReview(null); }
      else setError('Copy was not confirmed. Review the reported error, or close this browser to check a pending library request.');
    } finally { setWriting(false); }
  };
  return <div className="modal-backdrop"><section ref={dialog} className="project-import" role="dialog" aria-modal="true" aria-label="Other project media">
    <header><div><h2>Other projects</h2><p>Copy media into {catalog.project}</p></div><button aria-label="Close project browser" disabled={writing} onClick={close}><X size={16}/></button></header>
    <div className="project-import-toolbar"><label className="field"><span>Source project</span><select aria-label="Source project" value={source} disabled={writing} onChange={event => { setSelected(null); setReview(null); setSource(event.target.value); }}><option value="">Choose a project…</option>{projects.map(item => <option key={item.project} value={item.project}>{item.project} · {item.asset_count} assets</option>)}</select></label><button disabled={reading || writing} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={13}/>Refresh sources</button><input aria-label="Search source assets" placeholder="Find source media…" value={search} onChange={event => setSearch(event.target.value)}/></div>
    {!supported && <p className="hint">Source browsing is available. Update H3 to enable reviewed project copies.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {pending.map(item => <div className="playback-notice" key={item.operation_id}><span>Unfinished import · {item.phase}. Resume the saved request and media.</span><button disabled={!editable || writing} onClick={async () => { setWriting(true); try { await mutate('asset-library-mutate', { retry: true, resume_copy: true, operation_id: item.operation_id }); } finally { setWriting(false); } }}>Resume saved import</button></div>)}
    <div className="project-import-body"><div className="project-import-assets" aria-label="Source assets">{reading ? <p>Reading projects…</p> : !source ? <p>Choose an H3 project to browse its library.</p> : assets.length === 0 ? <p>This project has no assets.</p> : assets.filter(asset => `${asset.tag} ${asset.original_name || ''} ${asset.role}`.toLowerCase().includes(search.toLowerCase())).map(asset => <button key={asset.id} aria-pressed={selected?.id === asset.id} disabled={writing} onClick={() => select(asset)}><FolderOpen size={16}/><span>{asset.tag}<small>{asset.original_name || asset.kind} · {asset.role}</small></span></button>)}</div>
      <div className="project-import-review">{selected ? <><div className="project-import-preview">{selected.kind === 'image' ? <img key={url} src={url} alt={`Original ${selected.tag}`} onError={() => setMediaError(true)}/> : selected.kind === 'audio' ? <audio key={url} src={url} controls onError={() => setMediaError(true)}/> : <video key={url} src={url} controls preload="metadata" onError={() => setMediaError(true)}/>}</div>
        <h3>{selected.tag}</h3><p>{selected.original_name} · {selected.kind} · {selected.role}</p>{mediaError && <p className="hint">The browser could not play this original. <a href={url} download={selected.original_name}>Download original</a></p>}
        <fieldset disabled={!editable || !supported || writing}><label className="field"><span>Destination folder</span><select aria-label="Destination folder" value={folder} onChange={event => setFolder(event.target.value)}><option value="">Unfiled</option>{foldersFor(catalog).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/>Enable copied asset</label></fieldset>
        {reviewing && <p>Checking source media and dependencies…</p>}{review && <><h3>{review.assets.length} asset{review.assets.length === 1 ? '' : 's'} to copy</h3><ul>{review.assets.map((asset, index) => <li key={asset.id}>{asset.tag} · {index === 0 ? asset.role : 'audio reference, disabled'}</li>)}</ul><p className="hint">Track links use the copied asset IDs. H3 chooses unique tags and retains source provenance. All copied media goes into the selected folder.</p>{review.issue && <p role="alert">{review.issue}</p>}</>}
        {stale && <p role="alert">The destination library changed. Refresh the copy review before continuing.</p>}
        <div className="project-actions"><button disabled={reviewing || writing || !supported} onClick={() => setReviewRefresh(value => value + 1)}>Refresh copy review</button><button disabled={!editable || !supported || !review?.copyable || stale || writing || reviewing} onClick={() => void copy()}>{writing ? 'Copying…' : 'Copy into project'}</button></div>
      </> : <p>Select an asset to preview its original media and review a copy.</p>}</div>
    </div>
  </section></div>;
}
