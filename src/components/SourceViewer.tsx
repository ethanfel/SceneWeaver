import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Film, Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { PreviewMedia } from '../types';
import { timecode } from '../lib/h3';
export type SourceControls = { pause: () => void };

export function SourceViewer({ media, active, context, controls, onPlay }: { media: PreviewMedia | null; active: boolean; context: string; controls: RefObject<SourceControls | null>; onPlay: () => void }) {
  const primary = useRef<HTMLMediaElement | null>(null), sidecar = useRef<HTMLAudioElement>(null), surface = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false), [position, setPosition] = useState(0), [duration, setDuration] = useState(0), [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [error, setError] = useState('');
  const image = media?.kind === 'image' || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(media?.name || '');
  const audio = media?.kind === 'audio' || /\.(wav|mp3|flac|ogg|m4a)(\?|$)/i.test(media?.name || '');
  const stop = () => { primary.current?.pause(); sidecar.current?.pause(); setPlaying(false); };
  const sync = (play = false) => {
    const element = primary.current, track = sidecar.current; if (!element) return;
    element.volume = volume; element.muted = muted || Boolean(track);
    if (!track) return;
    track.volume = volume; track.muted = muted;
    try { if (Math.abs(track.currentTime - element.currentTime) > .12) track.currentTime = element.currentTime; } catch { /* Retry after audio metadata arrives. */ }
    if (play && track.paused && element.currentTime < (track.duration || Infinity)) void track.play().catch(e => { if (sidecar.current === track && track.isConnected && e.name !== 'AbortError') setError('The source audio could not start. Press Play again.'); });
    else if (!play) track.pause();
  };
  useImperativeHandle(controls, () => ({ pause: stop }));
  useLayoutEffect(() => { stop(); setPosition(0); setDuration(0); setError(''); }, [media?.url, media?.audioUrl]);
  useLayoutEffect(() => { if (!active) stop(); }, [active]);
  useLayoutEffect(stop, [context]);
  useEffect(() => { sync(playing); }, [volume, muted]);
  useEffect(() => { const element = primary.current, track = sidecar.current; return () => { element?.pause(); track?.pause(); }; }, [media?.url, media?.audioUrl, active]);
  const toggle = () => {
    const element = primary.current; if (!element || !active) return;
    if (!element.paused) { stop(); return; }
    onPlay(); setError(''); if (element.ended) element.currentTime = 0;
    void element.play().catch(e => { if (primary.current === element && element.isConnected && e.name !== 'AbortError') setError('This source could not start. Check its format or download it.'); });
  };
  const events = {
    onLoadedMetadata: () => { setDuration(Number.isFinite(primary.current?.duration) ? primary.current!.duration : 0); if (primary.current) primary.current.currentTime = Math.min(position, primary.current.duration || position); sync(); },
    onPlay: () => { onPlay(); setPlaying(true); sync(true); }, onPause: () => { sidecar.current?.pause(); setPlaying(false); },
    onTimeUpdate: () => { setPosition(primary.current?.currentTime || 0); sync(!primary.current?.paused); },
    onSeeking: () => sidecar.current?.pause(), onSeeked: () => sync(!primary.current?.paused),
    onWaiting: () => sidecar.current?.pause(), onPlaying: () => sync(true), onEnded: stop,
    onError: () => { stop(); setError('The source could not be loaded. Try another take or download the file.'); },
  };
  return <section className="source-viewer" aria-label="Source viewer"><header><strong>Source</strong><span>{media?.scene ? `Scene ${media.scene}` : 'Media preview'}</span></header>
    <div className="source-canvas" ref={surface}>{active && media?.url ? image ? <img src={media.url} alt={media.name}/> : audio ? <><div className="source-placeholder"><Volume2 size={36}/><p>{media.name}</p></div><audio ref={element => { primary.current = element; }} src={media.url} preload="metadata" {...events}/></> : <video ref={element => { primary.current = element; }} src={media.url} playsInline preload="metadata" onClick={toggle} {...events}/> : <div className="source-placeholder"><Film size={36}/><p>Select a media asset or take to preview its source.</p></div>}{active && media?.audioUrl && !image && <audio hidden ref={sidecar} src={media.audioUrl} preload="metadata" onLoadedMetadata={() => sync(playing)}/>}</div>
    <div className="source-transport"><span className="timecode">{timecode(position)}</span><button disabled={!media || image || !active} aria-label={playing ? 'Pause source' : 'Play source'} onClick={toggle}>{playing ? <Pause size={16}/> : <Play size={16}/>}</button><span className="timecode">{timecode(duration)}</span><button className="icon-button" aria-label="Fullscreen source" disabled={!media} onClick={() => void surface.current?.requestFullscreen().catch(e => setError(String(e)))}><Maximize size={14}/></button></div>
    <input aria-label="Seek source" type="range" min={0} max={duration} step={1 / 24} value={Math.min(position, duration)} disabled={!duration || image} onChange={e => { const value = Number(e.target.value); if (primary.current) primary.current.currentTime = value; setPosition(value); sync(playing); }}/>
    <div className="source-monitor"><button className="icon-button" aria-label={muted ? 'Unmute source' : 'Mute source'} onClick={() => setMuted(value => !value)}>{muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button><input type="range" aria-label="Source volume" min={0} max={1} step={.05} value={volume} onChange={e => setVolume(Number(e.target.value))}/><span>Preview only</span></div>
    <p className="source-name" title={media?.name}>{media?.name || 'No source selected'}</p>{error && <p role="alert" className="playback-notice">{error}</p>}
  </section>;
}
