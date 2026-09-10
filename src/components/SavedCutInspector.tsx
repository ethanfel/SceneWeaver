import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveResult, LiveSnapshot } from '../types';
import { resolvePlanBinding } from '../../public/integrations/binding-core.mjs';
import { timecode } from '../lib/h3';
import { Modal } from './Controls';

type Scene = { scene: number; scene_id: string; revision: string; raw_frames: number; delivered_frames: number; out_frame: number; start_frame: number | null; locked: boolean; safe_out_frames: number[] };
type Timeline = { frames: number; fps: number; subtitle_count: number; stale_scenes: { scene: number; reasons: string[] }[]; records: { kind: string; scene?: number; scene_id?: string; start_frame: number; frame_count: number }[]; error?: string };
type Inspection = { stamp: string; scenes: Scene[]; subtitles: { mode: string; asset_id: string; offset_seconds: number }; subtitle_assets: { id: string; tag: string; timed: boolean }[]; timeline: Timeline };
type Values = Record<string, string | boolean>;
type Draft = { stamp: string; values: Values };
type Prepared = { ticket: string; timeline: Timeline; patch: Record<string, unknown> };
type Props = { snapshot: LiveSnapshot | null; planId: string; project: string; branchId: string; scene: number; sceneId: string; active: boolean; editable: boolean; idle: boolean; savedVersion: string; command: (action: string, options: Record<string, unknown>) => Promise<LiveResult>; changed: () => Promise<void> };

