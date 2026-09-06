export function applyCheckpointRevisionSet(plan, revisions, options) {
  if (!options?.useEffectivePrompts || !options?.useTipSharedPrompt) throw new Error('Native activation options missing');
  for (const revision of revisions) {
    const shot = plan.shots[revision.scene - 1];
    if (!shot || !revision.seed || !revision.raw_frames) throw new Error('Invalid native restoration');
    Object.assign(shot, { id: revision.scene_id, prompt: revision.effective_scene_prompt ?? revision.scene_prompt, seed: revision.seed, length: revision.raw_frames, steps: revision.steps });
  }
  return plan;
}
