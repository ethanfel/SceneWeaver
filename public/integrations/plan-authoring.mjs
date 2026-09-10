// Pure draft transformations delegated to the attached installation's H3 core.
// This module never touches widgets, checkpoints, editorial files or the queue.
export const PLAN_AUTHORING_EXPORTS = [
  'parsePlanJson', 'planToJson', 'renamePlanShot', 'duplicateShot',
  'makeShot', 'removePlanShot', 'moveShot', 'makeChapter',
];

export function editPlanDraft(core, text, edit) {
  if (!core || PLAN_AUTHORING_EXPORTS.some(name => typeof core[name] !== 'function')) throw new Error('The installed H3 Plan authoring helpers are unavailable. Refresh the ComfyUI tab after updating H3.');
  if (typeof text !== 'string' || !edit || typeof edit !== 'object') throw new Error('Provide the current Plan draft and a scene edit.');
  const plan = core.parsePlanJson(text), shots = plan.shots;
  let selected = edit.index;
  if (!Number.isInteger(selected) || selected < 0 || selected >= shots.length) throw new Error('The selected scene is outside the Plan draft.');
  switch (edit.type) {
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
      }
      // Chapter fields follow the same canonical validation as native Studio.
      return { text: core.planToJson(core.parsePlanJson(core.planToJson(plan))), selected };
    }
    default: throw new Error('Unsupported native Plan edit.');
  }
  return { text: core.planToJson(plan), selected };
}