export function SavedCutInspector(p: Props) {
  const [data, setData] = useState<Inspection | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [prepared, setPrepared] = useState<{ data: Prepared; uiStamp: string; key: string } | null>(null);
  const pending = useRef(0), command = useRef(p.command); command.current = p.command;
  const node = p.snapshot ? resolvePlanBinding(p.snapshot.nodes, p.planId).managerId : '';
  const context = { node, plan: p.planId, project: p.project, branch_id: p.branchId };
  const contextRef = useRef(context); contextRef.current = context;
  const available = p.snapshot?.capabilities?.editorialVersion === 1 && !!node;
  const refresh = useCallback(async () => {
    const id = ++pending.current; setBusy(true);
    try {
      const result = await command.current('editorial-inspect', contextRef.current);
      if (id === pending.current) setData(result.data as Inspection);
    } catch (error) { if (id === pending.current) setMessage(String(error).replace(/^Error: /, '')); }
    finally { if (id === pending.current) setBusy(false); }
  }, []);
  useEffect(() => { if (p.active && available) void refresh(); }, [p.active, available, p.savedVersion, refresh]);
  useEffect(() => () => { pending.current++; }, []);
  const row = data?.scenes.find(item => item.scene === p.scene && item.scene_id === p.sceneId);
  const sceneKey = `scene:${p.scene}:${p.sceneId}`, captionKey = 'subtitles';
  const sceneInitial: Values = row ? { out_frame: String(row.out_frame), start_frame: row.start_frame === null ? '' : String(row.start_frame), locked: row.locked } : {};
  const captionInitial: Values = { mode: data?.subtitles.mode || 'off', asset_id: data?.subtitles.asset_id || '', offset_seconds: String(data?.subtitles.offset_seconds || 0) };
  const sceneValues = drafts[sceneKey]?.values || sceneInitial, captions = drafts[captionKey]?.values || captionInitial;
  const stamp = JSON.stringify([p.snapshot?.binding, p.snapshot?.revision, p.project, p.branchId, p.planId, p.scene, data?.stamp, drafts]);
  const reason = !available ? 'This H3 installation needs the saved-sequence editing interface. Saved timing remains visible in the timeline.'
    : !p.editable || !p.snapshot?.capabilities?.ownership ? 'Attach the intended workflow and apply or recover its prompt draft before editing the saved cut.'
    : !p.idle ? 'Wait for the ComfyUI queue to finish before saving sequence edits.' : '';
  const change = (key: string, initial: Values, field: string, value: string | boolean) => {
    if (!data) return;
    setDrafts(current => ({ ...current, [key]: { stamp: current[key]?.stamp || data.stamp, values: { ...initial, ...current[key]?.values, [field]: value } } }));
  };
  const dirty = (key: string, initial: Values) => !!drafts[key] && JSON.stringify(drafts[key].values) !== JSON.stringify(initial);
  const stale = (key: string) => !!drafts[key] && drafts[key].stamp !== data?.stamp;
  const discard = (key: string) => setDrafts(current => { const next = { ...current }; delete next[key]; return next; });
  const review = async (key: string, patch: Record<string, unknown>) => {
    if (!data || stale(key)) return;
    setBusy(true); setMessage('');
    try {
      const result = await p.command('editorial-preview', { ...context, stamp: data.stamp, patch });
      setPrepared({ data: result.data as Prepared, uiStamp: stamp, key });
    } catch (error) { setMessage(String(error).replace(/^Error: /, '')); }
    finally { setBusy(false); }
  };
  const reviewScene = () => {
    if (!row) return;
    const changes: Record<string, unknown> = { scene: row.scene, scene_id: row.scene_id, revision: row.revision };
    if (sceneValues.out_frame !== sceneInitial.out_frame) changes.out_frame = Number(sceneValues.out_frame);
    if (sceneValues.start_frame !== sceneInitial.start_frame) changes.start_frame = sceneValues.start_frame === '' ? null : Number(sceneValues.start_frame);
    if (sceneValues.locked !== sceneInitial.locked) changes.locked = sceneValues.locked;
    void review(sceneKey, { scene: changes });
  };
  const save = async () => {
    if (!prepared || prepared.uiStamp !== stamp || reason) return;
    setBusy(true); setMessage('');
    try {
      const result = await p.command('editorial-apply', { ...context, ticket: prepared.data.ticket });
      discard(prepared.key); setPrepared(null);
      setMessage(result.warning || 'Saved sequence updated. Generation order and checkpoint files are unchanged.');
      await p.changed();
    } catch (error) { setMessage(String(error).replace(/^Error: /, '')); setPrepared(null); }
    finally { setBusy(false); }
  };
  return <section className="saved-cut-inspector" aria-label="Saved cut inspector">
    <div className="inspector-heading"><span className="section-label">SAVED CUT · {p.branchId === 'main' ? 'ORIGINAL' : p.branchId.slice(0, 8)}</span><button disabled={!available || busy} onClick={() => void refresh()}>Refresh</button></div>
    <p className="hint">Edit saved picture timing and caption settings here. Changes are reviewed before they update H3.</p>
    {reason && <p className="notice">{reason}</p>}{message && <p role="status" className="notice">{message}</p>}
    {data?.timeline.error && <p className="notice">{data.timeline.error}</p>}
    {data && <>
      {row ? <fieldset className="scene-fields" disabled={busy || !!reason}>
        <h3>{row.scene_id.replaceAll('_', ' ')}</h3>
        <label className="field"><span>Retained delivered frames</span><select aria-label="Cut end frame" value={String(sceneValues.out_frame)} disabled={row.locked} onChange={e => change(sceneKey, sceneInitial, 'out_frame', e.target.value)}>{row.safe_out_frames.map(frame => <option value={frame} key={frame}>{frame} frames · {timecode(frame / 24)}{frame === row.delivered_frames ? ' · full clip' : ''}</option>)}</select></label>
        <p className="hint">H3 supplies valid cut points for both video and audio. The clip keeps its original start.</p>
        <label className="field"><span>Requested start frame</span><input aria-label="Cut start frame" type="number" min="0" max="864000" step="1" placeholder="Automatic" value={String(sceneValues.start_frame)} disabled={row.locked} onChange={e => change(sceneKey, sceneInitial, 'start_frame', e.target.value)}/></label>
        <p className="hint">Leave blank for natural placement. H3 orders explicit placements and pushes overlapping clips forward; review the resolved timing before saving.</p>
        <label className="cut-lock"><input type="checkbox" aria-label="Lock saved scene" checked={Boolean(sceneValues.locked)} onChange={e => change(sceneKey, sceneInitial, 'locked', e.target.checked)}/>Lock timing in the saved cut</label>
        {row.locked && <p className="hint">Save an unlock before changing this scene’s timing.</p>}
        {stale(sceneKey) && <p className="notice">The saved cut changed while you were editing. Your values are retained; reload saved values before reviewing again.</p>}
        <div className="scene-actions"><button className="primary" disabled={!dirty(sceneKey, sceneInitial) || stale(sceneKey)} onClick={reviewScene}>Review timing</button><button disabled={!drafts[sceneKey]} onClick={() => discard(sceneKey)}>Reload saved values</button></div>
      </fieldset> : <p className="notice">Select a scene with an active saved checkpoint to edit its timing.</p>}
      <fieldset className="scene-fields cut-captions" disabled={busy || !!reason}>
        <h3>Sequence captions</h3>
        <label className="field"><span>Saved caption mode</span><select aria-label="Saved caption mode" value={String(captions.mode)} onChange={e => change(captionKey, captionInitial, 'mode', e.target.value)}><option value="off">Off</option><option value="preview_srt">Preview and export SRT</option></select></label>
        <label className="field"><span>Timed lyric asset</span><select aria-label="Saved caption asset" value={String(captions.asset_id)} onChange={e => change(captionKey, captionInitial, 'asset_id', e.target.value)}><option value="">Choose an audio asset</option>{data.subtitle_assets.map(asset => <option value={asset.id} key={asset.id}>@{asset.tag}{asset.timed ? '' : ' · no timed text'}</option>)}</select></label>
        <label className="field"><span>Caption offset (seconds)</span><input aria-label="Saved caption offset" type="number" min="-3600" max="3600" step="0.1" value={String(captions.offset_seconds)} onChange={e => change(captionKey, captionInitial, 'offset_seconds', e.target.value)}/></label>
        <p className="hint">These settings affect the saved sequence and future delivery. The player’s CC button only changes monitoring.</p>
        {stale(captionKey) && <p className="notice">The saved cut or assets changed. Your values are retained; reload saved values before reviewing again.</p>}
        <div className="scene-actions"><button className="primary" disabled={!dirty(captionKey, captionInitial) || stale(captionKey)} onClick={() => void review(captionKey, { subtitles: { ...captions, offset_seconds: Number(captions.offset_seconds) } })}>Review captions</button><button disabled={!drafts[captionKey]} onClick={() => discard(captionKey)}>Reload saved values</button></div>
      </fieldset>
    </>}
    {prepared && <Modal title="Review saved sequence edit" onClose={() => { if (!busy) setPrepared(null); }}><div className="modal-body">
      <p>{p.project} · {p.branchId === 'main' ? 'Original' : p.branchId.slice(0, 8)}</p>
      <ul>{Object.entries((prepared.data.patch.scene || prepared.data.patch.subtitles || {}) as Record<string, unknown>).filter(([key]) => !['scene', 'scene_id', 'revision'].includes(key)).map(([key, value]) => <li key={key}><strong>{({ out_frame: 'Retained frames', start_frame: 'Requested start frame', locked: 'Timing lock', mode: 'Caption mode', asset_id: 'Caption asset', offset_seconds: 'Caption offset (seconds)' } as Record<string, string>)[key] || key}</strong>: {value === null ? 'Automatic' : typeof value === 'boolean' ? value ? 'Locked' : 'Unlocked' : String(value)}</li>)}</ul>
      <p><strong>{prepared.data.timeline.frames} frames · {timecode(prepared.data.timeline.frames / prepared.data.timeline.fps)}</strong> · {prepared.data.timeline.subtitle_count} caption cues</p>
      {!!prepared.data.timeline.stale_scenes.length && <div className="notice"><strong>Continuation needs regeneration</strong><p>This cut leaves these saved continuations incompatible with native assembly. Their files remain available. Resume from the first affected scene to regenerate continuity, or cancel and keep the current cut.</p><ul>{prepared.data.timeline.stale_scenes.map(item => <li key={item.scene}>Scene {item.scene}: {item.reasons.join('; ')}</li>)}</ul></div>}
      <ol>{prepared.data.timeline.records.map((record, index) => <li key={index}>{record.kind === 'gap' ? 'Gap' : record.scene_id} · {timecode(record.start_frame / 24)} · {record.frame_count} frames</li>)}</ol>
      <p>The change is saved to this branch’s editorial settings. It does not run generation or restore checkpoints.</p>
      {prepared.uiStamp !== stamp && <p className="notice">The workflow, saved source or draft changed. Close and review the edit again.</p>}
    </div><footer><button disabled={busy} onClick={() => setPrepared(null)}>Cancel</button><button className="primary" disabled={busy || !!reason || prepared.uiStamp !== stamp} onClick={() => void save()}>{busy ? 'Saving…' : 'Save cut'}</button></footer></Modal>}
  </section>;
}
