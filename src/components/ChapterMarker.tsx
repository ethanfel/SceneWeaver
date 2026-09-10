import { useState } from 'react';
import type { PlanEdit } from '../lib/planAuthoring';

export type Chapter = { id: string; title: string; start_scene_id: string; text?: string; notes?: string };
export function ChapterMarker({ chapter, index, disabled, edit }: { chapter?: Chapter; index: number; disabled: boolean; edit: (edit: PlanEdit) => void }) {
  const [title, setTitle] = useState(chapter?.title || ''), [text, setText] = useState(chapter?.text ?? chapter?.notes ?? '');
  return <fieldset className="node-widget-field chapter-marker" disabled={disabled}>
    <details open={Boolean(chapter)}><summary>{chapter ? `Chapter · ${chapter.title}` : 'Chapter marker'}</summary>
      {chapter ? <>
        <label className="field"><span>Chapter title</span><input value={title} onChange={event => setTitle(event.target.value)}/></label>
        <label className="field"><span>Chapter notes</span><textarea rows={4} value={text} onChange={event => setText(event.target.value)}/></label>
        <div className="scene-actions"><button onClick={() => edit({ type: 'chapter-update', index, chapter_id: chapter.id, title, text })}>Stage chapter</button><button onClick={() => edit({ type: 'chapter-remove', index, chapter_id: chapter.id })}>Remove marker</button></div>
        <small className="hint">Starts before this scene. Removing the marker keeps its scenes.</small>
      </> : <button className="subtle-button" onClick={() => edit({ type: 'chapter-add', index })}>Start chapter here</button>}
    </details>
  </fieldset>;
}
