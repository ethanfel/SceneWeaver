import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Check, Film, GitBranch, Pause, Play, RefreshCw, X } from 'lucide-react';
import type { Checkpoint, Editorial, LiveResult, LiveSnapshot, PreviewMedia, ProcessingTake, Revision, Workflow } from '../types';
import { comfy, H3, mediaUrl } from '../lib/api';
import { checkpointThumbnailUrl, revisionMedia } from '../lib/playback';
import { downloadJSON, isLink } from '../lib/workflow';
import { timecode } from '../lib/h3';
import { CheckpointThumbnail } from './CheckpointThumbnail';
import { Modal } from './Controls';

import { branchPath, verifyBranch } from '../../public/integrations/branches-core.mjs';
import { resolvePlanBinding } from '../../public/integrations/binding-core.mjs';
import { resolvePlanDocument } from '../../public/integrations/plan-source.mjs';
import { productionRoles } from '../../public/integrations/workflow-roles.mjs';

type Impact = { ticket: string; mode: string; scope: { title: string; start: number; end: number }; changed: Revision[]; retired: Revision[]; restored: Revision[]; outsideDependents: Revision[] };
type Props = { active?: boolean; playbackAllowed?: boolean; onPlay?: () => void; mode?: 'takes' | 'processing'; project: string; branchId: string; server: string; planId: string; scene: number; workflow: Workflow; connected: boolean; editable: boolean; capabilities?: LiveSnapshot['capabilities']; savedVersion: string; command: (action: string, options?: Record<string, unknown>) => Promise<LiveResult>; preview: (url: string, name: string, details?: Partial<PreviewMedia>) => void; changed: () => Promise<void>; report: (message: string) => void };
const key = (take: Revision) => `${take.scene}:${take.revision}`;
const label = (take: Revision) => take.used_in_final_cut ? 'In final cut' : take.active ? 'Active take' : take.take_kind === 'editorial_alternate' ? 'Picture alternate' : 'Saved checkpoint';
const thumb = (project: string, take: Revision, server: string) => checkpointThumbnailUrl(project, { ...take, presentation_video: undefined, presentation_revision: undefined }, server);

function ComparePreview({ name, take, media, poster, active, play }: { name: string; take: Revision; media: PreviewMedia; poster: string; active: boolean; play: () => void }) {
  const picture = useRef<HTMLVideoElement>(null), sound = useRef<HTMLAudioElement>(null);
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(take.delivered_frames / 24), [playing, setPlaying] = useState(false), [muted, setMuted] = useState(false), [error, setError] = useState('');
  const stop = () => { picture.current?.pause(); sound.current?.pause(); setPlaying(false); };
  const sync = () => {
    if (!sound.current || !picture.current) return;
    const audio = sound.current; audio.muted = muted;
    if (Math.abs(audio.currentTime - picture.current.currentTime) > .1) audio.currentTime = picture.current.currentTime;
    if (!picture.current.paused && active && !picture.current.seeking && !muted) void audio.play().catch(() => setError('Audio could not play. Try Play again.')); else audio.pause();
  };
  useEffect(() => { if (!active) stop(); }, [active]);
  useEffect(() => { sync(); }, [muted]);
  useEffect(() => { const video = picture.current, audio = sound.current; return () => { video?.pause(); audio?.pause(); }; }, []);
  return <section className="take-compare-preview" aria-label={`Take ${name}`}>
    <header><strong>{name} · {label(take)}</strong><span>{take.revision.slice(0, 8)}</span></header>
    <video ref={picture} src={media.url} poster={poster || undefined} muted={Boolean(media.audioUrl) || muted} preload="metadata" playsInline
      onLoadedMetadata={() => { if (Number.isFinite(picture.current?.duration)) setDuration(picture.current!.duration); }}
      onTimeUpdate={() => { setPosition(picture.current?.currentTime || 0); sync(); }} onSeeking={() => sound.current?.pause()} onSeeked={sync}
      onPlay={() => { play(); setPlaying(true); }} onPlaying={sync} onPause={() => { sound.current?.pause(); setPlaying(false); }} onEnded={stop}
      onWaiting={() => sound.current?.pause()} onError={() => setError('This take could not be played.')} />
    {media.audioUrl && <audio ref={sound} src={media.audioUrl} preload="metadata" hidden onLoadedMetadata={sync}/>}
    <div className="take-compare-transport"><button aria-label={`${playing ? 'Pause' : 'Play'} take ${name}`} disabled={!media.url} onClick={() => { if (playing) stop(); else { setError(''); play(); if (picture.current && picture.current.currentTime >= duration) picture.current.currentTime = 0; void picture.current?.play().catch(() => setError('This take could not start.')); } }}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button><input aria-label={`Seek take ${name}`} type="range" min="0" max={duration || 0} step={1 / 24} value={Math.min(position, duration)} onChange={event => { if (picture.current) { picture.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } }}/><span>{timecode(position)}</span><label><input type="checkbox" checked={muted} onChange={event => setMuted(event.target.checked)}/>Mute</label></div>
    <div className="take-details"><span>{timecode(take.delivered_frames / 24)}</span><span>{take.steps} steps</span><span className="code">Seed {take.seed}</span></div><p className="take-prompt">{take.prompt || 'No saved prompt.'}</p>
    {error && <p role="alert" className="playback-notice">{error}</p>}
  </section>;
}

