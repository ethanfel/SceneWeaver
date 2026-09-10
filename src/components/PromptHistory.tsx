import { useEffect, useRef, useState } from 'react';
import type { LiveResult } from '../types';
import { Modal } from './Controls';

type Revision = { id: string; parent_id?: string; label?: string; prompt?: string; executed_at?: string; archived_at?: string; created_at?: string; prompt_sha256: string };
type HistoryData = { history: { active_revision: string | null; history_revision?: string; revisions: Revision[] }; tree: { rows: { revision: Revision; depth: number; displayLabel: string; isActive: boolean; isExecuted: boolean; isArchived: boolean; canDelete: boolean; canArchive: boolean }[] }; writable: boolean; pending: { operation_id: string; action: string } | null; message?: string; revision?: Revision };
export type HistoryConnection = { available: boolean; context: Record<string, unknown>; command: (action: string, options: Record<string, unknown>) => Promise<LiveResult> };
type Props = { connection: HistoryConnection; currentText: string; editable: boolean; useText: (text: string) => void; close: () => void };
export function downloadPrompt(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PromptHistory(p: Props) {
  const [data, setData] = useState<HistoryData | null>(null), [selected, setSelected] = useState('');
  const [revision, setRevision] = useState<Revision | null>(null), [archived, setArchived] = useState(false), [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [review, setReview] = useState<{ key: string; options: Record<string, unknown>; before: string; after: string; description: string } | null>(null);
  const ticket = useRef(0), mounted = useRef(true), latest = useRef(p); latest.current = p;
  const context = JSON.stringify(p.connection.context), contextRef = useRef(context); contextRef.current = context;
  const reviewKey = JSON.stringify([context, p.currentText, data?.history.history_revision, selected]);
  const keyRef = useRef(reviewKey); keyRef.current = reviewKey;
  const call = (action: string, extra: Record<string, unknown> = {}) => p.connection.command(action, { ...p.connection.context, ...extra });
  async function refresh() {
    const id = ++ticket.current; setBusy(true); setError(''); setReview(null); setRevision(null); setData(null); setSelected('');
    try {
      const result = await latest.current.connection.command('prompt-history-list', latest.current.connection.context);
      if (mounted.current && id === ticket.current) { const next = result.data as HistoryData; setData(next); setSelected(''); setError(next.message || ''); }
    } catch (reason) { if (mounted.current && id === ticket.current) setError(String(reason)); }
    finally { if (mounted.current && id === ticket.current) setBusy(false); }
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; ticket.current++; }; }, [context]);
  async function browse(id: string) {
    const request = ++ticket.current, key = context; setBusy(true); setError(''); setReview(null); setRevision(null); setSelected(id);
    try {
      const result = await call('prompt-history-revision', { revision_id: id });
      if (mounted.current && request === ticket.current && contextRef.current === key) { const next = result.data as HistoryData; setData(next); setRevision(next.revision || null); setLabel(next.revision?.label || ''); }
    } catch (reason) { if (mounted.current && request === ticket.current) setError(String(reason)); }
    finally { if (mounted.current && request === ticket.current) setBusy(false); }
  }
  async function prepare(action: string, fields: Record<string, unknown> = {}) {
    if (!data) return;
    const key = reviewKey; setBusy(true); setError('');
    try {
      let before = revision?.prompt || '';
      if (action === 'save' && data.history.active_revision) {
        const result = await call('prompt-history-revision', { revision_id: data.history.active_revision });
        const next = result.data as HistoryData;
        if (next.history.history_revision !== data.history.history_revision) throw new Error('Prompt history changed. Refresh before saving.');
        before = next.revision?.prompt || '';
      }
      if (!mounted.current || keyRef.current !== key) return;
      const active = data.history.revisions.find(item => item.id === data.history.active_revision);
      const description = action === 'save' ? active?.executed_at ? 'Save editor text as a child of the active executed revision; identical saved text may reactivate its existing revision.' : 'Update the active mutable draft; identical saved text may reactivate its existing revision.'
        : action === 'fork' ? 'Create a separate draft child of the selected revision, preserving its text.'
        : action === 'activate' ? 'Set this revision as active in H3 history. The editor and workflow prompt are unchanged until you load, stage and apply its text.'
        : action === 'delete' ? 'Delete this inactive, unexecuted leaf revision from H3 history.'
        : action === 'label' ? 'Change this saved revision’s label.' : fields.archived ? 'Archive this revision in H3 history.' : 'Show this archived revision again.';
      setReview({ key, description, before, after: ['save', 'fork'].includes(action) ? p.currentText : before,
        options: { history_action: action, base_revision: data.history.history_revision, revision_id: selected, ...(['save', 'fork'].includes(action) ? { prompt: p.currentText } : {}), ...fields } });
    } catch (reason) { if (mounted.current && keyRef.current === key) setError(String(reason)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function mutate(options: Record<string, unknown>) {
    const key = context; setBusy(true); setError(''); setReview(null);
    try {
      const result = await call('prompt-history-mutate', options);
      if (mounted.current && contextRef.current === key) { setData(result.data as HistoryData); setRevision(null); setSelected(''); setError(result.warning || 'History saved. The editor and workflow remain unchanged.'); }
    } catch (reason) {
      if (mounted.current && contextRef.current === key) {
        const message = String(reason);
        try { const checked = await call('prompt-history-list'); if (mounted.current && contextRef.current === key) { setData(checked.data as HistoryData); setRevision(null); setSelected(''); setError(`${message} ${(checked.data as HistoryData).message || 'Review current history or check the pending command.'}`); } }
        catch { if (mounted.current && contextRef.current === key) { setData(null); setRevision(null); setSelected(''); setError(`${message} Refresh history to check the result before making another change.`); } }
      }
    } finally { if (mounted.current) setBusy(false); }
  }
  const writable = p.editable && data?.writable && !data.pending && !busy;
  const row = data?.tree.rows.find(item => item.revision.id === selected);
  return <Modal title="Saved prompt history" wide onClose={p.close}>
    <div className="modal-body prompt-history-panel"><p><strong>{String(p.connection.context.project)} · {p.connection.context.branch_id === 'main' ? 'Original' : String(p.connection.context.branch_id).slice(0, 8)} · {String(p.connection.context.scene_id)}</strong></p>
      <p>Browsing reads saved text. Use a revision in the editor, then Stage and Apply to ComfyUI to restore the workflow prompt. History revisions store scene text; shared direction, seeds and generated clips are separate.</p>
      <div className="prompt-history-tools"><button disabled={busy} onClick={() => void refresh()}>Refresh history</button><label><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)}/>Show archived</label><button disabled={!writable} onClick={() => void prepare('save')}>Save editor text to history</button></div>
      {data && !data.writable && <p className="playback-notice">This H3 version supports history reads. Conditional history writes require the prompt-history command update.</p>}
      {data?.pending && <div className="playback-notice"><p>Unconfirmed {data.pending.action} · {data.pending.operation_id.slice(0, 8)}. Check its result before retrying; the ComfyUI tab retains the exact request.</p><button disabled={busy} onClick={() => void refresh()}>Check history result</button><button disabled={busy || !p.editable} onClick={() => void mutate({ retry: true, operation_id: data.pending!.operation_id })}>Retry exact history command</button></div>}
      <div className="prompt-history-columns"><nav aria-label="Saved prompt revisions">{data?.tree.rows.filter(item => archived || !item.isArchived).map(item => <button key={item.revision.id} className={selected === item.revision.id ? 'selected' : ''} style={{ paddingLeft: 8 + Math.min(item.depth, 8) * 12 }} disabled={busy} onClick={() => void browse(item.revision.id)}><strong>{item.depth ? '↳ ' : ''}{item.displayLabel}</strong><small>{item.isActive ? 'History active · ' : ''}{item.isExecuted ? 'Executed' : 'Draft'}{item.isArchived ? ' · Archived' : ''}</small><small>{item.revision.created_at || 'Unknown date'}</small></button>)}{data && !data.tree.rows.length && <p>No saved prompt revisions for this scene.</p>}</nav>
        <div>{revision ? <><div className="prompt-diff"><label>Current editor text<textarea readOnly value={p.currentText}/></label><label>Saved revision text<textarea readOnly value={revision.prompt || ''}/></label></div>
          <div className="prompt-history-tools"><button disabled={!p.editable || busy} onClick={() => { p.useText(revision.prompt || ''); p.close(); }}>Use revision text</button><button onClick={() => downloadPrompt(revision.prompt || '', `${p.connection.context.scene_id}-${revision.id.slice(0, 8)}`)}>Export revision text</button><button disabled={!writable} onClick={() => void prepare('fork')}>Fork with editor text</button><button disabled={!writable || row?.isActive} onClick={() => void prepare('activate')}>Set active in history</button></div>
          <label className="field"><span>Revision label</span><input maxLength={80} value={label} onChange={event => setLabel(event.target.value)}/></label><div className="prompt-history-tools"><button disabled={!writable} onClick={() => void prepare('label', { label })}>Save label</button><button disabled={!writable || !row?.canArchive && !row?.isArchived} onClick={() => void prepare('archive', { archived: !row?.isArchived })}>{row?.isArchived ? 'Unarchive revision' : 'Archive revision'}</button><button disabled={!writable || !row?.canDelete} onClick={() => void prepare('delete')}>Delete draft revision</button></div>
        </> : <p>Select a revision to compare its text. Selection does not change the active history revision.</p>}</div></div>
      {review && review.key === reviewKey && <div className="prompt-history-confirmation"><strong>Review history change</strong><p>{review.description}</p>{['save', 'fork'].includes(String(review.options.history_action)) && <div className="prompt-diff"><label>Saved text before<textarea readOnly value={review.before}/></label><label>Editor text to save<textarea readOnly value={review.after}/></label></div>}<button className="primary" disabled={!writable} onClick={() => void mutate(review.options)}>Confirm history change</button><button onClick={() => setReview(null)}>Cancel history change</button></div>}
      {error && <p role="status">{error}</p>}
    </div><footer><button onClick={p.close}>Close history</button></footer>
  </Modal>;
}
