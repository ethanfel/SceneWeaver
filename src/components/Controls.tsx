import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import type { InputSpec, Value } from '../types';
import { parseJSON } from '../lib/workflow';

export function Field({ label, value, spec, onChange }: { label: string; value: Value; spec?: InputSpec; onChange: (value: Value) => void }) {
  const id = useId(), [draft, setDraft] = useState(String(value ?? '')), [error, setError] = useState('');
  useEffect(() => { setDraft(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')); setError(''); }, [value]);
  const kind = spec?.[0], options = spec?.[1];
  const choices = Array.isArray(kind) ? kind : undefined;
  const numeric = !choices && (kind === 'INT' || kind === 'FLOAT' || typeof value === 'number');
  const commitNumber = () => {
    if (!draft.trim() || !Number.isFinite(Number(draft))) { setError('Enter a finite number.'); return; }
    if (kind === 'INT' && !/^-?\d+$/.test(draft)) { setError('Enter a whole number.'); return; }
    const number = Number(draft);
    if (options?.min !== undefined && number < Number(options.min) || options?.max !== undefined && number > Number(options.max)) { setError(`Allowed range: ${options?.min ?? '−∞'} to ${options?.max ?? '∞'}.`); return; }
    onChange(kind === 'INT' && !Number.isSafeInteger(number) ? draft : number); setError('');
  };
  return <label className="field" htmlFor={id} title={options?.tooltip}>
    <span>{label.replaceAll('_', ' ')}</span>
    {choices ? <select id={id} value={String(value)} onChange={e => onChange(choices.find(item => String(item) === e.target.value) ?? e.target.value)}>
      {!choices.some(item => String(item) === String(value)) && <option value={String(value)}>{String(value)} (unavailable)</option>}
      {choices.map((item, i) => <option key={i} value={String(item)}>{String(item)}</option>)}
    </select> : typeof value === 'boolean' || kind === 'BOOLEAN' ? <input id={id} type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />
      : numeric ? <input id={id} inputMode={kind === 'INT' ? 'numeric' : 'decimal'} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commitNumber} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} aria-invalid={Boolean(error)} />
      : typeof value === 'object' && value !== null ? <textarea id={id} className="code" rows={5} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { try { onChange(parseJSON(draft) as Value); setError(''); } catch { setError('Enter valid JSON.'); } }} />
      : options?.multiline || String(value).includes('\n') || String(value).length > 100 ? <textarea id={id} rows={6} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />
      : <input id={id} value={String(value ?? '')} onChange={e => onChange(e.target.value)} />}
    {error && <small className="field-error">{error}</small>}
  </label>;
}

export function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button:not(:disabled), [role="dialog"] input, [role="dialog"] textarea, [role="dialog"] select, [role="dialog"] a[href]'));
        if (e.shiftKey && document.activeElement === elements[0]) { e.preventDefault(); elements.at(-1)?.focus(); }
        else if (!e.shiftKey && document.activeElement === elements.at(-1)) { e.preventDefault(); elements[0]?.focus(); }
      }
    };
    document.querySelector<HTMLElement>('[role="dialog"] input, [role="dialog"] textarea, [role="dialog"] button')?.focus();
    document.addEventListener('keydown', handle);
    return () => { document.removeEventListener('keydown', handle); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <header><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header>{children}
  </section></div>;
}

export function JsonEditor({ title, value, onApply, onClose }: { title: string; value: unknown; onApply: (value: unknown) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(JSON.stringify(value, null, 2)), [error, setError] = useState('');
  return <Modal title={title} onClose={onClose} wide><div className="modal-body"><textarea className="json-editor code" spellCheck={false} aria-label={title} value={draft} onChange={e => setDraft(e.target.value)} />{error && <p className="field-error">{error}</p>}</div><footer><span>Changes apply only when saved.</span><button className="primary" onClick={() => { try { onApply(parseJSON(draft)); onClose(); } catch (e) { setError(String(e)); } }}>Apply changes</button></footer></Modal>;
}
