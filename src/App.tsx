import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, Braces, Check, ChevronDown, ChevronRight, CircleHelp, Clapperboard, Film, FolderOpen, GitBranch, Layers, ListVideo, LoaderCircle, Monitor, Play, Plus, RefreshCw, Save, Search, Settings2, Square, Upload, X , Link2 } from 'lucide-react';
import type { LiveSnapshot, MediaFile, Plan, PreviewMedia, Review, Schemas, Value, Workflow } from './types';
import { downloadJSON, importWorkflow, isLink, nodeTitle, parseJSON, setInput, validatePrompt } from './lib/workflow';
import { checkpointFor, effectiveRunName, planNodes, planProblems, promptText, rawFrames, readPlan } from './lib/h3';
import { comfy, H3, mediaUrl, request } from './lib/api';
import { useComfy } from './hooks/useComfy';
import { JsonEditor, Modal } from './components/Controls';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { ReviewPanel } from './components/ReviewPanel';
import type { ReviewResult } from './components/ReviewPanel';
import { useLiveWorkflow } from './hooks/useLiveWorkflow';
import { liveWorkflow } from './lib/live';
import { diffInputs, rebaseDraft } from '../public/integrations/bridge-core.mjs';
import { ProjectPanel } from './components/ProjectPanel';
import { TakesPanel } from './components/TakesPanel';
import { useDraftRecovery } from './hooks/useDraftRecovery';
import { recoverDraft } from './lib/drafts';
import { GenerationPanel } from './components/GenerationPanel';
import { relayChannels } from './lib/previewRelay';
import { PreviewPlayer, type PlayerControls } from './components/PreviewPlayer';
import { useProjectPlayback } from './hooks/useProjectPlayback';
import { CheckpointThumbnail } from './components/CheckpointThumbnail';
import { checkpointMedia, checkpointThumbnailUrl, playbackSegments, parseSubtitles } from './lib/playback';

const STORAGE = 'sceneweaver.project.v1';
const empty: Workflow = { name: 'Untitled project', prompt: {}, bindings: {}, warnings: [] };
const readSaved = (): Workflow => {
  try {
    const value = localStorage.getItem(STORAGE);
    if (value) { const data = parseJSON(value) as Workflow; if (data.prompt && data.bindings && Array.isArray(data.warnings)) return data; }
  } catch { /* A fresh project remains available if browser storage is unavailable. */ }
  return empty;
};

