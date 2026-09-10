export type PlanEdit =
  | { type: 'scene-prompt'; index: number; value: string }
  | { type: 'scene-settings'; index: number; duration: { mode: 'default' | 'seconds' | 'frames'; value: string }; steps: string; seed: string; prompt_seed_mode: string; prompt_seed: string; randomize_seed?: 'generation' | 'prompt' }
  | { type: 'scene-seed-random'; index: number; kind: 'generation' | 'prompt' }
  | { type: 'plan-defaults'; index: number; duration_seconds: string; steps: string }
  | { type: 'shared-direction'; index: number; text: string }
  | { type: 'rename'; index: number; id: string }
  | { type: 'duplicate' | 'add' | 'remove' | 'chapter-add'; index: number }
  | { type: 'move'; index: number; direction: number }
  | { type: 'chapter-update'; index: number; chapter_id: string; title: string; text: string; start_scene_id?: string; resolution?: null | { width: number; height: number } }
  | { type: 'chapter-remove'; index: number; chapter_id: string };

// Display/selection identity follows H3 safeShotId; it does not rewrite Plan text.
export function canonicalSceneId(value: unknown, index: number) {
  const text = String(value ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '');
  return (text || `clip_${String(index + 1).padStart(4, '0')}`).slice(0, 96);
}
