import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Clapperboard, Maximize, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { PlaybackSegment, PreviewMedia, SubtitleCue } from '../types';
import { timecode } from '../lib/h3';
import { sequenceDuration, sequenceSpan, subtitleAt, type SequenceEntry } from '../lib/playback';

export type PlayerControls = { toggle: () => void; seekSequence: (seconds: number) => void };
type Props = {
  media: PreviewMedia; segment?: PlaybackSegment; entries: SequenceEntry[];
  controls: RefObject<PlayerControls | null>; selectionKey: number; isolated: boolean;
  sourceUrl: string; sourceSeek: number; cues: SubtitleCue[]; subtitleOffset: number; captionsDefault: boolean;
  previous?: () => void; next?: () => void; onTime: (seconds: number) => void; onScene: (index: number) => void;
  report: (message: string) => void; attach: () => void; hasScene: boolean;
};
export function PreviewPlayer({ media, segment, entries, controls, selectionKey, isolated, sourceUrl, sourceSeek, cues, subtitleOffset, captionsDefault, previous, next, onTime, onScene, report, attach, hasScene }: Props) {
  const video = useRef<HTMLVideoElement>(null), generated = useRef<HTMLAudioElement>(null), soundtrack = useRef<HTMLAudioElement>(null), surface = useRef<HTMLDivElement>(null);
  const [sequence, setSequence] = useState(!isolated && Boolean(segment));
  const [clip, setClip] = useState({ media, segment });
  const [playing, setPlaying] = useState(false), [position, setPosition] = useState(segment?.start || 0), [duration, setDuration] = useState(0);
  const intent = useRef(false), cursor = useRef(position), exhausted = useRef(false), buffering = useRef(false);
  const [generatedOn, setGeneratedOn] = useState(true), [sourceOn, setSourceOn] = useState(true), [volume, setVolume] = useState(1), [muted, setMuted] = useState(false);
  const [captionOverride, setCaptionOverride] = useState<boolean | null>(null), [audioError, setAudioError] = useState('');
  const total = sequenceDuration(entries), span = sequence ? sequenceSpan(entries, position) : undefined;
  const active = sequence ? span?.entry : clip.segment;
  const shown = sequence ? span?.entry?.media || { url: '', name: 'Timeline gap' } : clip.media;
  const image = shown.kind === 'image' || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(shown.name);
  const audio = shown.kind === 'audio' || /\.(wav|mp3|flac|ogg|m4a)(\?|$)/i.test(shown.name);
  const playableVideo = Boolean(shown.url && !image && !audio), canPlay = sequence ? total > 0 : playableVideo;
  const source = sequence || active ? sourceUrl : '';
  const clipLimit = Math.min(duration || Infinity, active?.duration || Infinity);
  const usableDuration = sequence ? total : Number.isFinite(clipLimit) ? clipLimit : 0;
  const localTime = sequence ? position - (span?.start || 0) : position;
  const timelineTime = sequence ? position : (active?.start || 0) + position;
  const captionsOn = captionOverride ?? captionsDefault;
  const caption = captionsOn && (sequence || active) ? subtitleAt(cues, timelineTime, subtitleOffset) : '';
  const mediaKey = `${sequence}:${active?.id || 'gap'}:${shown.url}:${shown.audioUrl || ''}`;
  const playlistKey = JSON.stringify(entries.map(entry => [entry.id, entry.start, entry.duration, entry.media.url, entry.media.audioUrl]));
  const pauseAudio = () => { generated.current?.pause(); soundtrack.current?.pause(); };
  const stop = () => { intent.current = false; setPlaying(false); video.current?.pause(); pauseAudio(); };
  const sync = (shouldPlay: boolean, seconds = cursor.current) => {
    const sceneTime = sequence ? seconds - (span?.start || 0) : seconds;
    const globalTime = sequence ? seconds : (active?.start || 0) + seconds;
    const playTrack = (element: HTMLAudioElement | null, enabled: boolean, target: number, label: string) => {
      if (!element) return;
      element.volume = volume; element.muted = muted || !enabled;
      const available = !Number.isFinite(element.duration) || target < element.duration;
      if (available && Math.abs(element.currentTime - target) > .12) { try { element.currentTime = Math.max(0, target); } catch { /* Retry after metadata loads. */ } }
      if (shouldPlay && enabled && available) {
        if (element.paused) void element.play().catch(error => { if (element.isConnected && error.name !== 'AbortError') setAudioError(`${label} could not start. Press Play again to enable browser audio.`); });
      } else element.pause();
    };
    if (video.current) { video.current.volume = volume; video.current.muted = muted || !generatedOn || Boolean(shown.audioUrl); }
    if (shown.audioUrl) playTrack(generated.current, generatedOn, sceneTime, 'Generated audio');
    if (source) playTrack(soundtrack.current, sourceOn, Math.max(0, sourceSeek) + globalTime, 'Source soundtrack');
  };
  const publish = (seconds: number) => {
    cursor.current = seconds; setPosition(seconds); onTime(sequence ? seconds : (active?.start || 0) + seconds);
    if (sequence) { const entry = sequenceSpan(entries, seconds)?.entry; if (entry && entry.index !== active?.index) onScene(entry.index); }
  };
  const startVideo = () => {
    const element = video.current;
    if (!element || !intent.current || exhausted.current) return;
    void element.play().catch(error => {
      if (video.current === element && intent.current && error.name !== 'AbortError') {
        stop(); report('The preview could not start. Check its media format or try the generated take.');
      }
    });
  };
  const seek = (seconds: number) => {
    const target = Math.max(0, Math.min(usableDuration, seconds));
    const nextSpan = sequence ? sequenceSpan(entries, target) : undefined;
    const same = !sequence || nextSpan?.entry?.id === active?.id;
    if (same && video.current) {
      const local = sequence ? target - (nextSpan?.start || 0) : target;
      exhausted.current = Number.isFinite(video.current.duration) && local >= video.current.duration;
      try { video.current.currentTime = Math.min(local, video.current.duration || local); } catch { /* Loaded metadata applies this seek. */ }
    }
    publish(target);
    if (same) { sync(intent.current && !buffering.current, target); startVideo(); }
    if (target >= usableDuration) stop();
  };
  const toggle = () => {
    if (!canPlay) return;
    if (intent.current) { stop(); return; }
    setAudioError('');
    if (cursor.current >= usableDuration - .01) seek(0);
    intent.current = true; setPlaying(true); sync(true); startVideo();
  };
  const ready = () => {
    const element = video.current; if (!element) return;
    setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    const local = sequence ? cursor.current - (span?.start || 0) : cursor.current;
    exhausted.current = Number.isFinite(element.duration) && local >= element.duration;
    if (Math.abs(element.currentTime - local) > .025) element.currentTime = Math.min(local, element.duration || local);
    sync(intent.current); startVideo();
  };
  const tick = (elapsed: number) => {
    if (!intent.current) return;
    const element = video.current;
    let target = cursor.current;
    if (element && !exhausted.current) {
      if (buffering.current || element.paused || element.seeking || element.readyState < 2) return;
      target = (sequence ? span?.start || 0 : 0) + element.currentTime;
    } else target += elapsed;
    const boundary = sequence && span ? span.start + span.duration : usableDuration;
    if (target >= boundary) {
      if (!sequence || boundary >= total) { publish(usableDuration); stop(); return; }
      // Replacing the picture at the boundary preserves the source audio element.
      publish(boundary); return;
    }
    publish(target); sync(true, target);
  };
  const actions = useRef({ tick, sync, stop }); actions.current = { tick, sync, stop };
  const seekSequence = (seconds: number) => {
    stop();
    const target = Math.max(0, Math.min(total, seconds));
    if (sequence) { seek(target); return; }
    // A timeline gesture always addresses the saved cut, even when the viewer
    // was inspecting an isolated take or an unrelated source asset.
    setSequence(true); cursor.current = target; setPosition(target); onTime(target);
    const entry = sequenceSpan(entries, target)?.entry; if (entry) onScene(entry.index);
  };
  useImperativeHandle(controls, () => ({ toggle, seekSequence }));
  useLayoutEffect(() => {
    stop(); setAudioError(''); setClip({ media, segment });
    if (video.current) { try { video.current.currentTime = 0; } catch { /* New media applies the position after loading. */ } }
    const nextSequence = !isolated && Boolean(segment); setSequence(nextSequence);
    const nextPosition = nextSequence ? segment?.start || 0 : 0;
    cursor.current = nextPosition; setPosition(nextPosition); onTime(segment?.start || 0);
  }, [selectionKey]);
  useLayoutEffect(() => {
    exhausted.current = false; buffering.current = false; setDuration(0);
    const picture = video.current, sidecar = generated.current;
    if (video.current?.readyState) ready();
    else { sync(intent.current && !video.current); startVideo(); }
    return () => { picture?.pause(); sidecar?.pause(); };
  }, [mediaKey]);
  useLayoutEffect(() => { const track = soundtrack.current; return () => track?.pause(); }, [source]);
  useEffect(() => { actions.current.sync(intent.current); }, [generatedOn, sourceOn, volume, muted, source, sourceSeek]);
  useEffect(() => {
    if (!sequence) return;
    if (intent.current) { stop(); setAudioError('The saved cut changed. Press Play to continue with the updated sequence.'); }
    seek(cursor.current);
  }, [playlistKey]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0, previousFrame = performance.now();
    const animate = (now: number) => {
      if (now - previousFrame >= 1000 / 24) { actions.current.tick((now - previousFrame) / 1000); previousFrame = now; }
      if (intent.current) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => () => actions.current.stop(), []);
  const changeMode = (nextSequence: boolean) => {
    stop();
    const nextPosition = nextSequence ? timelineTime : localTime;
    if (!nextSequence) setClip({ media: shown, segment: active });
    else { const entry = sequenceSpan(entries, nextPosition)?.entry; if (entry) onScene(entry.index); }
    setSequence(nextSequence); cursor.current = nextPosition; setPosition(nextPosition);
  };
  const jump = (seconds: number) => { stop(); seek(seconds); };
  const previousEntry = entries.filter(entry => entry.start < (active?.start ?? position)).at(-1);
  const nextEntry = entries.find(entry => entry.start > position);
  const previousScene = sequence ? previousEntry && (() => jump(previousEntry.start)) : previous;
  const nextScene = sequence ? nextEntry && (() => jump(nextEntry.start)) : next;
  return <>
    <div className="playback-mode"><div role="group" aria-label="Playback mode"><button aria-pressed={sequence} disabled={!total} onClick={() => changeMode(true)}>Sequence</button><button aria-pressed={!sequence} disabled={sequence && !active} onClick={() => changeMode(false)}>Clip</button></div><span>{sequence ? 'Saved cut · plays through scenes and gaps' : 'Single clip · stops at its end'}</span></div>
    <div className="viewer-canvas" ref={surface}><div className="viewer-overlay"><span>{active ? `SCENE ${String(active.index + 1).padStart(2, '0')}` : sequence ? 'TIMELINE GAP' : 'SOURCE VIEWER'}</span><span>{shown.url ? 'PREVIEW' : sequence && !active ? 'GAP' : 'AWAITING RENDER'}</span></div>
      {shown.url ? image ? <img src={shown.url} alt={shown.name}/> : audio ? <audio key={shown.url} src={shown.url} controls/> : <video key={mediaKey} ref={video} src={shown.url} preload="auto" playsInline
        onLoadedMetadata={ready} onCanPlay={() => { buffering.current = false; startVideo(); }}
        onSeeking={() => { if (intent.current) pauseAudio(); }} onSeeked={() => sync(intent.current)}
        onEnded={() => { exhausted.current = true; buffering.current = false; if (!sequence) { publish(usableDuration); stop(); } }}
        onWaiting={() => { buffering.current = true; pauseAudio(); }} onPlaying={() => { buffering.current = false; sync(intent.current); }}
        onError={() => { stop(); report('This video could not be played. Try another take or download the clip.'); }} onClick={toggle}/>
        : <div className="viewer-empty"><div className="frame-corners"><Clapperboard size={43} strokeWidth={1}/></div><h2>{sequence && !active ? 'Timeline gap' : hasScene ? shown.name.replaceAll('_', ' ') : 'Your ComfyUI production'}</h2><p>{sequence && !active ? 'The soundtrack continues here.' : hasScene ? `No saved video for this scene yet.${sequence ? ' Playback continues over its planned duration.' : ''}` : 'Attach your open workflow to see its sequence and project.'}</p>{!hasScene && <button onClick={attach}>Attach live workflow</button>}</div>}
      {shown.audioUrl && <audio data-testid="generated-audio" ref={generated} key={`${active?.id}:${shown.audioUrl}`} src={shown.audioUrl} preload="auto" onLoadedMetadata={() => sync(intent.current)} onError={() => setAudioError('The generated audio file could not be played.')} hidden/>}
      {source && <audio data-testid="source-audio" ref={soundtrack} key={source} src={source} preload="auto" onLoadedMetadata={() => sync(intent.current)} onError={() => setAudioError('The source soundtrack could not be played. Refresh Plan Studio’s presentation in ComfyUI.')} hidden/>}
      {caption && <div className="subtitle-overlay" data-testid="subtitle-overlay">{caption}</div>}
      <span className="viewer-name">{shown.name.replaceAll('_', ' ')}</span>
    </div>
    <div className="transport"><span className="timecode" title={sequence ? 'Sequence position' : 'Clip position'}>{timecode(position)}</span><div><button className="icon-button" disabled={!previousScene} onClick={previousScene} aria-label="Previous scene"><SkipBack size={16}/></button><button className="icon-button" disabled={!canPlay} onClick={() => seek(position - 1 / 24)} aria-label="Previous frame"><ChevronLeft size={17}/></button><button className="play-button" disabled={!canPlay} aria-label={playing ? 'Pause preview' : 'Play preview'} onClick={toggle}>{playing ? <Pause size={17}/> : <Play size={17} fill="currentColor"/>}</button><button className="icon-button" disabled={!canPlay} onClick={() => seek(position + 1 / 24)} aria-label="Next frame"><ChevronRight size={17}/></button><button className="icon-button" disabled={!nextScene} onClick={nextScene} aria-label="Next scene"><SkipForward size={16}/></button></div><div><span className="muted timecode">{timecode(usableDuration)}</span><button className="icon-button" disabled={!canPlay && !shown.url} onClick={() => void surface.current?.requestFullscreen().catch(e => report(String(e)))} aria-label="Fullscreen preview"><Maximize size={14}/></button></div></div>
    <input className="viewer-scrubber" aria-label={sequence ? 'Seek sequence' : 'Seek preview'} type="range" min="0" max={usableDuration} step={1 / 24} value={Math.min(position, usableDuration)} disabled={!canPlay} onChange={e => seek(Number(e.target.value))}/>
    <div className="audio-controls"><button className="icon-button" disabled={!canPlay} aria-label={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => setMuted(v => !v)}>{muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button><input aria-label="Preview volume" type="range" min="0" max="1" step=".05" value={volume} disabled={!canPlay} onChange={e => setVolume(Number(e.target.value))}/><label><input type="checkbox" checked={generatedOn} disabled={!canPlay} onChange={e => setGeneratedOn(e.target.checked)}/>Generated audio</label><label title={source ? 'H3 source soundtrack at the editorial timeline position' : 'No saved Plan Studio soundtrack for this preview'}><input type="checkbox" checked={sourceOn && Boolean(source)} disabled={!canPlay || !source} onChange={e => setSourceOn(e.target.checked)}/>Source soundtrack</label><button aria-label="Toggle subtitles" aria-pressed={captionsOn && cues.length > 0} disabled={(!sequence && !active) || !cues.length} onClick={() => setCaptionOverride(!captionsOn)}>CC</button>{(sequence || active) && <span className="timeline-clock">Sequence {timecode(timelineTime)}</span>}</div>
    {audioError && <p className="playback-notice" role="alert">{audioError}</p>}
  </>;
}
