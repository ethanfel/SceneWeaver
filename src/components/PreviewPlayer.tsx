import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Clapperboard, Maximize, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { PlaybackSegment, PreviewMedia, SubtitleCue } from '../types';
import { timecode } from '../lib/h3';
import { subtitleAt } from '../lib/playback';

type Props = {
  media: PreviewMedia; videoRef: RefObject<HTMLVideoElement | null>; segment?: PlaybackSegment;
  sourceUrl: string; sourceSeek: number; cues: SubtitleCue[]; subtitleOffset: number; captionsDefault: boolean;
  previous?: () => void; next?: () => void; onTime: (seconds: number) => void; report: (message: string) => void;
  attach: () => void; hasScene: boolean;
};
export function PreviewPlayer({ media, videoRef, segment, sourceUrl, sourceSeek, cues, subtitleOffset, captionsDefault, previous, next, onTime, report, attach, hasScene }: Props) {
  const generated = useRef<HTMLAudioElement>(null), soundtrack = useRef<HTMLAudioElement>(null), surface = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0);
  const [generatedOn, setGeneratedOn] = useState(true), [sourceOn, setSourceOn] = useState(true), [volume, setVolume] = useState(1), [muted, setMuted] = useState(false);
  const [captionOverride, setCaptionOverride] = useState<boolean | null>(null), [audioError, setAudioError] = useState('');
  const image = media.kind === 'image' || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(media.name);
  const audio = media.kind === 'audio' || /\.(wav|mp3|flac|ogg|m4a)(\?|$)/i.test(media.name);
  const playableVideo = Boolean(media.url && !image && !audio);
  const source = segment ? sourceUrl : '';
  const limit = Math.min(duration || Infinity, segment?.duration || Infinity);
  const usableDuration = Number.isFinite(limit) ? limit : 0;
  const captionsOn = captionOverride ?? captionsDefault;
  const caption = captionsOn && segment ? subtitleAt(cues, segment.start + time, subtitleOffset) : '';
  const pauseAudio = () => { generated.current?.pause(); soundtrack.current?.pause(); };
  const sync = (shouldPlay: boolean, seconds = videoRef.current?.currentTime || 0) => {
    const video = videoRef.current;
    const playTrack = (element: HTMLAudioElement | null, enabled: boolean, target: number, label: string) => {
      if (!element) return;
      element.volume = volume; element.muted = muted || !enabled; element.playbackRate = video?.playbackRate || 1;
      if (Math.abs(element.currentTime - target) > .12) { try { element.currentTime = target; } catch { /* Seek again after metadata loads. */ } }
      if (shouldPlay && enabled && target < (Number.isFinite(element.duration) ? element.duration : Infinity)) {
        if (element.paused) void element.play().catch(error => { if (element.isConnected && error.name !== 'AbortError') setAudioError(`${label} could not start. Press Play again to enable browser audio.`); });
      } else if (!shouldPlay || !enabled) element.pause();
    };
    if (video) { video.volume = volume; video.muted = muted || !generatedOn || Boolean(media.audioUrl); }
    if (media.audioUrl) playTrack(generated.current, generatedOn, seconds, 'Generated audio');
    if (source && segment) playTrack(soundtrack.current, sourceOn, Math.max(0, sourceSeek) + segment.start + seconds, 'Source soundtrack');
  };
  const update = (seconds: number) => {
    const bounded = Math.max(0, Math.min(seconds, usableDuration || seconds)); setTime(bounded); onTime(bounded); sync(Boolean(videoRef.current && !videoRef.current.paused), bounded);
    if (usableDuration && seconds >= usableDuration && videoRef.current && !videoRef.current.paused) { videoRef.current.pause(); pauseAudio(); }
  };
  const seek = (seconds: number) => { if (videoRef.current) { videoRef.current.currentTime = Math.max(0, Math.min(usableDuration, seconds)); update(videoRef.current.currentTime); } };
  const toggle = () => {
    const video = videoRef.current; if (!video) return;
    if (!video.paused) { video.pause(); pauseAudio(); return; }
    setAudioError(''); if (usableDuration && video.currentTime >= usableDuration - .01) seek(0);
    sync(true); void video.play().catch(error => { if (videoRef.current === video && error.name !== 'AbortError') { pauseAudio(); report('The preview could not start. Check its media format or try the generated take.'); } });
  };
  useEffect(() => {
    setTime(0); setDuration(0); setPlaying(false); setAudioError(''); onTime(0);
    const sidecar = generated.current, track = soundtrack.current;
    return () => { sidecar?.pause(); track?.pause(); };
  }, [media.url]);
  useEffect(() => { sync(playing); }, [generatedOn, sourceOn, volume, muted]);
  useEffect(() => { if (videoRef.current && playableVideo) sync(playing); }, [segment?.start, sourceSeek]);
  return <>
    <div className="viewer-canvas" ref={surface}><div className="viewer-overlay"><span>{segment ? `SCENE ${String(segment.index + 1).padStart(2, '0')}` : 'SOURCE VIEWER'}</span><span>{media.url ? 'PREVIEW' : 'AWAITING RENDER'}</span></div>
      {media.url ? image ? <img src={media.url} alt={media.name}/> : audio ? <audio key={media.url} src={media.url} controls/> : <video key={media.url} ref={videoRef} src={media.url} preload="metadata" playsInline
        onLoadedMetadata={e => { setDuration(e.currentTarget.duration); sync(false); }}
        onTimeUpdate={e => update(e.currentTarget.currentTime)} onSeeking={e => sync(!e.currentTarget.paused, e.currentTarget.currentTime)}
        onPlay={() => { setPlaying(true); sync(true); }} onPause={() => { setPlaying(false); pauseAudio(); }} onEnded={() => { setPlaying(false); pauseAudio(); }}
        onWaiting={pauseAudio} onPlaying={() => sync(true)} onRateChange={() => sync(playing)}
        onError={() => report('This video could not be played. Try another take or download the clip.')} onClick={toggle}/>
        : <div className="viewer-empty"><div className="frame-corners"><Clapperboard size={43} strokeWidth={1}/></div><h2>{hasScene ? media.name.replaceAll('_', ' ') : 'Your ComfyUI production'}</h2><p>{hasScene ? 'No saved video for this scene yet.' : 'Attach your open workflow to see its sequence and project.'}</p>{!hasScene && <button onClick={attach}>Attach live workflow</button>}</div>}
      {playableVideo && media.audioUrl && <audio data-testid="generated-audio" ref={generated} key={media.audioUrl} src={media.audioUrl} preload="metadata" onLoadedMetadata={() => sync(Boolean(videoRef.current && !videoRef.current.paused))} onError={() => setAudioError('The generated audio file could not be played.')} hidden/>}
      {playableVideo && source && <audio data-testid="source-audio" ref={soundtrack} key={source} src={source} preload="metadata" onLoadedMetadata={() => sync(Boolean(videoRef.current && !videoRef.current.paused))} onError={() => setAudioError('The source soundtrack could not be played. Refresh Plan Studio’s presentation in ComfyUI.')} hidden/>}
      {caption && <div className="subtitle-overlay" data-testid="subtitle-overlay">{caption}</div>}
      <span className="viewer-name">{media.name.replaceAll('_', ' ')}</span>
    </div>
    <div className="transport"><span className="timecode" title="Clip position">{timecode(time)}</span><div><button className="icon-button" disabled={!previous} onClick={previous} aria-label="Previous scene"><SkipBack size={16}/></button><button className="icon-button" disabled={!playableVideo} onClick={() => seek(time - 1 / 24)} aria-label="Previous frame"><ChevronLeft size={17}/></button><button className="play-button" disabled={!playableVideo} aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={toggle}>{playing ? <Pause size={17}/> : <Play size={17} fill="currentColor"/>}</button><button className="icon-button" disabled={!playableVideo} onClick={() => seek(time + 1 / 24)} aria-label="Next frame"><ChevronRight size={17}/></button><button className="icon-button" disabled={!next} onClick={next} aria-label="Next scene"><SkipForward size={16}/></button></div><div><span className="muted timecode">{timecode(usableDuration)}</span><button className="icon-button" disabled={!media.url} onClick={() => void surface.current?.requestFullscreen().catch(e => report(String(e)))} aria-label="Fullscreen preview"><Maximize size={14}/></button></div></div>
    <input className="viewer-scrubber" aria-label="Seek preview" type="range" min="0" max={usableDuration} step={1 / 24} value={Math.min(time, usableDuration)} disabled={!playableVideo} onChange={e => seek(Number(e.target.value))}/>
    <div className="audio-controls"><button className="icon-button" disabled={!playableVideo} aria-label={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => setMuted(v => !v)}>{muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button><input aria-label="Preview volume" type="range" min="0" max="1" step=".05" value={volume} disabled={!playableVideo} onChange={e => setVolume(Number(e.target.value))}/><label><input type="checkbox" checked={generatedOn} disabled={!playableVideo} onChange={e => setGeneratedOn(e.target.checked)}/>Generated audio</label><label title={source ? 'H3 source soundtrack at the editorial timeline position' : 'No saved Plan Studio soundtrack for this preview'}><input type="checkbox" checked={sourceOn && Boolean(source)} disabled={!playableVideo || !source} onChange={e => setSourceOn(e.target.checked)}/>Source soundtrack</label><button aria-label="Toggle subtitles" aria-pressed={captionsOn && cues.length > 0} disabled={!segment || !cues.length} onClick={() => setCaptionOverride(!captionsOn)}>CC</button>{segment && <span className="timeline-clock">Sequence {timecode(segment.start + time)}</span>}</div>
    {audioError && <p className="playback-notice" role="alert">{audioError}</p>}
  </>;
}
