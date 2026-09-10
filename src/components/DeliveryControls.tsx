import { useState } from 'react';
import { PackageCheck } from 'lucide-react';
import type { Checkpoint, Editorial, LiveResult, LiveSnapshot } from '../types';
import { deliveryConfiguration, deliveryTargets } from '../../public/integrations/delivery-core.mjs';
import { Modal } from './Controls';

type Prepared = { ticket: string; snapshot_id: string; settings: Record<string, unknown>; summary: { run_name: string; branch_id: string; final_cut_branch_id: string; scene_start: number; scene_end: number; frames: number; fps: number; subtitle_count: number; pictures: { scene: number; revision: string; scene_id: string }[] } };
type Props = { snapshot: LiveSnapshot | null; planId: string; project: string; branchId: string; checkpoints: Checkpoint[]; editorial: Editorial | null; editable: boolean; idle: boolean; command: (action: string, options: Record<string, unknown>) => Promise<LiveResult>; queued: (id: string) => Promise<void> };
export function DeliveryControls(p: Props) {
  const [chosen, setChosen] = useState(''), [end, setEnd] = useState(''), [filename, setFilename] = useState<string | null>(null), [audio, setAudio] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [prepared, setPrepared] = useState<{ data: Prepared; stamp: string } | null>(null);
  const targets = p.snapshot ? deliveryTargets(p.snapshot.nodes) : [];
  const target = chosen || (targets.length === 1 ? targets[0].id : '');
  const inputs = p.snapshot?.nodes[target]?.inputs || {};
  const name = filename ?? (typeof inputs.filename === 'string' ? inputs.filename : 'sceneweaver_cut');
  const source = audio ?? (typeof inputs.audio_source === 'string' ? inputs.audio_source : 'plan');
  const tips = p.checkpoints.filter(item => item.ready).sort((a, b) => a.scene - b.scene);
  const tip = end ? tips.find(item => `${item.scene}:${item.revision}` === end) : tips.at(-1);
  const options = { plan: p.planId, project: p.project, branch_id: p.branchId, target, filename: name, audio_source: source, scene: tip?.scene, take_revision: tip?.revision, editorial_revision: p.editorial?.revision };
  const stamp = JSON.stringify([p.snapshot?.binding, p.snapshot?.revision, p.planId, p.project, p.branchId, target, name, source, end]);
  let invalid = '';
  try { if (p.snapshot) deliveryConfiguration(p.snapshot, options); } catch (error) { invalid = (error as Error).message; }
  const reason = !p.editable ? 'Attach the intended workflow and apply or recover its prompt draft first.' : p.snapshot?.capabilities?.deliveryVersion !== 1 ? 'Saved-selection assembly requires the H3 integration proposed in PR #58. Existing output previews and downloads remain available below.' : !p.idle ? 'Wait for the ComfyUI queue to finish.' : !tip ? 'No saved generation checkpoint is available for this delivery.' : invalid;
  const prepare = async () => {
    setBusy(true); setMessage('');
    try { const result = await p.command('delivery-preview', options); setPrepared({ data: result.data as Prepared, stamp }); }
    catch (error) { setMessage(String(error).replace(/^Error: /, '')); }
    finally { setBusy(false); }
  };
  const deliver = async () => {
    if (!prepared || prepared.stamp !== stamp || reason) return;
    setBusy(true); setMessage('');
    try {
      const result = await p.command('deliver', { plan: p.planId, project: p.project, branch_id: p.branchId, ticket: prepared.data.ticket });
      setMessage(result.warning || `Delivery accepted · ${result.prompt_id}`); setPrepared(null);
      if (result.prompt_id) void p.queued(result.prompt_id).catch(error => setMessage(`Delivery was accepted; refresh job tracking: ${String(error)}`));
    } catch (error) { setMessage(String(error).replace(/^Error: /, '')); setPrepared(null); }
    finally { setBusy(false); }
  };
  return <section className="production-controls" aria-label="Saved delivery controls"><div className="section-heading"><div><h2>Assemble saved selection</h2><p>{p.project || 'No production selected'} · {p.branchId === 'main' ? 'Original' : p.branchId.slice(0, 8)}</p></div><PackageCheck size={22}/></div>
    <div className="production-fields"><label className="field"><span>Assembly settings from</span><select aria-label="Delivery assembly" value={target} onChange={e => setChosen(e.target.value)}><option value="">Choose an assembly node</option>{targets.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="field"><span>Saved sequence through</span><select aria-label="Delivery through scene" value={tip ? `${tip.scene}:${tip.revision}` : ''} onChange={e => setEnd(e.target.value)}><option value="">Choose a saved checkpoint</option>{tips.map(item => <option key={`${item.scene}:${item.revision}`} value={`${item.scene}:${item.revision}`}>Scene {item.scene} · {item.scene_id}</option>)}</select></label>
      <label className="field"><span>Filename</span><input aria-label="Delivery filename" value={name} onChange={e => setFilename(e.target.value)}/></label><label className="field"><span>Final audio</span><select aria-label="Delivery audio" value={source} onChange={e => setAudio(e.target.value)}><option value="plan">Saved Plan policy</option><option value="generated">Generated audio</option><option value="source">Source soundtrack</option><option value="none">No muxed audio</option></select></label></div>
    <p className="hint">Uses saved pictures, audio and captions through the chosen scene. New outputs get a separate filename. Generation nodes are excluded from the delivery recipe.</p>
    {reason && <p className="notice">{reason}</p>}{message && <p role="status" className="notice">{message}</p>}<button className="primary" disabled={busy || !!reason || !p.editorial?.revision} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Review saved delivery'}</button>
    {prepared && <Modal title="Deliver saved selection" onClose={() => { if (!busy) setPrepared(null); }}><div className="modal-body"><p><strong>Scenes {prepared.data.summary.scene_start}–{prepared.data.summary.scene_end}</strong> · {prepared.data.summary.run_name} · {prepared.data.summary.branch_id === 'main' ? 'Original' : prepared.data.summary.branch_id.slice(0, 8)}</p><p>{(prepared.data.summary.frames / prepared.data.summary.fps).toFixed(2)} seconds · {prepared.data.summary.subtitle_count} caption cues · {String(prepared.data.settings.audio_source)} audio</p>
      <ol>{prepared.data.summary.pictures.map(item => <li key={item.scene}>{item.scene_id} · picture {item.revision.slice(0, 8)}</li>)}</ol>
      <p>These pictures and caption cues are frozen for this delivery. Later edits to the saved cut do not change this selection. Missing or changed source files stop the job.</p><p>Output: <strong>{String(prepared.data.settings.filename)}</strong>. Blend, bitrate and color settings come from the selected assembly node. Assembly may decode saved media or use its connected VAE; it does not generate new scenes.</p><p className="hint">Source snapshot {prepared.data.snapshot_id.slice(0, 12)}</p>{prepared.stamp !== stamp && <p className="notice">The workflow or delivery settings changed. Close and review delivery again.</p>}</div><footer><button disabled={busy} onClick={() => setPrepared(null)}>Cancel</button><button className="primary" disabled={busy || !!reason || prepared.stamp !== stamp} onClick={() => void deliver()}>{busy ? 'Submitting…' : 'Assemble now'}</button></footer></Modal>}
  </section>;
}
