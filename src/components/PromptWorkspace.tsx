import { useEffect, useRef, useState } from 'react';
import type { Plan } from '../types';
import { promptText } from '../lib/h3';
import { canonicalSceneId } from '../lib/planAuthoring';

export type PromptRequest = { index: number; value: string; mode: string; duration: number; finalShot: number; caret: number; manual?: boolean; operation?: string; section?: string; item?: number };
type Problem = { severity: string; code: string; message: string; section?: string };
type Proposal = { text: string; caret: number; selectionStart?: number; selectionEnd?: number };
export type PromptInspection = {
  modes: { id: string; label: string }[];
  analysis: { mode: string; valid: boolean; required: string[]; records: { name: string; start: number; contentStart: number }[]; problems: Problem[] };
  referenceProblems: Problem[]; referenceScope: string;
  references: { token: string; kind: string; active: boolean; label?: string }[];
  tokens: { type: string; text: string; unresolved?: boolean }[];
  items: { label: string; detail?: string }[]; proposal: Proposal | null;
};
type LocalPrompt = { base: string; value: string; undo: string[]; redo: string[] };
type Props = { plan: Plan | null; selected: number; active: boolean; context: string; available: boolean; editable: boolean; duration: number; select: (index: number) => void; inspect: (request: PromptRequest) => Promise<PromptInspection>; stage: (value: string) => Promise<boolean | undefined> };

