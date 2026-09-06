import { useState } from 'react';
import { Check, ChevronRight, Film, Maximize2, Minus, MousePointer2, Plus, Volume2 } from 'lucide-react';
import type { Checkpoint, Editorial, Plan, Value } from '../types';
import { checkpointFor, timecode } from '../lib/h3';
import { CheckpointThumbnail } from './CheckpointThumbnail';
import { checkpointThumbnailUrl, playbackSegments } from '../lib/playback';

const colors = ['#53748c', '#697a62', '#8d705d', '#796789', '#5c8583', '#8e6d7c'];
export function Timeline({ project, server, plan, inputs, checkpoints, editorial, selected, select, add, currentTime, onSeek }: { project: string; server: string; plan: Plan | null; inputs: Record<string, Value>; checkpoints: Checkpoint[]; editorial?: Editorial | null; selected: number; select: (i: number) => void; add: () => void; currentTime: number; onSeek: (seconds: number) => void }) {
  const [zoom, setZoom] = useState(1);
  const segments = playbackSegments(plan, inputs, checkpoints, editorial);
  let previousEnd = 0, width = 0;
  const layout = segments.map(segment => {
    const gap = Math.max(0, segment.start - previousEnd) * 23 * zoom;
    const clipWidth = Math.max(145, segment.duration * 23 * zoom);
    const left = width + gap; width = left + clipWidth; previousEnd = segment.start + segment.duration;
    return { ...segment, gap, width: clipWidth, left };
  });
  const active = layout.find(item => currentTime >= item.start && currentTime < item.start + item.duration);
  const following = layout.find(item => item.start > currentTime);
  const playhead = active ? active.left + (currentTime - active.start) / active.duration * active.width
    : following ? following.left - (following.start - currentTime) * 23 * zoom : width;
  return <section className="timeline panel">
    <div className="timeline-toolbar"><div className="timeline-name"><Film size={15}/><strong>Scene sequence</strong><ChevronRight size={13}/><span>{plan?.shots.length || 0} scenes</span></div><div className="timeline-tools"><MousePointer2 size={14}/><span className="divider"/><button className="icon-button" aria-label="Zoom out timeline" onClick={() => setZoom(v => Math.max(.4, v - .2))}><Minus size={15}/></button><input aria-label="Timeline zoom" type="range" min=".4" max="3" step=".1" value={zoom} onChange={e => setZoom(Number(e.target.value))}/><button className="icon-button" aria-label="Zoom in timeline" onClick={() => setZoom(v => Math.min(3, v + .2))}><Plus size={15}/></button><button className="icon-button" aria-label="Reset timeline zoom" onClick={() => setZoom(1)}><Maximize2 size={14}/></button></div></div>
    <div className="timeline-grid"><div className="track-labels"><div className="clock-label">24 FPS</div><div><span className="track-badge">V1</span><span>H3 scenes<small>Saved presentation</small></span><Film size={14}/></div><div><span className="track-badge audio">A1</span><span>Generated audio<small>Linked to picture</small></span><Volume2 size={14}/></div></div>
    <div className="timeline-scroll"><div className="timeline-content" style={{ minWidth: Math.max(width + 100, 600) }}>
      <div className="ruler">{layout.map(item => <div key={item.index} style={{ width: item.width, marginLeft: item.gap }}>{timecode(item.start)}<i/><i/><i/></div>)}</div>
      <div className="video-track">{layout.map(item => {
        const shot = plan!.shots[item.index], checkpoint = checkpointFor(checkpoints, shot, item.index);
        return <button key={item.index} className={`timeline-clip ${selected === item.index ? 'selected' : ''}`} style={{ width: item.width, marginLeft: item.gap, '--clip-color': colors[item.index % colors.length] } as React.CSSProperties} onClick={() => select(item.index)} onDoubleClick={event => { const rect = event.currentTarget.getBoundingClientRect(); if (selected === item.index) onSeek((event.clientX - rect.left) / rect.width * item.duration); else select(item.index); }} aria-label={`Select scene ${item.index + 1}: ${shot.id || 'Untitled'}`}>
          <div><span>{String(item.index + 1).padStart(2, '0')}</span><strong>{shot.id?.replaceAll('_', ' ') || 'Untitled scene'}</strong>{checkpoint?.ready && <Check size={12}/>}</div><div className="clip-body"><CheckpointThumbnail url={checkpointThumbnailUrl(project, checkpoint, server)} name={shot.id || `Scene ${item.index + 1}`} filmstrip/><Film size={21}/><span className="clip-state">{checkpoint?.presentation_revision ? 'Final-cut alternate' : checkpoint?.ready ? 'Rendered' : 'Planned scene'}</span></div><small>{timecode(item.duration)}<span>{item.estimated ? 'raw' : 'clip'}</span></small>
        </button>;
      })}<button className="add-timeline" onClick={add} disabled={!plan} aria-label="Add scene"><Plus size={19}/></button></div>
      <div className="audio-track">{layout.map(item => <div key={item.index} style={{ width: item.width, marginLeft: item.gap }}><Volume2 size={13}/><span>{item.estimated ? 'Audio follows render' : 'Generated clip audio'}</span></div>)}</div>
      {layout.length > 0 && <div className="playhead" style={{ left: Math.max(0, playhead) }}><span/></div>}
    </div></div></div>
    <div className="timeline-footer"><span>H3’s saved trims, placements, and final-cut choices are shown here.</span><span>Sequence {timecode(previousEnd)}{segments.some(item => item.estimated) ? ' · includes raw estimates' : ' · delivered clips'}</span></div>
  </section>;
}
