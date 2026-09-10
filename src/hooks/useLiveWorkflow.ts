import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandReceipt, ComfyEvent, LiveResult, LiveSnapshot } from '../types';
const PROTOCOL = 'sceneweaver.live.v1';
const reads = new Set(['asset-library-source', 'asset-library-copy-preview', 'asset-library-inspect', 'prompt-history-list', 'prompt-history-revision', 'snapshot', 'export', 'focus', 'prompt-tools', 'plan-edit', 'checkpoint-preview', 'delivery-preview', 'editorial-inspect', 'editorial-preview', 'command-status']);

export function useLiveWorkflow(target: string, connected: boolean) {
  const [params] = useState(() => new URLSearchParams(location.hash.slice(1)));
  const session = params.get('sceneweaver_session') || '', origin = params.get('comfy_origin') || '';
  const requested = Boolean(session && origin);
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [status, setStatus] = useState<'waiting' | 'attached' | 'disconnected'>('waiting');
  const [error, setError] = useState('');
  const [receipts, setReceipts] = useState<CommandReceipt[]>([]);
  const updateReceipt = useCallback((receipt: CommandReceipt) => {
    if (!receipt?.id || !receipt.action || !receipt.binding) return;
    setReceipts(current => [...current.filter(item => item.id !== receipt.id), receipt].sort((a, b) => b.startedAt - a.startedAt).slice(0, 100));
  }, []);
  const lastSeen = useRef(0), current = useRef(snapshot); current.current = snapshot;
  const pending = useRef(new Map<string, { resolve: (result: LiveResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; receipt: CommandReceipt }>());
  const onExecution = useRef<(event: ComfyEvent) => void>(() => {});
  useEffect(() => {
    if (!requested) return;
    if (!connected) { setStatus('disconnected'); return; }
    lastSeen.current = 0;
    if (origin !== new URL(target).origin) { setError('The ComfyUI tab does not match the connected server. Select its server address before attaching.'); setStatus('disconnected'); return; }
    if (!window.opener) { setError('Open SceneWeaver from the ComfyUI tab to establish a live link.'); setStatus('disconnected'); return; }
    setError('');
    const opener = window.opener;
    const send = () => opener.postMessage({ protocol: PROTOCOL, session, kind: 'hello' }, origin);
    const receive = (event: MessageEvent) => {
      if (event.source !== opener || event.origin !== origin || event.data?.protocol !== PROTOCOL || event.data.session !== session) return;
      lastSeen.current = Date.now(); setStatus('attached');
      const message = event.data;
      if (message.kind === 'snapshot' && message.snapshot?.binding && message.snapshot.nodes) { setSnapshot(message.snapshot); setError(''); }
      if (message.kind === 'unavailable') { setError(message.error); setStatus('disconnected'); }
      if (message.kind === 'execution') onExecution.current(message.event);
      if (message.kind === 'receipt') updateReceipt(message.receipt);
      if (message.kind === 'receipts' && Array.isArray(message.receipts)) message.receipts.forEach(updateReceipt);
      if (message.kind === 'result') {
        if (message.receipt) updateReceipt(message.receipt);
        const request = pending.current.get(message.id); if (!request) return;
        pending.current.delete(message.id); clearTimeout(request.timer);
        if (message.error) {
          if (!message.receipt && !reads.has(request.receipt.action)) updateReceipt({ ...request.receipt, status: message.outcome === 'rejected' ? 'rejected' : 'uncertain', finishedAt: Date.now(), message: message.error });
          request.reject(new Error(message.error));
        } else {
          if (!message.receipt && !reads.has(request.receipt.action)) updateReceipt({ ...request.receipt, status: message.result?.warning ? 'partial' : 'succeeded', finishedAt: Date.now(), message: message.result?.warning || '' });
          if (request.receipt.action === 'command-status') {
            if (message.result?.data) updateReceipt(message.result.data);
            else { request.reject(new Error('The parent tab has no retained receipt for this action. Check the workflow and H3 job state before submitting new work.')); return; }
          }
          if (message.result?.snapshot) setSnapshot(message.result.snapshot);
          request.resolve(message.result || {});
        }
      }
    };
    window.addEventListener('message', receive); send();
    const heartbeat = setInterval(() => {
      if (opener.closed || lastSeen.current && Date.now() - lastSeen.current > 30000) setStatus('disconnected');
      else if (!lastSeen.current) send();
    }, 3000);
    const focus = () => { if (!opener.closed) send(); }; window.addEventListener('focus', focus);
    return () => {
      clearInterval(heartbeat); window.removeEventListener('message', receive); window.removeEventListener('focus', focus);
      pending.current.forEach(request => {
        clearTimeout(request.timer);
        if (!reads.has(request.receipt.action)) setReceipts(current => current.map(item => item.id === request.receipt.id && ['pending', 'running'].includes(item.status) ? { ...item, status: 'uncertain', message: 'The live connection changed before the result arrived.' } : item));
        request.reject(new Error('The live connection changed. Check the action receipt after reconnecting.'));
      }); pending.current.clear();
    };
  }, [requested, target, connected, origin, session, updateReceipt]);
  const command = useCallback((action: string, options: Record<string, unknown> = {}, base = current.current): Promise<LiveResult> => {
    if (!base || status !== 'attached' || !window.opener || window.opener.closed) return Promise.reject(new Error('The ComfyUI tab is not connected. Your draft is preserved.'));
    const id = crypto.randomUUID();
    const receipt: CommandReceipt = { id, action, binding: base.binding, revision: base.revision, project: String(options.project || ''), plan: String(options.plan || ''), branch: String(options.branch_id || ''), status: 'pending', startedAt: Date.now() };
    if (!reads.has(action)) updateReceipt(receipt);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(id);
        if (!reads.has(action)) setReceipts(current => current.map(item => item.id === id && ['pending', 'running'].includes(item.status) ? { ...item, status: 'uncertain', message: 'The action timed out. Check its receipt before submitting new work.' } : item));
        reject(new Error('ComfyUI did not return this action’s result. Check its receipt and refresh the workflow before submitting new work.'));
      }, ['asset-upload', 'delivery-preview', 'editorial-inspect', 'editorial-preview'].includes(action) ? 300000 : 30000);
      pending.current.set(id, { resolve, reject, timer, receipt });
      try { window.opener.postMessage({ protocol: PROTOCOL, session, kind: 'command', id, command: { ...options, action, binding: base.binding, revision: base.revision } }, origin); }
      catch (error) {
        clearTimeout(timer); pending.current.delete(id);
        if (!reads.has(action)) updateReceipt({ ...receipt, status: 'rejected', finishedAt: Date.now(), message: 'The browser could not send this action.' });
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }, [origin, session, status, updateReceipt]);
  return { requested, snapshot, status, error, command, onExecution, receipts };
}
