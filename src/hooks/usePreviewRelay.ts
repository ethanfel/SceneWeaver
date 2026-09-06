import { useCallback, useEffect, useState } from 'react';
import { comfy } from '../lib/api';
import { decodeRelayMedia, relayEvent, type RelayEvent, type RelayPreview, type RelaySubscribe } from '../lib/previewRelay';

export function usePreviewRelay(channel: string, enabled: boolean, online: boolean, subscribe: RelaySubscribe) {
  const [media, setMedia] = useState<RelayPreview | null>(null), [stats, setStats] = useState<RelayEvent | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    setMedia(null); setStats(null); setError(''); setLoading(false);
    if (!enabled || !online) return;
    const lifetime = new AbortController(), query = new URLSearchParams({ channel }).toString();
    let disposed = false, fetching = false, wanted = 0, applied = 0, epoch = 0, eventSerial = 0;
    let preview: RelayPreview | null = null, download: AbortController | null = null, force = false;
    const release = () => { if (preview) { URL.revokeObjectURL(preview.url); if (preview.audioUrl) URL.revokeObjectURL(preview.audioUrl); preview = null; } };
    const clear = () => { epoch++; wanted = 0; applied = 0; force = false; download?.abort(); release(); setMedia(null); setStats(null); setError(''); };
    // Only one media transfer at a time. New notifications collapse into the latest seq.
    const pump = async () => {
      if (fetching || disposed) return;
      fetching = true;
      try {
        while (!disposed && (force || wanted > applied)) {
          const requested = wanted, started = epoch; force = false;
          download = new AbortController();
          try {
            const value = await comfy<unknown>(`/preview_relay/media?${query}`, { cache: 'no-store', signal: AbortSignal.any([lifetime.signal, download.signal, AbortSignal.timeout(30000)]) });
            if (disposed || started !== epoch) continue;
            const decoded = decodeRelayMedia(value);
            if (decoded && decoded.seq > applied) {
              const next = { seq: decoded.seq, step: decoded.step, mime: decoded.mime, url: URL.createObjectURL(decoded.picture), audioUrl: decoded.audio ? URL.createObjectURL(decoded.audio) : undefined };
              release(); preview = next; setMedia(next); setError('');
            }
            applied = Math.max(applied, requested, decoded?.seq || 0);
          } catch (e) {
            if (disposed) break;
            if (started !== epoch) continue;
            setError(String(e).replace(/^Error: /, '')); break;
          }
        }
      } finally { fetching = false; }
    };
    const accept = (value: unknown) => {
      const data = relayEvent(value); if (!data || data.channel !== channel) return;
      eventSerial++;
      if (data.reset) clear();
      if (data.step !== undefined) setStats(old => ({ ...old, ...data }));
      if (data.media_seq !== undefined) { wanted = Math.max(wanted, data.media_seq); void pump(); }
    };
    const unsubscribe = subscribe(accept);
    setLoading(true);
    const before = eventSerial;
    void comfy<{ boundaries?: unknown[]; steps?: unknown[] }>(`/preview_relay/state?${query}`, { cache: 'no-store', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(30000)]) }).then(state => {
      if (disposed || eventSerial !== before) return;
      const boundaries = Array.isArray(state.boundaries) ? state.boundaries : [], steps = Array.isArray(state.steps) ? state.steps : [];
      for (const value of [...boundaries, ...steps]) accept(value);
      // A reset retains old media upstream. Wait for a new sample instead of
      // attributing the previous run's picture to a run that has no steps yet.
      if (steps.length) { force = true; void pump(); }
    }).catch(e => { if (!disposed) setError(`PreviewRelay could not be reached: ${String(e).replace(/^Error: /, '')}`); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; unsubscribe(); lifetime.abort(); download?.abort(); release(); };
  }, [channel, enabled, online, subscribe, revision]);
  return { media, stats, error, loading, refresh };
}
