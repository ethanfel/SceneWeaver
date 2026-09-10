import { useState } from 'react';

export function SharedDirection({ value, disabled, stage }: { value: string; disabled: boolean; stage: (text: string) => void }) {
  const [text, setText] = useState(value);
  return <fieldset className="node-widget-field" disabled={disabled}><details className="shared-direction"><summary>Shared direction</summary><textarea aria-label="Shared direction" rows={6} placeholder="Identity, setting and continuity across every scene…" value={text} onChange={event => setText(event.target.value)}/><button className="subtle-button" onClick={() => stage(text)}>Stage shared direction</button></details></fieldset>;
}
