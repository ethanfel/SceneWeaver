import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Radio, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { usePreviewRelay } from '../hooks/usePreviewRelay';
import type { RelayPreview, RelaySubscribe } from '../lib/previewRelay';

const repository = 'https://github.com/drozbay/ComfyUI-PreviewRelay';
function SamplingMedia({ media }: { media: RelayPreview }) {
  const video = useRef<HTMLVideoElement>(null), audio = useRef<HTMLAudioElement>(null);
  const [audible, setAudible] = useState(false), [error, setError] = useState('');
  const movingPicture = media.mime.startsWith('video/');
  const syncAudio = () => {
    const track = audio.current; if (!track) return;
    if (video.current && Number.isFinite(track.duration) && track.duration > 0) {
      const target = video.current.currentTime % track.duration;
      if (Math.abs(track.currentTime - target) > .15) track.currentTime = target;
    }
    track.muted = !audible;
    if (audible && (!video.current || !video.current.paused && video.current.readyState >= 2)) {
      if (track.paused) void track.play().catch(error => {
        if (audio.current === track && track.isConnected && error.name !== 'AbortError') { setAudible(false); setError('Press Enable sample audio to allow browser playback.'); }
      });
    } else track.pause();
  };
  useEffect(() => {
    setError('');
    const picture = video.current, track = audio.current;
    if (picture) void picture.play().catch(error => {
      if (video.current === picture && picture.isConnected && error.name !== 'AbortError') setError('The sample video could not start. Use its play control or open PreviewRelay.');
    });
    syncAudio(); return () => { picture?.pause(); track?.pause(); };
  }, [media.url, media.audioUrl]);
  useEffect(syncAudio, [audible]);
  return <>
    <div className="generation-stage" data-testid="relay-stage">
      {movingPicture ? <video key={media.url} ref={video} src={media.url} muted autoPlay playsInline loop controls onTimeUpdate={syncAudio} onPlaying={syncAudio} onPause={() => audio.current?.pause()} onWaiting={() => audio.current?.pause()} onError={() => setError('This sample video could not be decoded by the browser.')}/>
        : <img key={media.url} src={media.url} alt={`Generation sample at step ${media.step}`} onError={() => setError('This sample image could not be decoded by the browser.')}/>}
      {media.audioUrl && <audio ref={audio} key={media.audioUrl} src={media.audioUrl} loop preload="metadata" onLoadedMetadata={syncAudio} onError={() => setError('This sample audio could not be decoded by the browser.')} data-testid="relay-audio" hidden/>}
      <span className="generation-sample-label">Latest sample · step {media.step}</span>
    </div>
    <div className="generation-audio"><button disabled={!media.audioUrl} aria-label={audible ? 'Mute sample audio' : 'Enable sample audio'} onClick={() => { setError(''); setAudible(value => !value); }}>{audible ? <Volume2 size={14}/> : <VolumeX size={14}/>}Sample audio</button><span>{!media.audioUrl ? 'No decoded audio in this sample' : movingPicture ? 'Audio follows the sample video' : 'Audio loops independently of animated images'}</span></div>
    {error && <p className="playback-notice" role="alert">{error}</p>}
  </>;
}
export function GenerationPanel({ installed, connected, online, channels, subscribe, target, reconnect, pausedReason = '' }: {
  installed: boolean; connected: boolean; online: boolean; channels: string[]; subscribe: RelaySubscribe; target: string; reconnect: () => void; pausedReason?: string;
}) {
  const [channel, setChannel] = useState(channels[0] || 'main'), [draft, setDraft] = useState(channels[0] || 'main');
  const manual = useRef(false), discovered = channels[0];
  useEffect(() => { if (!manual.current && discovered !== undefined) { setChannel(discovered); setDraft(discovered); } }, [discovered]);
  const relay = usePreviewRelay(channel, connected && installed, online && !pausedReason, subscribe);
  const nativeUrl = `${target}/preview_relay?${new URLSearchParams({ channel })}`;
  const ms = (value?: number) => value === undefined ? '—' : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
  if (!connected || !installed) return <div className="generation-panel"><div className="generation-setup"><Radio size={30} strokeWidth={1}/><h2>Preview generation as it samples</h2><p>{!connected ? 'Connect SceneWeaver to ComfyUI to check for PreviewRelay.' : 'PreviewRelay is not installed on the connected ComfyUI server.'}</p><ol><li>Install <a href={repository} target="_blank" rel="noreferrer">ComfyUI-PreviewRelay</a> in the container’s persistent <code>custom_nodes</code> directory, then restart ComfyUI when your current render is finished.</li><li>In ComfyUI, insert <strong>Preview Relay</strong> on the model connection used by the sampler. Give it a channel unique to this workflow.</li><li>Start a generation and select that channel here. Connect a compatible audio VAE to the relay if you want sampling audio.</li></ol><button onClick={reconnect}><RefreshCw size={14}/>Check installation</button><p className="hint">PreviewRelay is experimental. Configure preview decoding in its native node; its cost depends on the VAE, resolution, and decoded steps.</p></div></div>;
  return <div className="generation-panel">
    <form className="relay-channel" onSubmit={event => { event.preventDefault(); if (draft.trim()) { manual.current = true; if (draft === channel) relay.refresh(); else setChannel(draft); } }}><label>Channel<input aria-label="PreviewRelay channel" list="relay-channels" value={draft} onChange={event => setDraft(event.target.value)} maxLength={256}/></label><datalist id="relay-channels">{channels.map(value => <option key={value} value={value}/>)}</datalist><button type="submit" disabled={!draft.trim()}>Watch</button><button type="button" className="icon-button" aria-label="Refresh generation preview" onClick={relay.refresh}><RefreshCw size={14}/></button><a href={nativeUrl} target="_blank" rel="noreferrer" className="button" title="Open PreviewRelay’s native viewer and decoding controls">Open PreviewRelay<ArrowUpRight size={13}/></a></form>
    <div className="generation-status"><span className={`status-dot ${online && !pausedReason ? 'green' : ''}`}/><span role="status">{pausedReason || (!online ? 'Preview disconnected · reconnecting' : relay.loading ? 'Reading channel state…' : `Listening on ${channel}`)}</span><span>Channel feed</span></div>
    {relay.error && <p className="playback-notice" role="alert">{relay.error} Use Refresh to retry.</p>}
    {relay.media ? <SamplingMedia key={channel} media={relay.media}/> : <div className="generation-stage generation-waiting"><Radio size={34} strokeWidth={1}/><h3>{pausedReason ? 'Preview paused' : online ? 'Waiting for a sampling preview' : 'Preview connection interrupted'}</h3><p>Connect Preview Relay to the sampler’s model path and use channel <strong>{channel}</strong>.</p></div>}
    <div className="generation-stats"><div><small>Sampling step</small><strong>{relay.stats?.step ?? '—'} / {relay.stats?.total ?? '—'}</strong></div><div><small>Average step</small><strong>{ms(relay.stats?.avg_step_ms)}</strong></div><div><small>Preview decode</small><strong>{ms(relay.stats?.preview_ms)}</strong></div><div><small>Sample size</small><strong>{relay.stats?.w && relay.stats?.h ? `${relay.stats.w} × ${relay.stats.h}` : '—'}</strong></div></div>
    <p className="generation-note">Channels are shared across this ComfyUI server. Use a unique channel for this workflow. Samples are previews of the selected channel; they are not assigned to a scene or saved as a take.</p>
  </div>;
}
