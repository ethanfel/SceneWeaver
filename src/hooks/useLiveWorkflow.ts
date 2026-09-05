import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComfyEvent, LiveResult, LiveSnapshot } from '../types';
const PROTOCOL = 'sceneweaver.live.v1';

export function useLiveWorkflow(target: string, connected: boolean) {
  const [params] = useState(() => new URLSearchParams(location.hash.slice(1)));
  const session = params.get('sceneweaver_session') || '', origin = params.get('comfy_origin') || '';
  const requested = Boolean(session && origin);
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [status, setStatus] = useState<'waiting' | 'attached' | 'disconnected'>('waiting');
  const [error, setError] = useState('');
  const lastSeen = useRef(0), current = useRef(snapshot); current.current = snapshot;
  const pending = useRef(new Map<string, { resolve: (result: LiveResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>());
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
      if (message.kind === 'snapshot' && message.snapshot?.binding && message.snapshot.nodes) setSnapshot(message.snapshot);
      if (message.kind === 'unavailable') { setError(message.error); setStatus('disconnected'); }
      if (message.kind === 'execution') onExecution.current(message.event);
      if (message.kind === 'result') {
        const request = pending.current.get(message.id); if (!request) return;
        pending.current.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error));
        else { if (message.result?.snapshot) setSnapshot(message.result.snapshot); request.resolve(message.result || {}); }
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
      pending.current.forEach(request => { clearTimeout(request.timer); request.reject(new Error('The live connection changed.')); }); pending.current.clear();
    };
  }, [requested, target, connected, origin, session]);
  const command = useCallback((action: string, options: Record<string, unknown> = {}, base = current.current): Promise<LiveResult> => {
    if (!base || status !== 'attached' || !window.opener || window.opener.closed) return Promise.reject(new Error('The ComfyUI tab is not connected. Your draft is preserved.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.current.delete(id); reject(new Error('ComfyUI did not acknowledge this action. Refresh to check its result before retrying.')); }, action === 'asset-upload' ? 300000 : 30000);
      pending.current.set(id, { resolve, reject, timer });
      window.opener.postMessage({ protocol: PROTOCOL, session, kind: 'command', id, command: { ...options, action, binding: base.binding, revision: base.revision } }, origin);
    });
  }, [origin, session, status]);
  return { requested, snapshot, status, error, command, onExecution };
}
