// Pure draft transformations delegated to the attached installation's H3 core.
// This module never touches widgets, checkpoints, editorial files or the queue.
export const PLAN_AUTHORING_EXPORTS = [
  'parsePlanJson', 'planToJson', 'renamePlanShot', 'duplicateShot',
  'makeShot', 'removePlanShot', 'moveShot', 'makeChapter',
];
export const PLAN_SETTINGS_EXPORTS = ['validateH3Length', 'setSharedPrompt', 'setScenePromptSeedMode', 'randomSceneSeed', 'normalizeChapterResolution', 'safeShotId'];
const settingsActions = new Set(['scene-settings', 'scene-seed-random', 'plan-defaults', 'shared-direction']);
const stepsValue = value => {
  const text = String(value ?? '').trim(), number = Number(text);
  if (!text) return undefined;
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < 1 || number > 10000) throw new Error('Steps must be a whole number between 1 and 10000.');
  return number;
};
const seedValue = (value, maximum) => {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (!/^\d+$/.test(text) || BigInt(text) > maximum) throw new Error('Seed must be an unsigned 64-bit integer.');
  return BigInt(text).toString();
};
const secondsValue = (value, core) => {
  const number = Number(value);
  if (!String(value ?? '').trim() || !Number.isFinite(number) || number <= 0 || Math.ceil(number * core.FPS - 1e-9) > core.MAX_H3_FRAMES) throw new Error(`Duration must be greater than zero and at most ${core.MAX_H3_FRAMES / core.FPS} seconds.`);
  // Store the user's seconds request. The Python compiler performs rounding;
  // older native browser helpers can incorrectly round some durations down.
  return number;
};
function optional(object, name, value) { if (value === undefined) delete object[name]; else object[name] = value; }

