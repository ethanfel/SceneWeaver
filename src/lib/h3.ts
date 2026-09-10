import type { Checkpoint, Plan, Prompt, Shot, Value } from '../types';
import { parseJSON } from './workflow';
import { planChoices, resolvePlanBinding } from '../../public/integrations/binding-core.mjs';
export const promptText = (value: unknown): string => Array.isArray(value) ? value.join('\n') : String(value || '');
export const checkpointFor = (checkpoints: Checkpoint[], shot: Shot | undefined, index: number) => checkpoints.find(c => c.scene === index + 1 && (!shot?.id || c.scene_id === shot.id));
export const planNodes = (prompt: Prompt) => planChoices(prompt);
export function readPlan(value: unknown): Plan {
  const raw = typeof value === 'string' ? parseJSON(value) : value;
  const plan = (Array.isArray(raw) ? { shots: raw } : raw) as Plan | null;
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.shots) || plan.shots.some(shot => typeof shot !== 'string' && (!shot || typeof shot !== 'object' || Array.isArray(shot)))) throw new Error('An H3 plan must contain a shots array of scene objects or prompt strings.');
  // Display the accepted shorthand without touching its original text source.
  // Native structural edits parse and serialize that exact source in ComfyUI.
  const view: Plan = { ...plan, shots: plan.shots.map(shot => typeof shot === 'string' ? { prompt: shot } : shot) };
  if (Object.hasOwn(plan, 'duration_seconds') || Object.hasOwn(plan, 'steps')) {
    view.defaults = { ...(Object.hasOwn(plan, 'duration_seconds') ? { duration_seconds: plan.duration_seconds } : {}), ...(Object.hasOwn(plan, 'steps') ? { steps: plan.steps } : {}), ...plan.defaults };
    delete view.duration_seconds; delete view.steps;
  }
  return view;
}
export const h3Frames = (seconds: number) => {
  const requested = Math.max(5, Math.ceil(seconds * 24 - 1e-9));
  return requested + ((5 - requested % 17 + 17) % 17);
};
export const rawFrames = (shot: Shot, plan: Plan, inputs: Record<string, Value>) => Number(shot.length ?? shot.frames ?? (shot.duration_seconds !== undefined ? h3Frames(Number(shot.duration_seconds)) : h3Frames(Number(plan.defaults?.duration_seconds ?? inputs.default_duration_seconds ?? 15))));
export const timecode = (seconds: number) => {
  const frames = Math.max(0, Math.round(seconds * 24));
  return [Math.floor(frames / 86400), Math.floor(frames / 1440) % 60, Math.floor(frames / 24) % 60, frames % 24].map(n => String(n).padStart(2, '0')).join(':');
};
export function planProblems(plan: Plan, inputs: Record<string, Value>): string[] {
  const problems: string[] = [], ids = new Set<string>();
  if (!plan.shots.length) problems.push('Add at least one scene.');
  plan.shots.forEach((shot, index) => {
    if (shot.id && ids.has(shot.id)) problems.push(`Scene ${index + 1}: duplicate scene ID “${shot.id}”.`);
    if (shot.id) ids.add(shot.id);
    if (!promptText(shot.prompt).trim() && !promptText(plan.prompt_prefix || plan.global_prompt).trim()) problems.push(`Scene ${index + 1}: enter a prompt or shared direction.`);
    const frames = rawFrames(shot, plan, inputs);
    if (shot.length == null && shot.frames == null) {
      const duration = Number(shot.duration_seconds ?? plan.defaults?.duration_seconds ?? inputs.default_duration_seconds ?? 15);
      if (!Number.isFinite(duration) || duration <= 0) problems.push(`Scene ${index + 1}: duration must be a finite positive number.`);
    }
    if (!Number.isInteger(frames) || frames < 5 || frames > 3592 || (frames - 5) % 17 !== 0) problems.push(`Scene ${index + 1}: H3 needs 5 + 17k raw frames, between 5 and 3592.`);
    if (shot.seed !== undefined && !/^\d+$/.test(String(shot.seed))) problems.push(`Scene ${index + 1}: the seed must be a non-negative integer.`);
    else if (shot.seed !== undefined && BigInt(shot.seed) > 18446744073709551615n) problems.push(`Scene ${index + 1}: seed exceeds uint64.`);
  });
  return problems;
}
export function effectiveRunName(prompt: Prompt, planId: string): string {
  return resolvePlanBinding(prompt, planId).project;
}
