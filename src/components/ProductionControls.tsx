import { useState } from 'react';
import { Clapperboard } from 'lucide-react';
import type { LiveResult, LiveSnapshot } from '../types';
import { generationProposal, generationTargets } from '../../public/integrations/production-range.mjs';
import { Modal } from './Controls';

type Props = { snapshot: LiveSnapshot | null; planId: string; project: string; branchId: string; scene: number; count: number; editable: boolean; idle: boolean; command: (options: Record<string, unknown>) => Promise<LiveResult>; queued: (id: string) => Promise<void> };
export function ProductionControls(p: Props) {
  const [selected, setSelected] = useState(''), [mode, setMode] = useState('scene'), [first, setFirst] = useState(p.scene), [last, setLast] = useState(p.scene), [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<{ revision: number; binding: string; options: Record<string, unknown> } | null>(null);
  const targets = p.snapshot ? generationTargets(p.snapshot.nodes, p.planId) : [];
  const target = targets.some(item => item.id === selected) ? selected : targets.length === 1 ? targets[0].id : '';
  const start = mode === 'scene' ? p.scene : first, end = mode === 'scene' ? p.scene : mode === 'remaining' ? p.count : last;
  const options = { plan: p.planId, project: p.project, branch_id: p.branchId, target, start, end, verify };
  let problem = '', proposal;
  try { if (p.snapshot) proposal = generationProposal(p.snapshot, options); } catch (error) { problem = (error as Error).message; }
  const reason = !p.editable ? 'Attach the intended workflow and apply or recover its prompt draft first.' : p.snapshot?.capabilities?.generationVersion !== 1 ? p.snapshot?.capabilities?.generationReason || 'Native H3 queue hooks are unavailable. Update H3, refresh the ComfyUI tab and reopen SceneWeaver.' : !p.idle ? 'Wait for the current ComfyUI queue to finish.' : problem;
  const changed = confirmation && (confirmation.revision !== p.snapshot?.revision || confirmation.binding !== p.snapshot?.binding || JSON.stringify(confirmation.options) !== JSON.stringify(options));
  const generate = async () => {
    if (busy || reason || changed || !confirmation) return;
    setBusy(true); setMessage('');
    try {
      const result = await p.command(confirmation.options);
      setConfirmation(null);
      setMessage(result.warning || `Generation accepted · ${result.prompt_id}`);
      if (result.prompt_id) void p.queued(result.prompt_id).catch(error => setMessage(`Generation was accepted, but job tracking needs a refresh: ${String(error)}`));
    } catch (error) { setMessage(String(error).replace(/^Error: /, '')); setConfirmation(null); }
    finally { setBusy(false); }
  };
  return <section className="production-controls" aria-label="Generation controls"><div className="section-heading"><div><h2>Generate scenes</h2><p>{p.project || 'No production selected'} · {p.branchId === 'main' ? 'Original' : p.branchId.slice(0, 8)}</p></div><Clapperboard size={22}/></div>
    <div className="production-fields"><label className="field"><span>Production output</span><select aria-label="Generation output" value={target} onChange={e => setSelected(e.target.value)}><option value="">{targets.length ? 'Choose the output' : 'No bound generation output'}</option>{targets.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label className="field"><span>Scope</span><select aria-label="Generation scope" value={mode} onChange={e => setMode(e.target.value)}><option value="scene">Selected scene · {p.scene}</option><option value="range">Scene range</option><option value="remaining">Resume through end</option></select></label>
    {mode !== 'scene' && <label className="field"><span>First scene</span><input aria-label="First generation scene" type="number" min={1} max={p.count} value={first} onChange={e => setFirst(Number(e.target.value))}/></label>}{mode === 'range' && <label className="field"><span>Last scene</span><input aria-label="Last generation scene" type="number" min={first} max={p.count} value={last} onChange={e => setLast(Number(e.target.value))}/></label>}</div>
    <label className="production-check"><input type="checkbox" checked={verify} onChange={e => setVerify(e.target.checked)}/>Verify predecessor history</label>
    <p className="hint">Native H3 preflight runs when this job executes. {start > 1 ? `Scene ${start} needs the saved checkpoint for scene ${start - 1}. ` : ''}Review and assembly use the connected production settings.</p>
    {reason && <p className="notice">{reason}</p>}{message && <p role="status" className="notice">{message}</p>}
    <button className="primary" disabled={busy || !!reason || !proposal} onClick={() => p.snapshot && setConfirmation({ revision: p.snapshot.revision, binding: p.snapshot.binding, options })}>{busy ? 'Submitting…' : 'Review generation'}</button>
    {confirmation && proposal && <Modal title="Generate selected scenes" onClose={() => { if (!busy) setConfirmation(null); }}><div className="modal-body"><p><strong>{start === end ? `Scene ${start}` : `Scenes ${start}–${end}`}</strong> · {p.project} · {p.branchId === 'main' ? 'Original' : p.branchId.slice(0, 8)}</p><p>{proposal.sceneIds.join(', ')}</p><p>The native Loop Start and upstream preflight controls will use this range. The selected output, <strong>{proposal.target.title}</strong>, will generate and assemble the accepted prefix. Existing checkpoints in this range can acquire new active takes; saved revisions remain available.</p>
      <p>{proposal.reviews.length ? `Review settings are inherited from ${proposal.reviews.length} connected gate(s). Use the render queue to approve or retry candidates.` : 'This path has no live review gate; saved output is accepted by its native workflow.'}</p>{!verify && <p className="notice">Predecessor Plan/history matching will be disabled. H3 still checks artifact integrity, but changed predecessor prompts or settings will not be applied to its saved pixels.</p>}
      <p>Only the selected output and its dependencies run. Separate preview and export branches are excluded from this job.</p><p className="hint">Scope settings stay in the workflow after submission. Native seed hooks may update seeds. Branch authoring and workflow-file saving remain separate actions.</p>{changed && <p className="notice">The workflow or scope changed. Close this dialog and review generation again.</p>}</div><footer><button disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className="primary" disabled={busy || !!reason || !!changed} onClick={() => void generate()}>{busy ? 'Submitting…' : 'Generate now'}</button></footer></Modal>}
  </section>;
}