export function editPlanDraft(core, text, edit) {
  if (!core || PLAN_AUTHORING_EXPORTS.some(name => typeof core[name] !== 'function')) throw new Error('The installed H3 Plan authoring helpers are unavailable. Refresh the ComfyUI tab after updating H3.');
  if (typeof text !== 'string' || !edit || typeof edit !== 'object') throw new Error('Provide the current Plan draft and a scene edit.');
  const plan = core.parsePlanJson(text), shots = plan.shots;
  let selected = edit.index;
  if (!Number.isInteger(selected) || selected < 0 || selected >= shots.length) throw new Error('The selected scene is outside the Plan draft.');
  if (settingsActions.has(edit.type) && PLAN_SETTINGS_EXPORTS.some(name => typeof core[name] !== 'function')) throw new Error('The installed H3 Plan settings helpers are unavailable.');
  switch (edit.type) {
    case 'scene-settings': {
      const shot = shots[selected], duration = edit.duration;
      if (edit.randomize_seed !== undefined && !['generation', 'prompt'].includes(edit.randomize_seed)) throw new Error('Choose a generation or prompt seed.');
      if (!duration || !['default', 'seconds', 'frames'].includes(duration.mode)) throw new Error('Choose inherited duration, seconds or exact frames.');
      const length = duration.mode === 'frames' ? core.validateH3Length(duration.value) : undefined;
      const seconds = duration.mode === 'seconds' ? secondsValue(duration.value, core) : undefined;
      const steps = stepsValue(edit.steps), seed = seedValue(edit.randomize_seed === 'generation' ? core.randomSceneSeed() : edit.seed, core.MAX_SEED);
      delete shot.length; delete shot.frames; delete shot.duration_seconds;
      optional(shot, 'length', length); optional(shot, 'duration_seconds', seconds);
      optional(shot, 'steps', steps); optional(shot, 'seed', seed);
      const promptMode = edit.randomize_seed === 'prompt' ? 'fixed' : edit.prompt_seed_mode;
      if (promptMode === 'fixed') {
        const promptSeed = seedValue(edit.randomize_seed === 'prompt' ? core.randomSceneSeed() : edit.prompt_seed, core.MAX_SEED);
        if (promptSeed === undefined) throw new Error('Enter a fixed prompt seed or choose another prompt seed mode.');
        shot.prompt_seed = promptSeed;
      }
      core.setScenePromptSeedMode(shot, promptMode);
      break;
    }
    case 'scene-seed-random':
      if (!['generation', 'prompt'].includes(edit.kind)) throw new Error('Choose a generation or prompt seed.');
      if (edit.kind === 'generation') shots[selected].seed = core.randomSceneSeed();
      else { shots[selected].prompt_seed_mode = 'fixed'; shots[selected].prompt_seed = core.randomSceneSeed(); }
      break;
    case 'plan-defaults': {
      const duration = String(edit.duration_seconds ?? '').trim() ? secondsValue(edit.duration_seconds, core) : undefined;
      const steps = stepsValue(edit.steps);
      const defaults = plan.defaults && typeof plan.defaults === 'object' && !Array.isArray(plan.defaults) ? { ...plan.defaults } : {};
      optional(defaults, 'duration_seconds', duration); optional(defaults, 'steps', steps);
      if (Object.keys(defaults).length) plan.defaults = defaults; else delete plan.defaults;
      break;
    }
    case 'shared-direction':
      if (typeof edit.text !== 'string') throw new Error('Enter shared direction text.');
      core.setSharedPrompt(plan, edit.text); break;
    case 'rename': {
      if (typeof edit.id !== 'string' || !edit.id.trim()) throw new Error('Enter a scene ID.');
      const renamed = core.renamePlanShot(plan, selected, edit.id);
      // Studio also writes the returned canonical ID for an unchanged implicit
      // identity (the helper only mutates the shot when identity changes).
      shots[selected].id = renamed.id; break;
    }
    case 'duplicate':
      if (shots.length >= core.MAX_SHOTS) throw new Error(`H3 supports at most ${core.MAX_SHOTS} scenes.`);
      core.duplicateShot(shots, selected); selected++; break;
    case 'add':
      if (shots.length >= core.MAX_SHOTS) throw new Error(`H3 supports at most ${core.MAX_SHOTS} scenes.`);
      shots.push(core.makeShot(shots)); selected = shots.length - 1; break;
    case 'remove':
      if (shots.length <= 1) throw new Error('Keep at least one scene in the Plan.');
      core.removePlanShot(plan, selected); selected = Math.min(selected, shots.length - 1); break;
    case 'move':
      if (![-1, 1].includes(edit.direction) || selected + edit.direction < 0 || selected + edit.direction >= shots.length) throw new Error('Choose an adjacent scene position inside the Plan.');
      core.moveShot(shots, selected, selected + edit.direction); selected += edit.direction; break;
    case 'chapter-add':
      if ((plan.chapters?.length || 0) >= core.MAX_CHAPTERS) throw new Error(`H3 supports at most ${core.MAX_CHAPTERS} chapters.`);
      core.makeChapter(plan, selected); break;
    case 'chapter-update':
    case 'chapter-remove': {
      const chapter = plan.chapters?.find(item => item.id === edit.chapter_id);
      if (!chapter) throw new Error('The chapter is no longer in this Plan draft.');
      if (edit.type === 'chapter-remove') {
        plan.chapters = plan.chapters.filter(item => item !== chapter);
        if (!plan.chapters.length) delete plan.chapters;
      } else {
        if (typeof edit.title !== 'string' || typeof edit.text !== 'string') throw new Error('Enter a chapter title and notes.');
        chapter.title = edit.title; chapter.text = edit.text;
        if (Object.hasOwn(edit, 'start_scene_id')) chapter.start_scene_id = edit.start_scene_id;
        if (Object.hasOwn(edit, 'resolution')) {
          if (edit.resolution === null) delete chapter.resolution;
          else chapter.resolution = core.normalizeChapterResolution(edit.resolution);
        }
      }
      // Chapter fields follow the same canonical validation as native Studio.
      const normalized = core.parsePlanJson(core.planToJson(plan));
      if (edit.type === 'chapter-update' && Object.hasOwn(edit, 'start_scene_id')) {
        selected = normalized.shots.findIndex((shot, index) => core.safeShotId(shot.id, `clip_${String(index + 1).padStart(4, '0')}`) === chapter.start_scene_id);
        if (selected < 0) throw new Error('The chapter start scene is unavailable.');
      }
      return { text: core.planToJson(normalized), selected };
    }
    default: throw new Error('Unsupported native Plan edit.');
  }
  return { text: core.planToJson(plan), selected };
}
