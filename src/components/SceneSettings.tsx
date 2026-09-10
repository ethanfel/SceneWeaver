import { useState } from 'react';
import type { Plan, Shot, Value } from '../types';
import type { PlanEdit } from '../lib/planAuthoring';
import { h3Frames } from '../lib/h3';
import { isLink } from '../lib/workflow';

export function inheritedValue(value: unknown, unit = '') {
  if (isLink(value)) return `Connected input #${value[0]}`;
  return value === undefined || value === null ? 'Not available' : `${String(value)}${unit}`;
}

export function SceneSettings({ shot, plan, inputs, index, disabled, edit }: { shot: Shot; plan: Plan; inputs: Record<string, Value>; index: number; disabled: boolean; edit: (edit: PlanEdit) => void }) {
  const initialMode = shot.length !== undefined || shot.frames !== undefined ? 'frames' : shot.duration_seconds !== undefined ? 'seconds' : 'default';
  const [mode, setMode] = useState<'default' | 'seconds' | 'frames'>(initialMode);
  const [duration, setDuration] = useState(String(shot.length ?? shot.frames ?? shot.duration_seconds ?? ''));
  const [steps, setSteps] = useState(String(shot.steps ?? '')), [seed, setSeed] = useState(String(shot.seed ?? ''));
  const [promptMode, setPromptMode] = useState(String(shot.prompt_seed_mode ?? (shot.prompt_seed !== undefined ? 'fixed' : 'inherit')));
  const [promptSeed, setPromptSeed] = useState(String(shot.prompt_seed ?? ''));
  const inheritedDuration = plan.defaults?.duration_seconds ?? inputs.default_duration_seconds;
  const requested = mode === 'default' ? inheritedDuration : duration;
  const raw = isLink(requested) || !String(requested ?? '').trim() ? NaN : mode === 'frames' ? Number(requested) : h3Frames(Number(requested));
  const validRaw = Number.isInteger(raw) && raw >= 5 && raw <= 3592 && raw % 17 === 5 && Number(requested) > 0;
  const stage = (randomize_seed?: 'generation' | 'prompt') => edit({ type: 'scene-settings', index, duration: { mode, value: duration }, steps, seed, prompt_seed_mode: promptMode, prompt_seed: promptSeed, ...(randomize_seed ? { randomize_seed } : {}) });
  return <fieldset className="node-widget-field scene-generation-settings" disabled={disabled}>
    <div className="section-label">GENERATION</div>
    <label className="field"><span>Duration source</span><select aria-label="Duration source" value={mode} onChange={event => { const next = event.target.value as typeof mode; if (next !== 'default' && validRaw) setDuration(String(next === 'frames' ? raw : mode === 'frames' ? raw / 24 : Number(requested))); setMode(next); }}>
      <option value="default">Inherit Plan duration</option><option value="seconds">Requested seconds</option><option value="frames">Exact raw frames</option>
    </select></label>
    {mode !== 'default' && <label className="field"><span>{mode === 'seconds' ? 'Requested seconds' : 'Raw frames'}</span><input inputMode={mode === 'seconds' ? 'decimal' : 'numeric'} value={duration} onChange={event => setDuration(event.target.value)}/></label>}
    <small className="hint">{mode === 'default' ? `Plan default: ${inheritedValue(inheritedDuration, ' s')}. ` : ''}{validRaw ? `${raw} raw frames · ${(raw / 24).toFixed(3)} s at 24 fps.` : 'Set a valid duration to preview raw frames.'} Delivered duration also depends on continuity trimming and the saved cut.</small>
    <label className="field"><span>Steps</span><input inputMode="numeric" placeholder="Inherit Plan" value={steps} onChange={event => setSteps(event.target.value)}/></label>
    <small className="hint">Blank inherits {inheritedValue(plan.defaults?.steps ?? inputs.default_steps, ' steps')}.</small>
    <label className="field"><span>Scene seed</span><input inputMode="numeric" placeholder="Stable derived seed" value={seed} onChange={event => setSeed(event.target.value)}/></label>
    <small className="hint">Blank derives the generation seed from the Plan base seed, scene index and ID.</small>
    <details className="prompt-alternatives"><summary>Prompt alternatives</summary>
      <label className="field"><span>Prompt seed mode</span><select aria-label="Prompt seed mode" value={promptMode} onChange={event => setPromptMode(event.target.value)}><option value="inherit">Stable derived choices</option><option value="fixed">Fixed choices</option><option value="randomize">Randomize each queue</option></select></label>
      {promptMode === 'fixed' && <label className="field"><span>Prompt seed</span><input inputMode="numeric" value={promptSeed} onChange={event => setPromptSeed(event.target.value)}/></label>}
      <small className="hint">Controls {'{one|two}'} prompt choices separately from the generation seed.</small>
    </details>
    <button className="subtle-button" onClick={() => stage()}>Stage scene settings</button>
    <details className="seed-reroll"><summary>New seeds</summary><small className="hint">Stages these settings with a new seed from H3.</small><div className="scene-actions"><button onClick={() => stage('generation')}>New generation seed</button><button onClick={() => stage('prompt')}>New prompt seed</button></div></details>
  </fieldset>;
}

export function PlanDefaults({ plan, inputs, index, disabled, edit }: { plan: Plan; inputs: Record<string, Value>; index: number; disabled: boolean; edit: (edit: PlanEdit) => void }) {
  const [duration, setDuration] = useState(String(plan.defaults?.duration_seconds ?? '')), [steps, setSteps] = useState(String(plan.defaults?.steps ?? ''));
  return <fieldset className="node-widget-field" disabled={disabled}><details className="plan-defaults"><summary>Plan defaults</summary>
    <label className="field"><span>Default duration override (seconds)</span><input inputMode="decimal" value={duration} onChange={event => setDuration(event.target.value)} placeholder="Inherit node setting"/></label>
    <small className="hint">Blank inherits {inheritedValue(inputs.default_duration_seconds, ' s')} from the Plan node.</small>
    <label className="field"><span>Default steps override</span><input inputMode="numeric" value={steps} onChange={event => setSteps(event.target.value)} placeholder="Inherit node setting"/></label>
    <small className="hint">Blank inherits {inheritedValue(inputs.default_steps, ' steps')} from the Plan node. Scene overrides take precedence.</small>
    <button className="subtle-button" onClick={() => edit({ type: 'plan-defaults', index, duration_seconds: duration, steps })}>Stage Plan defaults</button>
  </details></fieldset>;
}