export default function App() {
  const [workflow, setWorkflow] = useState<Workflow>(() => location.hash.includes('sceneweaver_session') ? empty : readSaved());
  const workflowRef = useRef(workflow); workflowRef.current = workflow;
  const [demoSchemas, setDemoSchemas] = useState<Schemas>({});
  const [selectedPlan, setSelectedPlan] = useState('');
  const plans = planNodes(workflow.prompt), planId = plans.some(([id]) => id === selectedPlan) ? selectedPlan : plans[0]?.[0] || '';
  const planNode = workflow.prompt[planId];
  let plan: Plan | null = null, planError = '';
  if (planNode) { try { plan = readPlan(planNode.inputs.plan_json); } catch (error) { planError = String(error); } }
  const runName = effectiveRunName(workflow.prompt, planId);
  const server = useComfy(runName, location.hash.includes('sceneweaver_session'));
  const live = useLiveWorkflow(server.target, server.connected);
  const [baseline, setBaseline] = useState<LiveSnapshot | null>(null);
  const baselineRef = useRef(baseline); baselineRef.current = baseline;
  const [conflicts, setConflicts] = useState<string[]>([]);
  const draftEdits = baseline ? diffInputs(baseline, workflow) : [];
  const wrongTab = Boolean(baseline && live.snapshot && baseline.binding !== live.snapshot.binding);
  const baseCanWriteLive = server.connected && live.status === 'attached' && Boolean(baseline) && !wrongTab && !conflicts.length;
  const schemas = server.connected ? server.schemas : demoSchemas;
  const [selected, setSelected] = useState(0), [selectedNode, setSelectedNode] = useState('');
  const [page, setPage] = useState('edit'), [inspectorTab, setInspectorTab] = useState('scene'), [bin, setBin] = useState('scenes');
  const [search, setSearch] = useState(''), [queueOpen, setQueueOpen] = useState(false), [modal, setModal] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(true);
  const [library, setLibrary] = useState<string[]>([]), [librarySearch, setLibrarySearch] = useState(''), [urlDraft, setUrlDraft] = useState(server.target);
  const [previewOverride, setPreviewOverride] = useState<PreviewMedia | null>(null);
  const [takeChoice, setTakeChoice] = useState('presentation');
  const projectPlayback = useProjectPlayback(runName, server.connected, server.target);
  const [currentTime, setCurrentTime] = useState(0), [selectionKey, setSelectionKey] = useState(0);
  const [pendingTimelineSeek, setPendingTimelineSeek] = useState<number | null>(null);
  const player = useRef<PlayerControls>(null), fileInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (page !== 'edit' || pendingTimelineSeek === null || !player.current) return;
    player.current.seekSequence(pendingTimelineSeek); setPendingTimelineSeek(null);
  }, [page, pendingTimelineSeek]);
  const initialized = useRef(false), objectUrls = useRef<string[]>([]);
  const [sessionMedia, setSessionMedia] = useState<{ name: string; url: string; kind: string }[]>([]);
  const [recoveryRun, setRecoveryRun] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(true);
  const closeModal = useCallback(() => setModal(''), []);
  const activeShot = plan?.shots[selected], checkpoint = checkpointFor(server.checkpoints, activeShot, selected);
  const alternatives = checkpoint?.alternates?.filter(take => take.base_revision === checkpoint.revision && take.video) || [];
  const selectedTake = alternatives.find(take => take.revision === takeChoice);
  const preview: PreviewMedia = previewOverride || (checkpoint ? selectedTake
    ? { ...checkpointMedia(checkpoint), url: mediaUrl(selectedTake.video), audioUrl: mediaUrl(checkpoint.audio) }
    : checkpointMedia(checkpoint, takeChoice !== 'base') : { url: '', name: activeShot?.id || 'Viewer', scene: selected + 1, sceneId: activeShot?.id });
  const segments = playbackSegments(plan, planNode?.inputs || {}, server.checkpoints, server.editorial);
  const entries = segments.map(segment => { const saved = checkpointFor(server.checkpoints, plan?.shots[segment.index], segment.index); return { ...segment, media: saved ? checkpointMedia(saved) : { url: '', name: segment.id, kind: 'video' as const, scene: segment.index + 1, sceneId: segment.id } }; });
  const previewSegment = preview.scene ? segments.find(item => item.index === preview.scene! - 1 && (!preview.sceneId || item.id === preview.sceneId)) : undefined;
  const previewChannels = relayChannels(baseline?.nodes || workflow.prompt);
  const subtitleAsset = projectPlayback.assets.find(asset => asset.id === server.editorial?.subtitles?.asset_id);
  const subtitleCues = useMemo(() => parseSubtitles(String(subtitleAsset?.lyrics || '')), [subtitleAsset?.lyrics]);
  const sourcePresentation = projectPlayback.presentation;
  const sourceUrl = sourcePresentation?.source_audio?.available && sourcePresentation.token ? `/comfy${H3}/plan-studio/source-audio?${new URLSearchParams({ token: sourcePresentation.token })}` : '';
  const activeReviews = server.reviews.filter(r => !runName || r.run_name === runName);
  const reviewTokens = activeReviews.map(review => review.token).join(',');
  const latestJob = server.jobs[0];
  const report = (message: string) => setError(message.replace(/^Error: /, ''));
  const recovery = useDraftRecovery(live.requested && new URLSearchParams(location.hash.slice(1)).get('comfy_origin') === new URL(server.target).origin, server.target, baseline, planId, workflow);
  const canWriteLive = baseCanWriteLive && !recovery.pending;
  const recovered = recovery.pending && baseline ? recoverDraft(baseline, recovery.pending) : null;
  const notify = (message: string) => { setNotice(message); setTimeout(() => setNotice(''), 6000); };
  const select = (index: number) => { setSelectionKey(value => value + 1); setPage('edit'); setSelected(Math.max(0, index)); setPreviewOverride(null); setCurrentTime(0); setTakeChoice('presentation'); };
  const selectNode = (id: string) => { setSelectedNode(id); setInspectorTab('node'); };
  const change = (next: Workflow) => { setWorkflow(next); setSaved(false); };
  const updateInput = (id: string, key: string, value: Value) => {
    if (recovery.pending) { report('Review or discard the saved draft before making new edits.'); setRecoveryOpen(true); return; }
    if (live.requested && !baseline?.nodes[id]?.editable.includes(key)) { report('This input is controlled by ComfyUI. Edit it in the original node.'); return; }
    change(setInput(workflow, id, key, value));
  };
  const updatePlan = (next: Plan) => updateInput(planId, 'plan_json', JSON.stringify(next, null, 2));
  const applyDecision = (review: Review, result: ReviewResult) => {
    if (live.requested) { void live.command('snapshot').catch(e => report(String(e))); return; }
    if (result.seed === undefined || result.scene_prompt === undefined) return;
    setWorkflow(current => {
      if (effectiveRunName(current.prompt, planId) !== review.run_name || current.prompt[planId]?.inputs.plan_json !== workflow.prompt[planId]?.inputs.plan_json) return current;
      const currentPlan = readPlan(current.prompt[planId].inputs.plan_json), index = review.clip_index - 1, shot = currentPlan.shots[index];
      if (!shot || shot.id !== review.shot_id) return current;
      // Preserve a newly drafted direction when approving an older take.
      const direction = result.action === 'retry' || promptText(shot.prompt) === review.scene_prompt ? result.scene_prompt : shot.prompt;
      const shots = currentPlan.shots.map((item, i) => i === index ? { ...item, prompt: direction, seed: result.seed, length: result.length ?? item.length } : item);
      return setInput(current, planId, 'plan_json', JSON.stringify({ ...currentPlan, shots }, null, 2));
    });
    setSaved(false);
  };
  const addScene = () => { if (plan) { updatePlan({ ...plan, shots: [...plan.shots, { id: `scene_${crypto.randomUUID().slice(0, 6)}`, prompt: '' }] }); select(plan.shots.length); } };
  const showPreview = (url: string, name: string, details: Partial<PreviewMedia> = {}) => { setSelectionKey(value => value + 1); if (details.scene) setSelected(details.scene - 1); setPreviewOverride({ url, name, ...details }); setPage('edit'); setCurrentTime(0); setTakeChoice('presentation'); };
  const saveProject = useCallback(() => {
    if (live.requested) {
      if (draftEdits.length) { downloadJSON('sceneweaver-prompt-draft.json', { workflow: baseline?.name, edits: draftEdits }); return; }
      void live.command('export', {}, baseline).then(result => downloadJSON(`${result.name || 'ComfyUI workflow'}.json`, result.workflow)).catch(e => report(String(e))); return;
    }
    downloadJSON(`${workflow.name.replace(/\.json$/i, '')}.sceneweaver.json`, { sceneweaver: 1, name: workflow.name, workflow: workflow.source || workflow.prompt });
    setSaved(true);
  }, [workflow, live.requested, live.command, draftEdits.length, baseline]);
  const acceptSnapshot = (snapshot: LiveSnapshot) => { setBaseline(snapshot); setWorkflow(liveWorkflow(snapshot)); setConflicts([]); setSaved(true); };
  const applyLiveDraft = async () => {
    if (!baseline || !canWriteLive || !draftEdits.length) return;
    setBusy(true);
    const submitted = workflowRef.current;
    try {
      const result = await live.command('patch', { edits: draftEdits }, baseline);
      if (result.snapshot) {
        const appliedBase = { ...baseline, nodes: Object.fromEntries(Object.entries(baseline.nodes).map(([id, node]) => [id, { ...node, inputs: submitted.prompt[id].inputs }])) };
        const rebased = rebaseDraft(appliedBase, result.snapshot, workflowRef.current);
        setBaseline(result.snapshot); setWorkflow(rebased.draft); setConflicts(rebased.conflicts);
      }
      notify('Applied to the original ComfyUI workflow.');
    } catch (e) { report(String(e)); } finally { setBusy(false); }
  };
  const load = (raw: unknown, name: string) => {
    const next = importWorkflow(raw, name.replace(/\.json$/i, ''), schemas);
    change(next); select(0); setSelectedNode(''); setSelectedPlan(''); setModal(''); setError(''); setRecoveryRun('');
    notify(`Loaded ${next.name}`);
  };
  useEffect(() => {
    if (initialized.current) return; initialized.current = true;
    void request<Schemas>('/examples/h3-schemas.json').then(setDemoSchemas).catch(e => report(String(e)));
    return () => { objectUrls.current.forEach(URL.revokeObjectURL); };
  }, []); // Initialization preserves a locally restored project.
  useEffect(() => {
    if (live.requested) return; // A live project and its session stay owned by ComfyUI.
    const timer = setTimeout(() => { try { localStorage.setItem(STORAGE, JSON.stringify(workflow)); } catch { setError('Browser storage is full or unavailable. Export the project to keep your changes.'); } }, 500);
    return () => clearTimeout(timer);
  }, [workflow, live.requested]);
  useEffect(() => {
    const snapshot = live.snapshot, base = baselineRef.current;
    if (!snapshot) return;
    if (!base) { acceptSnapshot(snapshot); return; }
    if (base.binding !== snapshot.binding || base.revision === snapshot.revision) return;
    const rebased = rebaseDraft(base, snapshot, workflowRef.current);
    setConflicts(rebased.conflicts);
    if (!rebased.conflicts.length) { setBaseline(snapshot); setWorkflow(rebased.draft); }
  }, [live.snapshot]);
  useEffect(() => { setPreviewOverride(null); setTakeChoice('presentation'); setSelected(0); }, [runName]);
  live.onExecution.current = server.receiveEvent;
  useEffect(() => {
    if (!live.requested || !draftEdits.length || recovery.backedUp && !recovery.error) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [live.requested, draftEdits.length, recovery.backedUp, recovery.error]);
  useEffect(() => { setUrlDraft(server.target); }, [server.target]);
  useEffect(() => { if (reviewTokens) setQueueOpen(true); }, [reviewTokens]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); saveProject(); }
      const element = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable || modal || element.closest('[role="dialog"]')) return;
      if (event.code === 'Space' && player.current) { event.preventDefault(); player.current.toggle(); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, [saveProject, modal]);
  const openLibrary = async () => {
    setModal('library'); setBusy(true);
    try { const items = await comfy<string[]>('/userdata?dir=workflows&recurse=true&split=false'); setLibrary(items); } catch (e) { report(String(e)); } finally { setBusy(false); }
  };
  const render = async () => {
    if (live.requested) {
      if (!canWriteLive || draftEdits.length) { report('Apply or discard the prompt draft before queuing the live workflow.'); return; }
      setBusy(true);
      try { await live.command('queue', {}, baseline); await server.refresh(); setQueueOpen(true); notify('Queued through the original ComfyUI tab.'); } catch (e) { report(String(e)); } finally { setBusy(false); }
      return;
    }
    const problems = [...validatePrompt(workflow.prompt, server.schemas), ...(plan ? planProblems(plan, planNode.inputs) : planError ? [planError] : [])];
    if (problems.length) { report(problems.join('\n')); return; }
    setBusy(true); setError('');
    try { await server.enqueue(workflow); setQueueOpen(true); notify('Workflow queued in ComfyUI.'); } catch (e) { report(String(e)); } finally { setBusy(false); }
  };
  const openRun = async (name: string) => {
    setBusy(true);
    try {
      const result = await comfy<{ plan_inputs: Record<string, Value>; warnings: string[] }>(`${H3}/run?${new URLSearchParams({ run_name: name, include_assets: 'false' })}`);
      if (!planId) throw new Error('Load an H3 workflow before restoring a saved plan.');
      let next = workflow;
      for (const [key, value] of Object.entries(result.plan_inputs)) if (key in next.prompt[planId].inputs && !isLink(next.prompt[planId].inputs[key])) next = setInput(next, planId, key, value);
      const assetLink = next.prompt[planId].inputs.project_assets;
      if (isLink(assetLink) && next.prompt[assetLink[0]]?.class_type === 'MiniMaxH3ProjectAssetManager') next = setInput(next, assetLink[0], 'run_name', name);
      change(next); setRecoveryRun(name); setModal(''); select(0); notify(`Restored plan for ${name}. Inspect policy, model, references, and resume settings before queuing.`);
      if (result.warnings?.length) report(result.warnings.join('\n'));
    } catch (e) { report(String(e)); } finally { setBusy(false); }
  };
  const fileList = [...server.checkpoints.flatMap(c => c.video || c.presentation_video ? [{ file: c.presentation_video || c.preview_video || c.video!, name: `Scene ${c.scene} · ${c.scene_id}`, playback: checkpointMedia(c) }] : []), ...server.outputs.map(file => ({ file, name: file.filename, playback: undefined }))];
  const viewMedia = (file: MediaFile, name: string) => showPreview(mediaUrl(file), /\.[a-z0-9]+$/i.test(name) ? name : file.filename);
  const launchCode = `javascript:(()=>{const w=window.open('about:blank','SceneWeaverCompanion');import(${JSON.stringify(`${location.origin}/integrations/companion-client.mjs`)}).then(m=>m.launch(w,${JSON.stringify(location.origin)})).catch(e=>{w?.close();alert(e.message)});})();`;

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><div className="brand-mark"><Layers size={22}/></div><strong>SceneWeaver</strong><span className="alpha">COMPANION 0.3.0</span></div>
      <div className="project-title"><span className="project-status">{saved ? <Check size={12}/> : <span className="unsaved-dot"/>}</span><input aria-label="Project name" readOnly={live.requested} value={workflow.name} onChange={e => change({ ...workflow, name: e.target.value })}/><ChevronDown size={12}/></div>
      <div className="header-actions"><button className={`connection-status ${server.connected ? 'online' : ''}`} onClick={() => setModal('connection')}><span className={`status-dot ${server.connected ? 'green' : ''}`}/>{server.connecting ? 'Connecting…' : server.connected ? 'ComfyUI connected' : 'ComfyUI offline'}</button><button className="icon-button" onClick={() => setModal('help')} aria-label="About SceneWeaver"><CircleHelp size={17}/></button></div>
    </header>
    <div className="top-toolbar"><div className="toolbar-actions"><button className="live-attach-button" onClick={() => setModal('attach')}><Link2 size={15}/>{live.requested ? 'Live attachment' : 'Attach live workflow'}</button><button disabled={live.requested} onClick={() => fileInput.current?.click()}><FolderOpen size={15}/>Import workflow</button><button disabled={!server.connected || live.requested} onClick={() => void openLibrary()}><ListVideo size={15}/>Server library</button><span className="divider"/><button onClick={saveProject}><Save size={14}/>{live.requested ? draftEdits.length ? 'Export draft' : 'Export workflow' : 'Save project'}</button></div><div className="toolbar-actions"><button onClick={() => setQueueOpen(v => !v)} className={queueOpen ? 'active' : ''}><Activity size={14}/>Render queue<span className="count">{server.queue.queue_running.length + server.queue.queue_pending.length}</span></button><button className="primary render-button" disabled={!server.connected || !server.socketOnline || busy || !Object.keys(workflow.prompt).length || live.requested && (!canWriteLive || Boolean(draftEdits.length))} onClick={() => void render()}>{busy ? <LoaderCircle size={14} className="spin"/> : <Play size={13} fill="currentColor"/>}{live.requested ? 'Queue in ComfyUI' : 'Render workflow'}</button></div></div>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { load(parseJSON(await file.text()), file.name); } catch (error) { report(String(error)); } e.target.value = ''; }}/>
    {live.requested && <div className={`live-status-bar ${wrongTab || conflicts.length ? 'conflict' : ''}`}><div><span className={`status-dot ${canWriteLive ? 'green' : 'amber'}`}/><strong>{wrongTab ? 'ComfyUI tab changed' : live.status !== 'attached' ? 'Waiting for the ComfyUI tab' : conflicts.length ? 'Concurrent edit detected' : draftEdits.length ? `${draftEdits.length} unapplied change${draftEdits.length === 1 ? '' : 's'}` : 'Attached to live workflow'}</strong><span>{baseline?.name || 'Connecting…'}</span></div><div>{wrongTab ? <button onClick={() => live.snapshot && acceptSnapshot(live.snapshot)}>Attach current tab</button> : <><button disabled={!draftEdits.length && !conflicts.length} onClick={() => live.snapshot && acceptSnapshot(live.snapshot)}>Reload from ComfyUI</button><button className="primary" disabled={!canWriteLive || !draftEdits.length || busy} onClick={() => void applyLiveDraft()}>Apply to ComfyUI</button></>}</div>{!!conflicts.length && <small>Changed in both places: {conflicts.join(', ')}. Export your draft before reloading if you want to keep it.</small>}</div>}
    {(error || live.error || server.error || planError) && <div className="error-banner" role="alert"><span>{error || live.error || server.error || planError}</span><button className="icon-button" onClick={() => { setError(''); server.setError(''); }} aria-label="Dismiss error"><X size={15}/></button></div>}
    {notice && <div className="toast" role="status"><Check size={14}/>{notice}</div>}
    <main className="editor-main">
      <aside className="media-bin panel"><div className="panel-title"><span>Media pool</span><button className="icon-button" onClick={() => setModal('runs')} disabled={!server.connected} aria-label="Browse saved runs"><FolderOpen size={15}/></button></div>
        <div className="bin-tabs"><button className={bin === 'scenes' ? 'active' : ''} onClick={() => setBin('scenes')}>Scenes <span>{plan?.shots.length || 0}</span></button><button className={bin === 'media' ? 'active' : ''} onClick={() => setBin('media')}>Media <span>{fileList.length + sessionMedia.length}</span></button></div>
        <label className="search"><Search size={13}/><input aria-label="Search media pool" placeholder={bin === 'scenes' ? 'Find a scene…' : 'Find media…'} value={search} onChange={e => setSearch(e.target.value)}/></label>
        <div className="bin-section-label"><span>{bin === 'scenes' ? 'SCENE PLAN' : 'RENDERS & REFERENCES'}</span>{bin === 'scenes' && <button className="icon-button" disabled={!plan} onClick={addScene} aria-label="New scene"><Plus size={14}/></button>}</div>
        <div className="bin-content">{bin === 'scenes' ? <>
          {plans.length > 1 && <select aria-label="Active H3 plan" value={planId} onChange={e => { setSelectedPlan(e.target.value); select(0); }}>{plans.map(([id, node]) => <option key={id} value={id}>{nodeTitle(id, node)}</option>)}</select>}
          {plan?.shots.map((shot, index) => !`${shot.id} ${promptText(shot.prompt)}`.toLowerCase().includes(search.toLowerCase()) ? null : <button key={index} className={`scene-card ${selected === index && !previewOverride ? 'selected' : ''}`} onClick={() => { select(index); setInspectorTab('scene'); setPage('edit'); }}><div className={`scene-art tone-${index % 4}`}><span className="scene-number">{String(index + 1).padStart(2, '0')}</span><Clapperboard size={32} strokeWidth={1}/><CheckpointThumbnail url={checkpointThumbnailUrl(runName, checkpointFor(server.checkpoints, shot, index), server.target)} name={shot.id || `Scene ${index + 1}`}/><span className="scene-duration">{(rawFrames(shot, plan, planNode.inputs) / 24).toFixed(2)}s raw</span></div><div className="scene-card-info"><strong>{shot.id?.replaceAll('_', ' ') || 'Untitled scene'}</strong><span><i className={`status-dot ${checkpointFor(server.checkpoints, shot, index)?.ready ? 'green' : ''}`}/>{checkpointFor(server.checkpoints, shot, index)?.ready ? 'Rendered' : 'Not rendered'}</span></div></button>)}
          {!plan && <div className="empty-small">Import a workflow with an H3 Plan to see its scenes here.</div>}
        </> : <>
          <label className="button import-media"><Upload size={14}/>Add preview media<input type="file" hidden multiple accept="video/*,audio/*,image/*" onChange={e => { const files = [...e.target.files || []]; setSessionMedia(old => [...old, ...files.map(file => { const url = URL.createObjectURL(file); objectUrls.current.push(url); return { name: file.name, url, kind: file.type }; })]); }}/></label>
          {fileList.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map((item, index) => <button className="media-row" key={index} onClick={() => item.playback ? showPreview(item.playback.url, item.name, item.playback) : viewMedia(item.file, item.name)}><Film size={18}/><span>{item.name}<small>ComfyUI output</small></span></button>)}
          {sessionMedia.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map((item, index) => <button className="media-row" key={index} onClick={() => showPreview(item.url, item.name)}><Monitor size={18}/><span>{item.name}<small>Preview only · this session</small></span></button>)}
          {!fileList.length && !sessionMedia.length && <div className="empty-small">Completed clips appear here. Add local media for preview; bind generation references through node settings.</div>}
        </>}</div>
        <div className="bin-footer"><GitBranch size={13}/><span title={runName}>{runName || 'No H3 run selected'}</span><span>{Object.keys(workflow.prompt).length} nodes</span></div>
      </aside>

      <section className="center-panel panel">
        <div className="viewer-header"><div className="viewer-tabs"><button className={page === 'edit' ? 'active' : ''} onClick={() => setPage('edit')}><Monitor size={14}/>Viewer</button><button className={page === 'generation' ? 'active' : ''} onClick={() => setPage('generation')}>Generation</button><button className={page === 'workflow' ? 'active' : ''} onClick={() => setPage('workflow')}><GitBranch size={14}/>Workflow</button><button className={page === 'renders' ? 'active' : ''} onClick={() => setPage('renders')}><ListVideo size={14}/>Renders</button><button className={page === 'assets' ? 'active' : ''} onClick={() => setPage('assets')}>Assets</button><button className={page === 'takes' ? 'active' : ''} onClick={() => setPage('takes')}>Takes</button></div><span className="viewer-format">{planNode ? `${planNode.inputs.width} × ${planNode.inputs.height}` : 'H3 STUDIO'}<span>24 fps</span></span></div>
        {page === 'edit' ? <>
          {checkpoint && <div className="take-selector"><label>Scene take <select aria-label="Preview scene take" value={previewOverride ? 'external' : selectedTake ? takeChoice : takeChoice === 'base' ? 'base' : 'presentation'} onChange={e => { setSelectionKey(value => value + 1); setTakeChoice(e.target.value); setPreviewOverride(null); setCurrentTime(0); }}><option value="presentation">{checkpoint.presentation_revision ? 'Final cut · alternate' : 'Final cut · generated take'}</option><option value="base">Generated take · base</option>{alternatives.map((take, index) => <option key={take.revision} value={take.revision}>Alternate {index + 1}{take.used_in_final_cut ? ' · in final cut' : ''}</option>)}{previewOverride && <option value="external">Selected preview</option>}</select></label><button onClick={() => setPage('takes')}>All takes ({checkpoint.alternates?.length || 0} alternates)</button><span>Preview selection</span></div>}
          <PreviewPlayer key={`${server.target}:${runName}:${planId}`} media={preview} controls={player} segment={previewSegment} entries={entries} selectionKey={selectionKey} isolated={Boolean(previewOverride) || takeChoice !== 'presentation'} onScene={index => { setSelected(index); setPreviewOverride(null); setTakeChoice('presentation'); }} sourceUrl={sourceUrl} sourceSeek={sourcePresentation?.source_audio?.seek_seconds || 0} cues={subtitleCues} subtitleOffset={server.editorial?.subtitles?.offset_seconds || 0} captionsDefault={server.editorial?.subtitles?.mode === 'preview_srt'} previous={plan && selected > 0 ? () => select(selected - 1) : undefined} next={plan && selected < plan.shots.length - 1 ? () => select(selected + 1) : undefined} onTime={setCurrentTime} report={report} attach={() => setModal('attach')} hasScene={Boolean(activeShot)}/>
          {projectPlayback.warnings.length > 0 && <details className="playback-notice"><summary>Playback source information</summary>{projectPlayback.warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}
          <div className="viewer-caption"><span className="section-label">SCENE DIRECTION</span><p>{promptText(activeShot?.prompt) || 'Select a scene and write its direction in the inspector.'}</p></div>
        </> : page === 'generation' ? <GenerationPanel key={`${server.target}:${baseline?.binding || runName}`} pausedReason={wrongTab ? 'Return to the attached ComfyUI workflow to watch its preview.' : live.requested && live.status !== 'attached' ? 'Keep the attached ComfyUI tab open to watch previews.' : ''} installed={Boolean(server.schemas.PreviewRelay)} connected={server.connected} online={server.socketOnline} channels={previewChannels} subscribe={server.subscribePreviewRelay} target={server.target} reconnect={() => void server.connect(server.target)}/> : page === 'workflow' ? <div className="workflow-view"><div className="section-heading"><div><h2>Workflow controls</h2><p>Every node, input, and connection in your execution graph.</p></div><button disabled={live.requested} onClick={() => setModal('workflow-json')}><Braces size={14}/>Edit API graph</button></div>
          {!!workflow.warnings.length && <details className="notice"><summary>{workflow.warnings.length} import notes — review before rendering</summary>{workflow.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
          <div className="workflow-node-list">{Object.entries(workflow.prompt).map(([id, node]) => <button className={`workflow-node ${selectedNode === id ? 'selected' : ''}`} key={id} onClick={() => selectNode(id)}><div className={`node-symbol ${node.class_type.includes('H3') ? 'h3' : ''}`}><GitBranch size={16}/></div><div><strong>{nodeTitle(id, node)}</strong><small>{node.class_type}</small></div><span>{Object.keys(node.inputs).length} inputs</span><ArrowUpRight size={13}/></button>)}</div>
          <div className="workflow-exports"><button disabled={live.requested} onClick={() => downloadJSON('workflow.api.json', workflow.prompt)}><ArrowDownToLine size={14}/>Export API</button><button disabled={!workflow.source} onClick={() => downloadJSON('workflow.json', workflow.source)}><ArrowDownToLine size={14}/>Export canvas</button><a className="button" href={server.target} target="_blank" rel="noreferrer">Open ComfyUI<ArrowUpRight size={13}/></a></div>
        </div> : page === 'takes' ? <TakesPanel key={`${server.target}:${baseline?.binding || ''}:${runName}:${planId}`} project={runName} server={server.target} planId={planId} scene={selected + 1} workflow={workflow} connected={server.connected} editable={canWriteLive && !draftEdits.length} capabilities={baseline?.capabilities} savedVersion={JSON.stringify([server.editorial?.revision, server.checkpoints.map(item => [item.scene, item.revision, item.presentation_revision])])} command={(action, options) => live.command(action, options, baseline)} preview={showPreview} changed={server.refreshCheckpoints} report={report}/> : page === 'assets' ? <ProjectPanel tab={page} project={runName} scene={selected + 1} workflow={workflow} connected={server.connected} editable={canWriteLive && !draftEdits.length} command={live.command} preview={showPreview} report={report}/> : <div className="renders-view"><div className="section-heading"><div><h2>Rendered footage</h2><p>Saved clips and outputs for this production.</p></div><button disabled={!server.connected} onClick={() => void server.refreshCheckpoints()}><RefreshCw size={14}/>Refresh</button></div>{fileList.length ? fileList.map((item, i) => <div className="render-row" key={i}><Film size={22}/><div><strong>{item.name}</strong><small>{item.file.subfolder}</small></div><button onClick={() => item.playback ? showPreview(item.playback.url, item.name, item.playback) : viewMedia(item.file, item.name)}><Play size={13}/>Preview</button><a className="button" href={mediaUrl(item.file)} download={item.file.filename}><ArrowDownToLine size={14}/></a></div>) : <div className="empty-large"><Film size={34} strokeWidth={1}/><h3>No footage yet</h3><p>Render a workflow or browse an existing run.</p><button disabled={!server.connected} onClick={() => setModal('runs')}><FolderOpen size={14}/>Browse runs</button></div>}</div>}
      </section>
      <Inspector workflow={workflow} schemas={schemas} plan={plan} planId={planId} selected={selected} nodeId={selectedNode || planId} tab={inspectorTab} setTab={setInspectorTab} updateInput={updateInput} updatePlan={updatePlan} select={select} selectNode={selectNode} editJson={() => setModal('plan-json')} report={report} connected={server.connected}/>
    </main>
    <Timeline project={runName} server={server.target} plan={plan} inputs={planNode?.inputs || {}} checkpoints={server.checkpoints} editorial={server.editorial} selected={selected} select={select} add={addScene} currentTime={currentTime} onSeek={seconds => { setPage('edit'); setPendingTimelineSeek(seconds); }}/>
    <footer className="app-footer"><div><span className={`status-dot ${server.socketOnline ? 'green' : ''}`}/><span>{server.connected ? server.socketOnline ? 'Engine ready' : 'Reconnecting events…' : 'Offline editing'}</span><span className="footer-gpu">{server.gpu}</span></div><nav><button className={page === 'edit' ? 'active' : ''} onClick={() => setPage('edit')}><Clapperboard size={18}/>Edit</button><button className={page === 'workflow' ? 'active' : ''} onClick={() => setPage('workflow')}><GitBranch size={18}/>Workflow</button><button className={page === 'renders' ? 'active' : ''} onClick={() => setPage('renders')}><ArrowDownToLine size={18}/>Deliver</button></nav><div><span className="autosave">{live.requested ? recovery.pending ? 'Saved draft awaiting review' : draftEdits.length ? recovery.backedUp ? 'Draft backed up · apply to sync' : 'Prompt draft · apply to sync' : 'Synced with ComfyUI' : 'Local autosave'}</span><button className="icon-button" onClick={() => setModal('connection')} aria-label="Connection settings"><Settings2 size={16}/></button></div></footer>
    {latestJob?.progress !== undefined && <div className="global-progress" style={{ width: `${Math.max(1, latestJob.progress * 100)}%` }}/>}
    {recovery.error && <div className="draft-storage-error" role="alert">{recovery.error}</div>}
    {recovery.pending && !recoveryOpen && <div className="draft-storage-error">A saved prompt draft is waiting for review. <button onClick={() => setRecoveryOpen(true)}>Review saved draft</button></div>}
    {recovery.pending && recovered && recoveryOpen && <Modal title="Recover prompt draft" onClose={() => setRecoveryOpen(false)} wide><div className="modal-body"><p>A draft for <strong>{recovery.pending.name}</strong> was saved in this browser at {new Date(recovery.pending.updatedAt).toLocaleString()}.</p><p>Review its {recovery.pending.edits.length} widget change(s), then restore them into SceneWeaver. Use Apply to ComfyUI when you are ready to update the workflow.</p>{!!recovered.changed.length && <p className="playback-notice">ComfyUI has newer values for {recovered.changed.join(', ')}. Restoring stages your saved values over the current values shown below.</p>}{!!recovered.unavailable.length && <p role="alert">These widgets were removed or are no longer editable: {recovered.unavailable.join(', ')}. Export the saved draft to recover their text.</p>}<div className="draft-recovery-fields">{recovery.pending.edits.map(edit => <details key={`${edit.node}:${edit.widget}`}><summary>{baseline?.nodes[edit.node]?.title || edit.node} · {edit.widget}</summary><label>Current ComfyUI value<textarea readOnly value={String(baseline?.nodes[edit.node]?.inputs[edit.widget] ?? '')}/></label><label>Saved draft value<textarea readOnly value={String(edit.after)}/></label></details>)}</div></div><footer><button onClick={() => downloadJSON('sceneweaver-recovered-draft.json', recovery.pending)}>Export saved draft</button><button onClick={() => recovery.resolve()}>Discard saved draft</button><button className="primary" disabled={!baseCanWriteLive || !!recovered.unavailable.length} onClick={() => { setWorkflow(recovered.draft); setSaved(false); setConflicts([]); recovery.resolve(); }}>Restore draft</button></footer></Modal>}
    {modal === 'attach' && <Modal title="Attach to your open ComfyUI workflow" onClose={closeModal} wide><div className="modal-body"><p>The live companion reads the open tab, including unsaved changes. Prompt edits are staged here and applied back to that same workflow. Keep the ComfyUI tab open while using SceneWeaver.</p><h3>Connect now, without restarting ComfyUI</h3><p>Drag this link to your browser’s bookmarks bar, then click that bookmark while viewing your ComfyUI workflow:</p><a className="button primary bookmarklet" ref={element => { if (element) element.href = launchCode; }} onClick={e => { e.preventDefault(); notify('Drag this link to the bookmarks bar, then run it from your ComfyUI tab.'); }}>Open SceneWeaver companion</a><p className="hint">Your browser may ask to allow access to the local SceneWeaver address. The companion must be running at {location.origin}. The connected ComfyUI server is {server.target}.</p><details><summary>Use a console command instead</summary><textarea readOnly className="code" rows={5} aria-label="ComfyUI companion launcher" value={launchCode.slice('javascript:'.length)}/><button onClick={() => void navigator.clipboard.writeText(launchCode.slice('javascript:'.length)).then(() => notify('Launcher copied. Run it in your ComfyUI tab’s console.')).catch(e => report(String(e)))}>Copy launcher</button></details><h3>Persistent ComfyUI button</h3><p>Install ComfyUI-SceneWeaver-Companion under ComfyUI’s <code>custom_nodes</code> directory and restart ComfyUI when convenient. It adds an “Open SceneWeaver” button.</p><a className="button" href="https://github.com/ethanfel/ComfyUI-SceneWeaver-Companion" target="_blank" rel="noreferrer"><ArrowUpRight size={14}/>Companion repository & installation</a><hr/><p className="hint">An imported file is a separate document. For offline experimentation only, you can load the included starter.</p><button disabled={live.requested} onClick={async () => { try { load(await request('/examples/h3-starter.api.json'), 'Untitled H3 project'); } catch (e) { report(String(e)); } }}>Open offline starter</button></div></Modal>}

    {queueOpen && <aside className="queue-drawer"><header><h2>Render queue</h2><button className="icon-button" onClick={() => setQueueOpen(false)} aria-label="Close render queue"><X size={17}/></button></header><div className="queue-body">
      {activeReviews.map(review => <ReviewPanel key={review.token} review={review} refresh={server.refresh} report={report} preview={showPreview} applyDecision={applyDecision}/>)}
      {!activeReviews.length && <p className="hint">Scene reviews appear here when an enabled H3 Review Gate pauses the workflow.</p>}
      {server.jobs.map(job => <article className="job-card" key={job.id}><div><strong>{job.status}</strong>{['Queued', 'Rendering'].includes(job.status) && <button className="icon-button" aria-label="Stop this render" onClick={() => void server.cancelJob(job.id).catch(e => report(String(e)))}><Square size={13}/></button>}</div><small className="code">{job.id.slice(0, 16)}</small>{job.node && <p>Node {job.node}</p>}{job.progress !== undefined && <progress value={job.progress} max="1"/>}{job.error && <p className="field-error">{job.error}</p>}</article>)}
      <div className="section-label">COMFYUI SERVER QUEUE</div><p className="hint">{server.queue.queue_running.length} running · {server.queue.queue_pending.length} pending. Other clients’ renders are monitored in ComfyUI.</p>
      <details className="event-log"><summary>Connection & execution log</summary>{server.events.map((event, i) => <p key={i}>{event}</p>)}</details>
    </div></aside>}
    {modal === 'connection' && <Modal title="Connect to ComfyUI" onClose={closeModal}><div className="modal-body"><p>SceneWeaver uses your existing ComfyUI installation and H3 Context Loop nodes.</p><label className="field"><span>ComfyUI server address</span><input value={urlDraft} onChange={e => setUrlDraft(e.target.value)} placeholder="http://127.0.0.1:8188"/></label><p className="hint">The companion’s local server handles HTTP, media, and WebSocket connections. No ComfyUI CORS changes are needed. Address changes last until the companion restarts; use COMFYUI_URL in .env for a permanent default.</p>{server.connected && <div className="connection-info"><Check size={16}/>{server.gpu}<small>{Object.keys(server.schemas).length} installed node types</small></div>}</div><footer><button className="primary" disabled={server.connecting} onClick={() => { void server.connect(urlDraft); setModal(''); }}>{server.connecting ? 'Connecting…' : 'Connect'}</button></footer></Modal>}
    {modal === 'library' && <Modal title="ComfyUI workflow library" onClose={closeModal} wide><div className="modal-body"><label className="search"><Search size={15}/><input autoFocus aria-label="Search workflow library" placeholder="Search your saved workflows…" value={librarySearch} onChange={e => setLibrarySearch(e.target.value)}/></label><div className="library-list">{busy ? <p>Loading workflows…</p> : library.filter(name => name.toLowerCase().includes(librarySearch.toLowerCase())).sort((a, b) => Number(/h3|minimax/i.test(b)) - Number(/h3|minimax/i.test(a))).map(name => <button key={name} onClick={async () => { setBusy(true); try { load(await comfy(`/userdata/${encodeURIComponent(`workflows/${name}`)}`), name); } catch (e) { report(String(e)); } finally { setBusy(false); } }}><GitBranch size={15}/><span>{name}</span><ArrowUpRight size={14}/></button>)}</div></div></Modal>}
    {modal === 'runs' && <Modal title="Saved H3 runs" onClose={closeModal} wide><div className="modal-body"><p>Restore a run’s plan into the current workflow and browse its saved clips. Models, policy nodes, reference wiring, and loop resume settings remain under your control.</p><div className="library-list">{server.runs.map(run => <button key={run.run_name} disabled={busy || !planId || live.requested} onClick={() => void openRun(run.run_name)}><FolderOpen size={16}/><span>{run.run_name}<small>{String(run.checkpoint_count || 0)} checkpoints · {String(run.scene_count || '?')} scenes</small></span><ChevronRight size={14}/></button>)}{!server.runs.length && <p>No saved runs found on the connected server.</p>}</div></div></Modal>}
    {modal === 'workflow-json' && <JsonEditor title="Edit execution graph (API JSON)" value={workflow.prompt} onClose={closeModal} onApply={raw => { const next = importWorkflow(raw, workflow.name, schemas); const problems = validatePrompt(next.prompt, schemas); if (problems.length) throw new Error(problems.join('\n')); change(next); notify('API graph updated. Canvas metadata is omitted after direct graph edits; export API format.'); }}/>}
    {modal === 'plan-json' && <JsonEditor title="Edit H3 plan JSON" value={plan || planNode?.inputs.plan_json} onClose={closeModal} onApply={raw => updatePlan(readPlan(raw))}/>}
    {modal === 'help' && <Modal title="SceneWeaver · Companion 0.3.0" onClose={closeModal}><div className="modal-body help-body"><p>A dedicated production workspace for MiniMax H3 Context Loop, with a layout inspired by DaVinci Resolve.</p><p>Import a workflow, edit scenes and node settings, render, review takes, and preview or download the resulting footage.</p><p><strong>Workflow support:</strong> API exports and ordinary canvas workflows, including reroutes, primitive values, simple Get/Set buses, and unambiguous bypasses. Export API format from ComfyUI for subgraphs or custom frontend widgets.</p><p><strong>Timeline:</strong> click or drag the ruler to pause and seek the saved sequence. With the ruler focused, Left/Right steps a frame, Shift+Left/Right steps a second, and Home/End jumps to the start or end.</p><p><strong>Preview scope:</strong> the timeline edits generation order. Trimming, transitions, audio mixing, color grading, and arbitrary timeline export are planned for later versions. H3 assembly remains controlled through your workflow.</p><p><strong>Save:</strong> browser autosave keeps the current workflow. Save project downloads a portable file; local preview media is session-only. Ctrl/Cmd+S saves, Space plays or pauses.</p>{recoveryRun && <p>Recovered plan: {recoveryRun}</p>}<a href="https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop" target="_blank" rel="noreferrer">H3 Context Loop documentation <ArrowUpRight size={12}/></a></div></Modal>}
  </div>;
}