export function PromptWorkspace(p: Props) {
  // Per-scene text survives page/scene navigation. Only explicitly staged text
  // belongs to the app's durable browser draft; reload/conflict choices are visible.
  const [drafts, setDrafts] = useState<Record<string, LocalPrompt>>({});
  const shot = p.plan?.shots[p.selected], source = promptText(shot?.prompt);
  const id = `${p.selected}:${canonicalSceneId(shot?.id, p.selected)}`;
  const draft = drafts[id] || { base: source, value: source, undo: [], redo: [] };
  const text = draft.value, conflict = draft.base !== source && text !== source;
  const [modes, setModes] = useState([{ id: 'auto', label: 'Auto schema' }]);
  const [mode, setMode] = useState('auto'), [duration, setDuration] = useState(String(p.duration)), [finalShot, setFinalShot] = useState('1');
  const [view, setView] = useState('plain'), [caret, setCaret] = useState(0), [manual, setManual] = useState(false);
  const [data, setData] = useState<PromptInspection | null>(null), [error, setError] = useState('');
  const [proposal, setProposal] = useState<{ before: string; after: Proposal; key: string } | null>(null), [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), serial = useRef(0), mounted = useRef(true);
  const latest = useRef(p); latest.current = p;
  const requestKey = JSON.stringify([p.context, id, text, mode, duration, finalShot, caret, manual]);
  const currentKey = useRef(requestKey); currentKey.current = requestKey;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setMode('auto'); setDuration(String(p.duration)); setFinalShot('1'); setCaret(0); setProposal(null); setManual(false); }, [id]);
  useEffect(() => {
    if (text === source && draft.base !== source) setDrafts(all => ({ ...all, [id]: { ...draft, base: source } }));
  }, [id, source, text]);
  useEffect(() => {
    const ticket = ++serial.current;
    setData(null); setError('');
    if (!p.active || !p.available || !shot) return;
    const timer = setTimeout(() => {
      void latest.current.inspect({ index: p.selected, value: text, mode, duration: Number(duration), finalShot: Number(finalShot), caret, manual }).then(result => {
        if (mounted.current && serial.current === ticket && currentKey.current === requestKey) { setData(result); setModes(result.modes); }
      }).catch(reason => { if (mounted.current && serial.current === ticket && currentKey.current === requestKey) setError(String(reason)); });
    }, 160);
    return () => { clearTimeout(timer); serial.current++; };
  }, [requestKey, p.active, p.available]);
  const write = (value: string) => {
    if (value === text) return;
    setDrafts(all => ({ ...all, [id]: { base: draft.base === source || text === source ? source : draft.base, value, undo: [...draft.undo, text].slice(-100), redo: [] } }));
    setProposal(null); setManual(false);
  };
  const undo = (redo = false) => {
    const from = redo ? draft.redo : draft.undo;
    if (!from.length) return;
    setDrafts(all => ({ ...all, [id]: { ...draft, value: from[from.length - 1], undo: redo ? [...draft.undo, text] : draft.undo.slice(0, -1), redo: redo ? draft.redo.slice(0, -1) : [...draft.redo, text] } }));
    setProposal(null);
  };
  const focus = (position: number, end = position) => { setView('plain'); setCaret(end); requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, end); }); };
  const operate = async (operation: string, extra: Partial<PromptRequest> = {}) => {
    const key = requestKey; setBusy(true); setError('');
    try {
      const result = await p.inspect({ index: p.selected, value: text, mode, duration: Number(duration), finalShot: Number(finalShot), caret, manual, operation, ...extra });
      if (!mounted.current || currentKey.current !== key) return;
      if (!result.proposal) throw new Error('H3 did not return a prompt proposal.');
      if (operation === 'complete' || result.proposal.text === text) {
        write(result.proposal.text); focus(result.proposal.selectionStart ?? result.proposal.caret, result.proposal.selectionEnd ?? result.proposal.caret);
      } else setProposal({ before: text, after: result.proposal, key });
    } catch (reason) { if (mounted.current && currentKey.current === key) setError(String(reason)); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (!shot) return <div className="empty-small">Select a Plan scene to open its prompt workspace.</div>;
  return <section className="prompt-workspace" aria-label="Prompt workspace">
    <header className="prompt-workspace-header"><div><strong>Scene {p.selected + 1} · {canonicalSceneId(shot.id, p.selected)}</strong><small>{text === source ? 'Matches staged Plan' : 'Unstaged prompt edits'} · {text.length} characters</small></div><div className="scene-actions"><button disabled={p.selected === 0 || busy} onClick={() => p.select(p.selected - 1)}>Previous scene</button><button disabled={p.selected + 1 >= (p.plan?.shots.length || 0) || busy} onClick={() => p.select(p.selected + 1)}>Next scene</button></div></header>
    {!p.available && <p className="playback-notice">Native prompt tools require a current live attachment with H3’s prompt editor helpers. The Scene Inspector remains available.</p>}
    {conflict && <p role="alert">The staged scene prompt changed elsewhere. Your local text is kept. Copy it if needed, then reload the scene draft before staging.</p>}
    <div className="prompt-toolbar"><button onClick={() => setView('plain')} aria-pressed={view === 'plain'}>Plain text</button><button onClick={() => setView('rich')} aria-pressed={view === 'rich'} disabled={!data}>Highlighted view</button><button disabled={!draft.undo.length || busy} onClick={() => undo()}>Undo prompt</button><button disabled={!draft.redo.length || busy} onClick={() => undo(true)}>Redo prompt</button><button onClick={() => { setDrafts(all => ({ ...all, [id]: { base: source, value: source, undo: [...draft.undo, text].slice(-100), redo: [] } })); setProposal(null); }}>Reload scene draft</button></div>
    <div className="prompt-workspace-body">
      <div className="prompt-document">
        <textarea ref={input} aria-label="Expanded scene prompt" spellCheck={false} hidden={view !== 'plain'} value={text} disabled={!p.available || !p.editable || busy} onChange={event => { write(event.target.value); setCaret(event.target.selectionStart); }} onSelect={event => setCaret(event.currentTarget.selectionStart)} onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); undo(event.key.toLowerCase() === 'y' || event.shiftKey); }
          if (event.ctrlKey && event.code === 'Space') { event.preventDefault(); event.stopPropagation(); setManual(true); }
        }}/>
        {view === 'rich' && <pre className="prompt-highlighted" aria-label="Highlighted prompt">{data ? data.tokens.map((token, i) => <span key={i} className={`prompt-token-${token.type}`} title={token.unresolved ? 'Not resolved in the connected project alias catalog' : undefined}>{token.text}</span>) : text}</pre>}
        {data && view === 'plain' && !!data.items.length && <details className="prompt-completions" open><summary>Suggestions at cursor · {data.items.length}</summary><div>{data.items.map((item, i) => <button key={i} disabled={busy || !p.editable} onClick={() => void operate('complete', { item: i })}><strong>{item.label}</strong><small>{item.detail}</small></button>)}</div></details>}
        {proposal && proposal.key === requestKey && <div className="prompt-proposal"><strong>Review proposed structure</strong><div className="prompt-diff"><label>Before<textarea readOnly value={proposal.before}/></label><label>Proposed<textarea readOnly value={proposal.after.text}/></label></div><button disabled={!p.editable} onClick={() => { write(proposal.after.text); focus(proposal.after.caret); }}>Use proposed text</button><button onClick={() => setProposal(null)}>Dismiss proposal</button></div>}
      </div>
      <aside className="prompt-schema"><label className="field"><span>Prompt schema</span><select aria-label="Prompt schema" value={mode} disabled={!p.available || busy} onChange={event => setMode(event.target.value)}>{modes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <small className="hint">Schema selection checks text; generation mode comes from the workflow.</small>
        {['i2va', 'fl2va', 'l2va'].includes(mode === 'auto' ? data?.analysis.mode || '' : mode) && <details open><summary>Keyframe alignment</summary><label className="field"><span>Alignment duration (seconds)</span><input value={duration} onChange={event => setDuration(event.target.value)}/></label><label className="field"><span>Final shot number</span><input value={finalShot} onChange={event => setFinalShot(event.target.value)}/></label></details>}
        <button disabled={!data || busy || !p.editable} onClick={() => void operate('structure')}>Preview missing structure</button>
        {data && <><p className={data.analysis.valid ? 'hint' : 'prompt-invalid'}>{data.analysis.mode.toUpperCase()} · {data.analysis.valid ? 'No schema errors' : 'Schema needs attention'}</p><div className="prompt-sections">{data.analysis.required.map(section => { const record = data.analysis.records.find(item => item.name === section); return <button key={section} disabled={busy} onClick={() => record ? focus(record.contentStart) : void operate('section', { section })}>{record ? 'Go to' : 'Add'} {section.replaceAll('_', ' ')}</button>; })}</div>
          <ul className="prompt-problems">{data.analysis.problems.map((problem, i) => <li key={i}><strong>{problem.severity}</strong> · {problem.message}</li>)}</ul>
          <details className="prompt-reference-scope"><summary>Project aliases · {data.references.length}</summary><p className="hint">{data.referenceScope}</p>{data.references.map((record, i) => <p key={i}>{record.token} · {record.kind} · {record.active ? 'Used' : 'Unused'}</p>)}{!!data.referenceProblems.length && <details><summary>Reference checks within this catalog</summary>{data.referenceProblems.map((problem, i) => <p key={i}>{problem.message}</p>)}</details>}</details></>}
      </aside>
    </div>
    {error && <p role="alert">{error}</p>}
    <footer className="prompt-workspace-footer"><small>Stage adds this text to the recoverable Plan draft. Apply to ComfyUI updates its source. Unstaged text stays here until reload.</small><button className="primary" disabled={!p.editable || !p.available || busy || conflict || text === source} onClick={async () => { const key = requestKey; setBusy(true); try { await p.stage(text); } finally { if (mounted.current) { setBusy(false); if (currentKey.current === key) setProposal(null); } } }}>Stage prompt</button></footer>
  </section>;
}
