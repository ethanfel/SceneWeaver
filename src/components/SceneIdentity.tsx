import { useEffect, useState } from 'react';

export function SceneIdentity({ value, rename, disabled }: { value: string; rename: (value: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <fieldset className="node-widget-field" disabled={disabled}>
    <label className="field"><span>Scene ID</span><input aria-label="Scene ID" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && draft.trim() && draft !== value) { event.preventDefault(); rename(draft); } }}/></label>
    <button className="subtle-button" disabled={!draft.trim() || draft === value} onClick={() => rename(draft)}>Rename scene</button>
  </fieldset>;
}
