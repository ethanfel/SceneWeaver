import { useRef, useState } from 'react';
import { Check, ChevronRight, Film, Maximize2, Minus, MousePointer2, Plus, Volume2 } from 'lucide-react';
import type { Checkpoint, Plan, Value } from '../types';
import { checkpointFor, rawFrames, timecode } from '../lib/h3';

const colors = ['#53748c', '#697a62', '#8d705d', '#796789', '#5c8583', '#8e6d7c'];
export function Timeline({ plan, inputs, checkpoints, selected, select, add, currentTime, onSeek }: { plan: Plan | null; inputs: Record<string, Value>; checkpoints: Checkpoint[]; selected: number; select: (i: number) => void; add: () => void; currentTime: number; onSeek: (seconds: number) => void }) {
  const [zoom, setZoom] = useState(1), scroll = useRef<HTMLDivElement>(null);
  const durations = plan?.shots.map((shot, index) => { const take = checkpointFor(checkpoints, shot, index); return (take?.ready && take.delivered_frames > 0 ? take.delivered_frames : rawFrames(shot, plan, inputs)) / 24; }) || [];
  const estimated = plan?.shots.some((shot, index) => !checkpointFor(checkpoints, shot, index)?.ready);
  const widths = durations.map(seconds => Math.max(145, seconds * 23 * zoom));
  const total = widths.reduce((a, b) => a + b, 0);
  let running = 0;
  return <section className="timeline panel">
    <div className="timeline-toolbar"><div className="timeline-name"><Film size={15}/><strong>Scene sequence</strong><ChevronRight size={13}/><span>{plan?.shots.length || 0} scenes</span></div><div className="timeline-tools"><MousePointer2 size={14}/><span className="divider"/><button className="icon-button" aria-label="Zoom out timeline" onClick={() => setZoom(v => Math.max(.4, v - .2))}><Minus size={15}/></button><input aria-label="Timeline zoom" type="range" min=".4" max="3" step=".1" value={zoom} onChange={e => setZoom(Number(e.target.value))}/><button className="icon-button" aria-label="Zoom in timeline" onClick={() => setZoom(v => Math.min(3, v + .2))}><Plus size={15}/></button><button className="icon-button" aria-label="Reset timeline zoom" onClick={() => setZoom(1)}><Maximize2 size={14}/></button></div></div>
    <div className="timeline-grid"><div className="track-labels"><div className="clock-label">24 FPS</div><div><span className="track-badge">V1</span><span>H3 scenes<small>Generation order</small></span><Film size={14}/></div><div><span className="track-badge audio">A1</span><span>Clip audio<small>Linked to video</small></span><Volume2 size={14}/></div></div>
    <div className="timeline-scroll" ref={scroll}><div className="timeline-content" style={{ minWidth: Math.max(total + 100, 600) }}>
      <div className="ruler">{plan?.shots.map((_, index) => { const label = timecode(running); running += durations[index]; return <div key={index} style={{ width: widths[index] }}>{label}<i/><i/><i/></div>; })}</div>
      <div className="video-track">{plan?.shots.map((shot, index) => {
        const checkpoint = checkpointFor(checkpoints, shot, index);
        return <button key={index} className={`timeline-clip ${selected === index ? 'selected' : ''}`} style={{ width: widths[index], '--clip-color': colors[index % colors.length] } as React.CSSProperties} onClick={() => select(index)} onDoubleClick={event => { const rect = event.currentTarget.getBoundingClientRect(); select(index); onSeek((event.clientX - rect.left) / rect.width * durations[index]); }} aria-label={`Select scene ${index + 1}: ${shot.id || 'Untitled'}`}>
          <div><span>{String(index + 1).padStart(2, '0')}</span><strong>{shot.id?.replaceAll('_', ' ') || 'Untitled scene'}</strong>{checkpoint?.ready && <Check size={12}/>}</div><div className="clip-body"><Film size={21}/><span>{checkpoint?.ready ? 'Rendered' : 'Planned scene'}</span></div><small>{timecode(durations[index])}<span>{checkpoint?.ready ? 'clip' : 'raw'}</span></small>
        </button>;
      })}<button className="add-timeline" onClick={add} disabled={!plan} aria-label="Add scene"><Plus size={19}/></button></div>
      <div className="audio-track">{plan?.shots.map((shot, index) => <div key={index} style={{ width: widths[index] }}><Volume2 size={13}/><span>{checkpointFor(checkpoints, shot, index)?.ready ? 'Embedded clip audio' : 'Audio follows render'}</span></div>)}</div>
      {plan?.shots[selected] && <div className="playhead" style={{ left: widths.slice(0, selected).reduce((a, b) => a + b, 0) + Math.min(1, currentTime / durations[selected]) * widths[selected] }}><span/></div>}
    </div></div></div>
    <div className="timeline-footer"><span>Scene order controls continuation dependencies. Reordering affects subsequent renders.</span><span>Sequence {timecode(running)}{estimated ? ' · includes raw estimates' : ' · delivered clips'}</span></div>
  </section>;
}
