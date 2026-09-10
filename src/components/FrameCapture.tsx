import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Controls';
import { foldersFor, type LibraryState } from './LibraryOrganizer';
import type { CapturedFrame, LiveResult } from '../types';

type Review = { base_revision: string; preview_revision: string; tag: string; copyable: boolean; issue: string };
export function FrameCapture({ frame, project, branchId, manager, planId, editable, command, close }: {
  frame: CapturedFrame; project: string; branchId: string; manager: string; planId: string; editable: boolean;
  command: (action: string, options?: Record<string, unknown>) => Promise<LiveResult>; close: () => void;
}) {
  const [library, setLibrary] = useState<LibraryState | null>(null), [review, setReview] = useState<Review | null>(null);
  const [tag, setTag] = useState(`${frame.name}_capture`), [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const current = useRef({ command, close, busy }); current.current = { command, close, busy };
  const serial = useRef(0), alive = useRef(true);
  const closeModal = useCallback(() => { if (!current.current.busy) current.current.close(); }, []);
  const scope = { project, branch_id: branchId, node: manager, plan: planId };
  const selection = { source: { ...frame.source, branch_id: branchId }, time_seconds: frame.time_seconds, tag, folder_id: folder };
  const run = (action: string, fields: Record<string, unknown> = {}) => current.current.command(action, { ...scope, ...fields });
  const read = async () => {
    const value = (await run('asset-library-inspect')).data as LibraryState;
    if (alive.current) { setLibrary(value); if (value.message) setMessage(value.message); }
    return value;
  };
  useEffect(() => { alive.current = true; void read().catch(reason => { if (alive.current) setError(String(reason)); }); return () => { alive.current = false; serial.current++; }; }, []);
  const changed = () => { serial.current++; setReview(null); setError(''); setMessage(''); };
  const supported = library?.catalog.library_capture_version === 1;
  const stale = Boolean(review && review.base_revision !== library?.catalog.library_revision);
  async function inspect() {
    const started = ++serial.current; setBusy(true); setReview(null); setError(''); setMessage('');
    try {
      await read(); const result = await run('asset-frame-inspect', selection);
      if (alive.current && started === serial.current) setReview(result.data as Review);
    } catch (reason) { if (alive.current) setError(String(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save(retry = false) {
    if (!editable || busy || !supported || (!retry && (!review?.copyable || stale || library?.pending))) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await run('asset-library-mutate', retry ? { retry: true } : {
        library_action: 'asset_capture', ...selection, tag: review!.tag,
        base_revision: review!.base_revision, preview_revision: review!.preview_revision });
      if (alive.current) { setLibrary(result.data as LibraryState); setReview(null); setMessage('Captured picture saved to the project library.'); if (result.warning) setError(result.warning); }
    } catch (reason) {
      if (alive.current) { setError(String(reason)); setReview(null); }
      try { await read(); } catch { /* Preserve the original error and retained operation. */ }
    } finally { if (alive.current) setBusy(false); }
  }
  return <Modal title="Capture saved frame" wide onClose={closeModal}><div className="modal-body frame-capture">
    <div><img className="captured-frame" src={frame.image} alt={`Captured frame from ${frame.name}`}/><p>{frame.name} · clip time {frame.time_seconds.toFixed(3)} s</p><p className="hint">Saves the video picture. Captions and monitor overlays are excluded.</p></div>
    <div><fieldset disabled={busy}><legend>Project picture</legend><label className="field"><span>Capture tag</span><input aria-label="Capture tag" value={tag} onChange={event => { changed(); setTag(event.target.value); }}/></label><label className="field"><span>Capture folder</span><select aria-label="Capture folder" value={folder} onChange={event => { changed(); setFolder(event.target.value); }}><option value="">Unfiled</option>{library && foldersFor(library.catalog).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p>Creates an enabled picture in {project}. Repeated captures receive unique tags.</p></fieldset>
    {library && !supported && <p role="alert">Update H3 to enable reviewed frame captures.</p>}
    {!editable && <p className="hint">Attach the live project and apply its prompt draft before saving a capture.</p>}
    {review && <p role="status">Frame reviewed for @{review.tag}.</p>}{review?.issue && <p role="alert">{review.issue}</p>}{stale && <p role="alert">The library changed. Review the frame again.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {library?.pending ? <div><p>There is an unconfirmed library operation. Check its result before making another capture.</p><button disabled={busy} onClick={() => void read().catch(reason => setError(String(reason)))}>Check capture result</button>{library.pending.action === 'asset_capture' && <button disabled={busy || !editable} onClick={() => void save(true)}>Retry same capture</button>}</div> : <div className="project-actions"><button disabled={busy || !supported || !tag.trim()} onClick={() => void inspect()}>{busy ? 'Working…' : 'Review frame'}</button><button disabled={busy || !editable || !supported || !review?.copyable || stale} onClick={() => void save()}>Save captured picture</button></div>}
    </div></div></Modal>;
}
