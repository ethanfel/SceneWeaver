import { useState } from 'react';
import { canonicalSceneId, type PlanEdit } from '../lib/planAuthoring';
import type { Shot, Value } from '../types';
import { inheritedValue } from './SceneSettings';

export type Chapter = { id: string; title: string; start_scene_id: string; text?: string; notes?: string; resolution?: { width: number; height: number } };
export function ChapterMarker({ chapter, index, disabled, edit, settings = false, shots = [], inputs = {} }: { chapter?: Chapter; index: number; disabled: boolean; edit: (edit: PlanEdit) => void; settings?: boolean; shots?: Shot[]; inputs?: Record<string, Value> }) {
  const [title, setTitle] = useState(chapter?.title || ''), [text, setText] = useState(chapter?.text ?? chapter?.notes ?? '');
  const [start, setStart] = useState(chapter?.start_scene_id || ''), [customSize, setCustomSize] = useState(Boolean(chapter?.resolution));
  const [width, setWidth] = useState(String(chapter?.resolution?.width ?? (typeof inputs.width === 'number' ? inputs.width : ''))), [height, setHeight] = useState(String(chapter?.resolution?.height ?? (typeof inputs.height === 'number' ? inputs.height : '')));
  return <fieldset className="node-widget-field chapter-marker" disabled={disabled}>
    <details open={Boolean(chapter)}><summary>{chapter ? `Chapter · ${chapter.title}` : 'Chapter marker'}</summary>
      {chapter ? <>
        <label className="field"><span>Chapter title</span><input value={title} onChange={event => setTitle(event.target.value)}/></label>
        <label className="field"><span>Chapter notes</span><textarea rows={4} value={text} onChange={event => setText(event.target.value)}/></label>
        {settings && <details className="chapter-geometry"><summary>Boundary and resolution</summary>
          <label className="field"><span>Chapter starts before</span><select aria-label="Chapter starts before" value={start} onChange={event => setStart(event.target.value)}>{shots.map((shot, i) => <option key={i} value={canonicalSceneId(shot.id, i)}>{i + 1} · {canonicalSceneId(shot.id, i)}</option>)}</select></label>
          <label className="field"><span>Chapter resolution</span><select aria-label="Chapter resolution" value={customSize ? 'custom' : 'inherit'} onChange={event => setCustomSize(event.target.value === 'custom')}><option value="inherit">Inherit Plan canvas</option><option value="custom">Custom chapter canvas</option></select></label>
          {customSize ? <div className="field-pair"><label className="field"><span>Chapter width</span><input inputMode="numeric" value={width} onChange={event => setWidth(event.target.value)}/></label><label className="field"><span>Chapter height</span><input inputMode="numeric" value={height} onChange={event => setHeight(event.target.value)}/></label></div> : <small className="hint">Plan canvas: {inheritedValue(inputs.width)} × {inheritedValue(inputs.height)}.</small>}
          <small className="hint">Chapter dimensions use multiples of 32. Locked saved scenes can pin their chapter size. Native latent continuity requires matching sizes; export different-sized chapters separately.</small>
        </details>}
        <div className="scene-actions"><button onClick={() => edit({ type: 'chapter-update', index, chapter_id: chapter.id, title, text, ...(settings ? { start_scene_id: start, resolution: customSize ? { width: Number(width), height: Number(height) } : null } : {}) })}>Stage chapter</button><button onClick={() => edit({ type: 'chapter-remove', index, chapter_id: chapter.id })}>Remove marker</button></div>
        <small className="hint">Starts before this scene. Removing the marker keeps its scenes.</small>
      </> : <button className="subtle-button" onClick={() => edit({ type: 'chapter-add', index })}>Start chapter here</button>}
    </details>
  </fieldset>;
}
