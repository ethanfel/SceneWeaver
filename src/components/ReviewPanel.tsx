import { useState } from 'react';
import { Check, Pause, RefreshCw, Shuffle, Square } from 'lucide-react';
import type { Review } from '../types';
import { H3, mediaUrl, post } from '../lib/api';

export type ReviewResult = { action?: string; scene_prompt?: string; seed?: string; length?: number };
export function ReviewPanel({ review, refresh, report, preview, applyDecision }: { review: Review; refresh: () => Promise<void>; report: (error: string) => void; preview: (url: string, name: string) => void; applyDecision: (review: Review, result: ReviewResult) => void }) {
  const [prompt, setPrompt] = useState(review.scene_prompt), [seed, setSeed] = useState(review.seed), [selected, setSelected] = useState(review.candidates?.at(-1)?.revision || ''), [busy, setBusy] = useState(false);
  // Keep every existing candidate by default. H3 deletes alternatives omitted
  // from candidate_revisions when a decision is accepted.
  const [excluded, setExcluded] = useState<string[]>([]);
  const live = review.candidate_batch_active && !review.candidate_generation_complete;
  const activeCandidate = review.candidates?.find(c => c.revision === selected) || review.candidates?.at(-1);
  const act = async (action: string) => {
    setBusy(true);
    try {
      const result = await post<ReviewResult>(`${H3}/${live ? 'review-candidate-batch' : 'review'}`, { token: review.token, action: live ? action === 'approve' ? 'accept' : 'pause' : action, scene_prompt: prompt, seed, length: review.raw_frames, candidate_revision: activeCandidate?.revision || '', candidate_revisions: (review.candidates || []).filter(c => !excluded.includes(c.revision) || c.revision === activeCandidate?.revision).map(c => c.revision) });
      if (!live) applyDecision(review, result);
      await refresh();
    } catch (e) { report(String(e)); } finally { setBusy(false); }
  };
  return <article className="review-card"><div className="review-title"><span className="status-dot amber"/><strong>{live ? 'Generating takes' : 'Awaiting your review'}</strong><span>SCENE {review.clip_index}</span></div><p>{review.shot_id} <span className="muted">/ {review.run_name}</span></p>
    {review.warning && <p className="notice">{review.warning}</p>}
    <button className="review-preview" disabled={!mediaUrl(activeCandidate?.video || review.video)} onClick={() => preview(mediaUrl(activeCandidate?.video || review.video), review.shot_id)}>Preview selected take</button>
    {!!review.candidates?.length && <div className="candidate-list">{review.candidates.map(candidate => <div key={candidate.revision}><button className={candidate.revision === selected ? 'active' : ''} onClick={() => { setSelected(candidate.revision); preview(mediaUrl(candidate.video), `${review.shot_id} · Take ${candidate.number}`); }}>Take {candidate.number}</button><label><input type="checkbox" checked={!excluded.includes(candidate.revision) || selected === candidate.revision} disabled={selected === candidate.revision} onChange={e => setExcluded(old => e.target.checked ? old.filter(id => id !== candidate.revision) : [...old, candidate.revision])}/>Keep</label></div>)}</div>}
    {(review.candidates?.length || 0) > 1 && <small className="hint">Unchecked alternatives are deleted by H3 when you accept a take.</small>}
    {!live && <details><summary>Edit and retry</summary><label className="field"><span>Retry prompt</span><textarea rows={5} value={prompt} onChange={e => setPrompt(e.target.value)}/></label><label className="field"><span>Retry seed</span><input value={seed} onChange={e => setSeed(e.target.value)}/></label></details>}
    <div className="review-actions"><button className="primary" disabled={busy} onClick={() => void act('approve')}><Check size={14}/>{live ? 'Use take after current' : 'Approve & continue'}</button>{live ? <button disabled={busy} onClick={() => void act('pause')}><Pause size={14}/>Pause at boundary</button> : <><button disabled={busy} onClick={() => void act('retry')}><RefreshCw size={13}/>Retry</button><button disabled={busy} onClick={() => void act('reroll')}><Shuffle size={13}/>Reroll</button><button disabled={busy} onClick={() => void act('stop')}><Square size={12}/>Approve & stop</button></>}</div>
  </article>;
}
