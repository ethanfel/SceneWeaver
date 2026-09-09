import { useCallback, useEffect, useRef, useState } from 'react';
import type { Checkpoint, Editorial, ComfyEvent, MediaFile, Queue, Review, Run, Schemas, Workflow } from '../types';
import { comfy, H3, post, request } from '../lib/api';
import { branchPath, verifyBranch } from '../../public/integrations/branches-core.mjs';
import { parseJSON } from '../lib/workflow';
import type { RelaySubscribe } from '../lib/previewRelay';

export type Job = { id: string; status: string; node?: string; progress?: number; error?: string };
const emptyQueue: Queue = { queue_running: [], queue_pending: [] };
export function useComfy(runName: string, followProject = false, branchId = 'main') {
  const [target, setTarget] = useState('http://127.0.0.1:8188');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [socketOnline, setSocketOnline] = useState(false);
  const [schemas, setSchemas] = useState<Schemas>({});
  const [gpu, setGpu] = useState('');
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<Queue>(emptyQueue);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [editorial, setEditorial] = useState<Editorial | null>(null);
  const [outputs, setOutputs] = useState<MediaFile[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const clientId = useRef('');
  if (!clientId.current) {
    try { clientId.current = sessionStorage.getItem('sceneweaver.client') || crypto.randomUUID(); sessionStorage.setItem('sceneweaver.client', clientId.current); }
    catch { clientId.current = crypto.randomUUID(); }
  }
  const tracked = useRef(new Set<string>());
  const branchRef = useRef(branchId); branchRef.current = branchId;
  const [checkpointScope, setCheckpointScope] = useState('');
  const runRef = useRef(runName); runRef.current = runName;
  const connectionGeneration = useRef(0);
  const checkpointRequest = useRef(0);
  const following = useRef(followProject); following.current = followProject;
  const eventReceiver = useRef<(event: ComfyEvent) => void>(() => {});
  const relayListeners = useRef(new Set<(value: unknown) => void>());
  const subscribePreviewRelay: RelaySubscribe = useCallback(listener => {
    relayListeners.current.add(listener); return () => { relayListeners.current.delete(listener); };
  }, []);
  const log = useCallback((text: string) => setEvents(old => [`${new Date().toLocaleTimeString()}  ${text}`, ...old].slice(0, 100)), []);
  const refresh = useCallback(async () => {
    const generation = connectionGeneration.current;
    const result = await Promise.allSettled([
      comfy<Queue>('/queue'), comfy<{ reviews: Review[] }>(`${H3}/reviews`), comfy<{ runs: Run[] }>(`${H3}/runs`),
    ]);
    if (generation !== connectionGeneration.current) return;
    if (result[0].status === 'fulfilled') {
      const queue = result[0].value; setQueue(queue);
      if (following.current && runRef.current) {
        for (const [status, items] of [['Rendering', queue.queue_running], ['Queued', queue.queue_pending]] as const) {
          for (const item of items) {
            const belongs = Object.values(item[2] || {}).some(node => /MiniMaxH3(ChainPlan|ChainPlanStudio|ProjectAssetManager)$/.test(node.class_type) && node.inputs.run_name === runRef.current);
            if (belongs && !tracked.current.has(item[1])) {
              tracked.current.add(item[1]); setJobs(old => [{ id: item[1], status }, ...old]);
            }
          }
        }
      }
    }
    else setError(String(result[0].reason));
    if (result[1].status === 'fulfilled') setReviews(result[1].value.reviews || []);
    else setError(`H3 review API unavailable: ${result[1].reason}`);
    if (result[2].status === 'fulfilled') setRuns(result[2].value.runs || []);
  }, []);
  const refreshCheckpoints = useCallback(async () => {
    const name = runRef.current, branch = branchRef.current, generation = connectionGeneration.current, requestId = ++checkpointRequest.current;
    if (!name) { setCheckpoints([]); setEditorial(null); return; }
    try {
      const result = verifyBranch(await comfy<{ working_branch_id?: string; checkpoints: Checkpoint[]; editorial?: Editorial }>(branchPath(`${H3}/checkpoints?${new URLSearchParams({ run_name: name, include_graph: 'false' })}`, branch)), branch);
      if (requestId === checkpointRequest.current && runRef.current === name && branchRef.current === branch && generation === connectionGeneration.current) { setCheckpointScope(JSON.stringify([name, branch])); setCheckpoints((result.checkpoints || []).map(item => ({ ...item, working_branch_id: branch }))); setEditorial(result.editorial || null); }
    } catch (e) { if (requestId === checkpointRequest.current && runRef.current === name && branchRef.current === branch && generation === connectionGeneration.current) setError(String(e)); }
  }, []);
  const loadHistory = useCallback(async (id: string) => {
    const generation = connectionGeneration.current;
    const history = await comfy<Record<string, { outputs: Record<string, Record<string, unknown>>; status?: { status_str?: string; completed?: boolean; messages?: [string, unknown][] } }>>(`/history/${encodeURIComponent(id)}`);
    if (generation !== connectionGeneration.current) return;
    const item = history[id];
    if (!item) return;
    const files: MediaFile[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') {
        if ('filename' in value && typeof value.filename === 'string') files.push(value as MediaFile);
        else Object.values(value).forEach(visit);
      }
    };
    visit(item.outputs);
    setOutputs(old => [...old, ...files].filter((f, i, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(f)) === i));
    if (item.status?.completed || item.status?.status_str === 'error') setJobs(old => old.map(job => job.id === id ? { ...job, status: item.status?.status_str === 'error' ? 'Failed' : 'Completed', progress: undefined } : job));
  }, []);
  const connect = useCallback(async (url?: string) => {
    const generation = ++connectionGeneration.current;
    setConnecting(true); setConnected(false); setSocketOnline(false); setError('');
    setSchemas({}); setReviews([]); setQueue(emptyQueue); setRuns([]); setCheckpoints([]); setEditorial(null); setOutputs([]); setJobs([]); tracked.current.clear();
    try {
      const config = await request<{ target: string }>('/api/connection', url ? { method: 'PUT', body: JSON.stringify({ target: url }) } : undefined);
      setTarget(config.target);
      const [stats, info] = await Promise.all([
        comfy<{ devices: { name: string }[] }>('/system_stats'), comfy<Schemas>('/object_info'),
      ]);
      if (generation !== connectionGeneration.current) return;
      setSchemas(info); setGpu(stats.devices?.[0]?.name.replace(/^cuda:\d+ /, '').replace(/ :.*$/, '') || 'ComfyUI');
      try {
        const restored = JSON.parse(sessionStorage.getItem(`sceneweaver.jobs:${config.target}`) || '[]') as Job[];
        if (Array.isArray(restored)) {
          const valid = restored.filter(job => typeof job.id === 'string' && typeof job.status === 'string').slice(0, 100);
          setJobs(valid); tracked.current = new Set(valid.map(job => job.id));
        }
      } catch { /* Queue and pending reviews still recover from the server. */ }
      setConnected(true); log('Connected to ComfyUI');
      if (!info.MiniMaxH3ChainPlan) setError('ComfyUI is connected, but the MiniMax H3 Context Loop node pack is missing.');
      await refresh();
    } catch (e) { if (generation === connectionGeneration.current) setError(String(e)); }
    finally { if (generation === connectionGeneration.current) setConnecting(false); }
  }, [log, refresh]);
  useEffect(() => { void connect(); }, [connect]);
  useEffect(() => {
    if (!connected) return;
    try { sessionStorage.setItem(`sceneweaver.jobs:${target}`, JSON.stringify(jobs.slice(0, 100))); } catch { /* Do not interrupt a live render when session storage is full. */ }
  }, [jobs, target, connected]);
  useEffect(() => { setCheckpoints([]); setEditorial(null); if (connected) { void refreshCheckpoints(); if (followProject) void refresh(); } }, [runName, branchId, connected, followProject, refresh, refreshCheckpoints]);
  useEffect(() => {
    if (!connected) return;
    let disposed = false, socket: WebSocket, timer: ReturnType<typeof setTimeout>;
    const open = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/comfy/ws?clientId=${clientId.current}`);
      socket.onopen = () => {
        if (disposed) return;
        setSocketOnline(true); void refresh(); void refreshCheckpoints();
        tracked.current.forEach(id => void loadHistory(id).catch(e => setError(String(e))));
      };
      socket.onclose = () => { if (!disposed) { setSocketOnline(false); timer = setTimeout(open, 3000); } };
      const handle = (message: ComfyEvent) => {
        if (disposed) return;
        const { type, data } = message, id = String(data?.prompt_id || '');
        // PreviewRelay broadcasts by channel, without a prompt or node ID.
        if (type === 'preview_relay') { relayListeners.current.forEach(listener => listener(data)); return; }
        if (type === 'execution_start') void refresh();
        if (type === 'status' || type.startsWith('minimax_h3_context_loop_')) {
          void refresh();
          if (type !== 'status') { void refreshCheckpoints(); log(type.replace('minimax_h3_context_loop_', 'H3 ')); }
        }
        if (!tracked.current.has(id)) return;
        const update = (patch: Partial<Job>) => setJobs(old => old.map(job => job.id === id ? { ...job, ...patch } : job));
        if (type === 'execution_start') { update({ status: 'Rendering' }); log('Render started'); }
        if (type === 'executing') update(data.node ? { node: data.node, progress: undefined } : { status: 'Completed', progress: undefined });
        if (type === 'progress') update({ progress: data.max ? Number(data.value) / data.max : undefined, node: data.node || undefined, status: 'Rendering' });
        if (type === 'execution_error') { update({ status: 'Failed', error: data.exception_message }); setError(data.exception_message || 'ComfyUI execution failed.'); log(`Render failed: ${data.exception_message}`); }
        if (type === 'execution_interrupted') { update({ status: 'Interrupted', progress: undefined }); log('Render interrupted'); }
        if (type === 'execution_success' || (type === 'executing' && data.node === null)) {
          update({ status: 'Completed', progress: undefined });
          void loadHistory(id).catch(e => setError(String(e))); void refreshCheckpoints(); log('Render completed');
        }
      };
      eventReceiver.current = handle;
      socket.onmessage = event => { if (typeof event.data === 'string') { try { handle(parseJSON(event.data) as ComfyEvent); } catch { /* Ignore unsupported binary or malformed events. */ } } };
    };
    open();
    // Reconciliation also recovers reviews addressed to a different ComfyUI client.
    const reconciliation = setInterval(() => { void refresh(); void refreshCheckpoints(); }, 15000);
    return () => { disposed = true; eventReceiver.current = () => {}; clearTimeout(timer); clearInterval(reconciliation); socket?.close(); };
  }, [connected, refresh, refreshCheckpoints, log, loadHistory]);
  const enqueue = async (workflow: Workflow) => {
    const result = await post<{ prompt_id: string }>('/prompt', { prompt: workflow.prompt, client_id: clientId.current, extra_data: { extra_pnginfo: { ...(workflow.source ? { workflow: workflow.source } : {}), sceneweaver: { name: workflow.name, version: 1 } } } });
    tracked.current.add(result.prompt_id);
    setJobs(old => [{ id: result.prompt_id, status: 'Queued' }, ...old]);
    log(`Queued ${workflow.name}`); await refresh();
    // History covers very short jobs that finish before the POST response arrives.
    await loadHistory(result.prompt_id);
    return result.prompt_id;
  };
  const cancelJob = async (id: string) => {
    const current = await comfy<Queue>('/queue');
    const pending = current.queue_pending.some(item => item[1] === id);
    if (pending) await post('/queue', { delete: [id] });
    else if (current.queue_running.some(item => item[1] === id)) {
      // ComfyUI's interrupt endpoint is global. Only enable it for our verified
      // running job, and send its ID for servers with targeted interrupt support.
      if (!tracked.current.has(id)) throw new Error('This render was started by another client. Stop it in ComfyUI.');
      await post('/interrupt', { prompt_id: id });
    }
    setJobs(old => old.map(job => job.id === id ? { ...job, status: pending ? 'Cancelled' : 'Stop requested' } : job));
    await refresh();
  };
  const receiveEvent = useCallback((event: ComfyEvent) => eventReceiver.current(event), []);
  return { target, connected, connecting, socketOnline, schemas, gpu, error, setError, queue, reviews, runs, checkpoints: checkpointScope === JSON.stringify([runName, branchId]) ? checkpoints : [], editorial: checkpointScope === JSON.stringify([runName, branchId]) ? editorial : null, outputs, jobs, events, connect, refresh, refreshCheckpoints, enqueue, cancelJob, log, receiveEvent, subscribePreviewRelay };
}