export function TakesPanel({ project, branchId, server, planId, scene, workflow, connected, editable: canEdit, capabilities, savedVersion, command, preview, changed, report, mode = 'takes', active = true, playbackAllowed = true, onPlay }: Props) {
  const [processed, setProcessed] = useState<ProcessingTake[]>([]), [processingWarnings, setProcessingWarnings] = useState<string[]>([]), [stage, setStage] = useState(mode === 'processing' ? 'derope' : 'original');
  const [revisions, setRevisions] = useState<Revision[]>([]), [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]), [editorial, setEditorial] = useState<Editorial | null>(null);
  const [filter, setFilter] = useState(String(scene)), [busy, setBusy] = useState(false), [writing, setWriting] = useState(false), [notice, setNotice] = useState('');
  const [comparison, setComparison] = useState<[string, string] | null>(null), [playing, setPlaying] = useState('');
  const [impact, setImpact] = useState<Impact | null>(null);
  const comparisonView = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null), epoch = useRef(0), reportRef = useRef(report); reportRef.current = report;
  const connectedStudio = workflow.prompt[planId]?.class_type === 'MiniMaxH3ChainPlanStudio' && isLink(workflow.prompt[planId]?.inputs.plan);
  const editable = canEdit && !connectedStudio;
  const binding = resolvePlanBinding(workflow.prompt, planId);
  const manager = binding.status === 'bound' && binding.project === project ? binding.managerId : undefined;
  const managers = productionRoles(workflow.prompt, planId).roles.checkpoint.nodes;
  const checkpointManager = managers.length === 1 ? managers[0].nodeId : undefined;
  const document = resolvePlanDocument(workflow.prompt, planId);
  const directPlan = document.status === 'resolved' && document.nodeId === planId && document.widget === 'plan_json' && document.editable;
  const canRestore = capabilities?.checkpoints && directPlan;
  const read = useCallback(async () => {
    request.current?.abort(); if (!connected || !project) return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const data = verifyBranch(await comfy<{ working_branch_id?: string; run_name?: string; revisions: Revision[]; checkpoints: Checkpoint[]; editorial?: Editorial; processing_variants?: ProcessingTake[]; processing_variant_warnings?: string[] }>(branchPath(`${H3}/checkpoints?${new URLSearchParams({ run_name: project, include_graph: 'true' })}`, branchId), { signal: controller.signal }), branchId);
      if (data.run_name && data.run_name !== project || !Array.isArray(data.revisions) || !Array.isArray(data.checkpoints)) throw new Error('H3 returned unexpected checkpoint data.');
      if (!controller.signal.aborted) { setProcessed(data.processing_variants || []); setProcessingWarnings(data.processing_variant_warnings || []); setRevisions(data.revisions.map(item => ({ ...item, working_branch_id: branchId }))); setCheckpoints(data.checkpoints); setEditorial(data.editorial || null); }
    } catch (error) { if (!controller.signal.aborted) reportRef.current(String(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [project, branchId, server, connected]);
  useEffect(() => { void read(); return () => { epoch.current++; request.current?.abort(); }; }, [read, savedVersion]);
  useEffect(() => { setFilter(String(scene)); setComparison(null); setPlaying(''); }, [scene]);
  useEffect(() => { if (comparison) comparisonView.current?.scrollIntoView({ block: 'start' }); }, [comparison]);
  useEffect(() => { if (!active || !playbackAllowed) setPlaying(''); }, [active, playbackAllowed]);
  const mutate = async (action: string, options: Record<string, unknown>) => {
    if (!editable || !manager || writing) return;
    const started = epoch.current; setWriting(true); setPlaying(''); setNotice('');
    try {
      const result = await command(action, { node: manager, plan: planId, project, branch_id: branchId, ...options });
      if (result.warning) reportRef.current(result.warning);
      if (action === 'checkpoint-preview') { if (epoch.current === started) setImpact(result.data as Impact); }
      else { setImpact(null); await changed(); if (epoch.current === started) { await read(); if (!result.warning) setNotice(action === 'take-final-cut' ? 'Saved final-cut picture updated.' : 'Checkpoint branch restored. Save the workflow in ComfyUI to keep its restored scene settings.'); } }
    } catch (error) { setImpact(null); reportRef.current(String(error)); }
    finally { setWriting(false); }
  };
  const visible = revisions.filter(item => stage === 'original' && (filter === 'all' || item.scene === Number(filter)));
  const compared = comparison?.map(id => revisions.find(item => key(item) === id));
  const chooseComparison = (take: Revision) => {
    const base = checkpoints.find(item => item.scene === take.scene), current = revisions.find(item => item.scene === take.scene && item.revision === (base?.presentation_revision || base?.revision));
    const other = visible.find(item => item.scene === take.scene && key(item) !== key(take) && (item.video || item.preview_video));
    setComparison([key(current && key(current) !== key(take) ? current : other || take), key(take)]); setPlaying('');
  };
  return <div className="project-panel takes-panel"><div className="section-heading"><div><h2>{mode === 'processing' ? 'Finishing outputs' : 'Checkpoints & takes'}</h2><p>{project} · {mode === 'processing' ? 'saved processing inventory' : 'saved pictures and generation history'}</p></div><button disabled={busy || writing || !connected} onClick={() => void read()}><RefreshCw size={13}/>{busy ? 'Reading…' : 'Refresh'}</button></div>
    <div className="project-actions"><select aria-label="Filter checkpoint scenes" value={filter} onChange={event => { setFilter(event.target.value); setComparison(null); setPlaying(''); }}><option value="all">All scenes</option>{[...new Set([scene, ...revisions.map(item => item.scene), ...processed.map(item => item.scene)])].sort((a, b) => a - b).map(value => <option key={value} value={value}>Scene {value}</option>)}</select><button disabled={!revisions.length} onClick={() => downloadJSON(`${project}.checkpoints.json`, { run_name: project, working_branch_id: branchId, revisions, processing_variants: processed })}><ArrowDownToLine size={14}/>Export checkpoint list</button>{checkpointManager && editable && <button onClick={() => void command('focus', { node: checkpointManager }).catch(error => report(String(error)))}><ArrowUpRight size={13}/>Manage branches in ComfyUI</button>}</div>
    <div className="processing-tabs" role="tablist" aria-label="Take stage">{[['original', 'Original'], ['derope', 'DeRoPE'], ['latent_upscale', 'Latent upscale'], ['pixel_upscale', 'Pixel upscale'], ['other', 'Other processing']].filter(([id]) => id !== 'other' || processed.some(item => item.stage === id)).map(([id, name]) => <button key={id} role="tab" aria-selected={stage === id} onClick={() => { setStage(id); setComparison(null); setPlaying(''); }}>{name}<span className="count">{id === 'original' ? revisions.length : processed.filter(item => item.stage === id).length}</span></button>)}</div>
    {stage !== 'original' && <><p className="hint">Saved processing outputs for this working branch. Preview and download here; choose the processing output path in ComfyUI’s Checkpoint Manager.</p>{processingWarnings.map((warning, i) => <p className="playback-notice" key={i}>{warning}</p>)}{processed.filter(item => item.stage === stage && (filter === 'all' || item.scene === Number(filter))).map(item => <article className="take-card" key={item.key} aria-label={`Processed scene ${item.scene} ${item.profile}`}><div className="take-card-title"><Film size={17}/><strong>{item.scene_id} · {item.profile}</strong><span>{item.ready ? 'Saved' : 'Incomplete'}</span></div><div className="take-details"><span>Scene {item.scene}</span><span>{item.width} × {item.height}</span><span>{timecode((item.delivered_frames || 0) / 24)}</span><span>{item.created_at ? new Date(item.created_at).toLocaleString() : 'Save date unavailable'}</span></div><p className="hint">Source {item.source_revision.slice(0, 8)} · {item.source_status}</p>{!!item.missing_files?.length && <p className="playback-notice">Missing: {item.missing_files.join(', ')}</p>}<div className="project-actions"><button disabled={!item.video} onClick={() => preview(mediaUrl(item.video), `${item.scene_id} · ${item.profile}`, { kind: 'video', scene: item.scene, sceneId: item.scene_id, audioUrl: mediaUrl(item.audio) })}>Preview processed take</button>{item.video && <a className="button" href={mediaUrl(item.video)} download={item.video.filename}>Download processed clip</a>}{item.audio && <a className="button" href={mediaUrl(item.audio)} download={item.audio.filename}>Download audio</a>}</div></article>)}</>}
    {!directPlan && <p className="hint">Restoring checkpoints into connected or read-only Plan text is not supported yet. Saved-picture choices do not rewrite the Plan text.</p>}
    {connectedStudio && <p className="hint">Select the upstream Plan in the Plan selector to manage this Studio’s saved takes.</p>}
    {!canEdit && <p className="hint">Attach this workflow and apply or recover its prompt draft before changing saved takes.</p>}
    {editable && (!capabilities?.finalCut || !capabilities?.checkpoints) && <p className="hint">Some native take actions are unavailable. Refresh the ComfyUI browser tab and reopen SceneWeaver to load the installed H3 adapters.</p>}
    {notice && <p className="take-notice" role="status"><Check size={14}/>{notice}</p>}
    {compared?.every(Boolean) && <div className="take-comparison" ref={comparisonView}><div className="section-heading"><strong>Compare scene {compared[0]!.scene}</strong><button aria-label="Close take comparison" onClick={() => { setComparison(null); setPlaying(''); }}><X size={14}/></button></div><p className="hint">Play either take to hear it. Picture alternates use their base checkpoint’s generated audio.</p><div className="take-comparison-grid">{compared.map((take, index) => <ComparePreview key={`${index}:${key(take!)}`} name={index ? 'B' : 'A'} take={take!} media={revisionMedia(take!, revisions, checkpoints)} poster={thumb(project, take!, server)} active={active && playbackAllowed && playing === `${index}:${key(take!)}`} play={() => { onPlay?.(); setPlaying(`${index}:${key(take!)}`); }}/>)}</div></div>}
    {visible.map(item => {
      const base = checkpoints.find(checkpoint => checkpoint.scene === item.scene && checkpoint.scene_id === item.scene_id), picture = item.take_kind === 'editorial_alternate';
      const compatible = base?.ready && (picture ? item.alternate_of_revision === base.revision : item.revision === base.revision);
      const inCut = Boolean(base && (base.presentation_revision || base.revision) === item.revision);
      return <article className="take-card" key={key(item)} aria-label={`Scene ${item.scene} take ${item.revision}`}><div className="take-card-overview"><button className="take-thumbnail" aria-label={`Compare take ${item.revision}`} disabled={!item.video && !item.preview_video} onClick={() => chooseComparison(item)}><Film size={25}/><CheckpointThumbnail url={thumb(project, item, server)} name={item.scene_id}/></button><div><div className="take-card-title"><strong>{item.scene_id} · {item.revision.slice(0, 8)}</strong><span className={inCut ? 'active-take' : 'muted'}>{inCut ? 'In final cut' : label(item)}</span></div><div className="take-details"><span>Scene {item.scene}</span><span>{timecode(item.delivered_frames / 24)}</span><span>{item.steps} steps</span><span className="code">Seed {item.seed}</span></div></div></div>
        <p className="take-prompt">{item.prompt || 'No saved prompt.'}</p><small className="hint">{item.lineage_status} · {item.descendant_count || 0} downstream takes{item.dependencies?.length ? ` · Depends on ${item.dependencies.map(dep => `scene ${dep.scene} / ${dep.revision.slice(0, 8)}`).join(', ')}` : ''}</small>
        <div className="project-actions"><button disabled={!item.video && !item.preview_video} onClick={() => chooseComparison(item)}>Compare takes</button><button disabled={!item.video && !item.preview_video} onClick={() => { const media = revisionMedia(item, revisions, checkpoints); preview(media.url, item.scene_id, media); }}>Preview take</button><button disabled={!editable || !manager || !capabilities?.finalCut || writing || !item.ready || !compatible || inCut} onClick={() => void mutate('take-final-cut', { scene: item.scene, scene_id: item.scene_id, take_revision: item.revision, base_revision: base?.revision, editorial_revision: editorial?.revision })}><Check size={13}/>{inCut ? 'In final cut' : 'Use in final cut'}</button>{!picture && <button disabled={!editable || !manager || !canRestore || writing || !item.ready} onClick={() => void mutate('checkpoint-preview', { scene: item.scene, scene_id: item.scene_id, take_revision: item.revision })}><GitBranch size={13}/>Restore checkpoint…</button>}{item.video && <a className="button" href={mediaUrl(item.video)} download={item.video.filename}><ArrowDownToLine size={13}/>Download clip</a>}</div>
        {picture && !compatible && <p className="hint">Activate this alternate’s base checkpoint before using its picture in the cut.</p>}
      </article>;
    })}
    {stage === 'original' && !visible.length && !busy && <div className="empty-large"><Film size={30}/><p>No saved takes found for this scene. Select All scenes to browse the project.</p></div>}
    {stage !== 'original' && !busy && !processed.some(item => item.stage === stage && (filter === 'all' || item.scene === Number(filter))) && <p className="empty-small">No saved outputs at this stage for the selected scenes.</p>}
    {impact && <Modal title="Restore checkpoint branch" onClose={() => { if (!writing) setImpact(null); }} wide><div className="modal-body"><p><strong>{impact.scope.title} · scenes {impact.scope.start}–{impact.scope.end}</strong></p><p>This changes clip selection for the <strong>{branchId === 'main' ? 'Original' : branchId.slice(0, 8)}</strong> working branch of <strong>{project}</strong>. Other workflows using that same branch will see the updated selection. The attached Plan’s scene settings will be restored from the chosen checkpoints.</p><div className="checkpoint-impact"><div><strong>Activate</strong><ul>{impact.restored.map(item => <li key={key(item)}>Scene {item.scene} · {item.revision.slice(0, 8)} · {item.scene_id}</li>)}</ul></div><div><strong>Clear later active pointers</strong>{impact.retired.length ? <ul>{impact.retired.map(item => <li key={key(item)}>Scene {item.scene} · {item.revision.slice(0, 8)}</li>)}</ul> : <p>None</p>}</div></div>{!!impact.outsideDependents.length && <p className="playback-notice">Other chapters have checkpoints that depend on the changed branch: scenes {impact.outsideDependents.map(item => item.scene).join(', ')}. Their active choices stay in place; review their continuity before generating.</p>}<p>Saved revision files and rendered videos are retained. Generation will remain stopped.</p></div><footer><button disabled={writing} onClick={() => setImpact(null)}>Cancel</button><button className="primary" disabled={writing || !editable} onClick={() => void mutate('checkpoint-activate', { ticket: impact.ticket })}>{writing ? 'Restoring…' : 'Restore this branch'}</button></footer></Modal>}
  </div>;
}
