const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function finalCutDocument(payload, command) {
  const base = payload.checkpoints?.find(item => item.scene === command.scene && item.scene_id === command.scene_id);
  if (!base?.ready || base.revision !== command.base_revision) throw new Error('The active checkpoint changed. Refresh the takes before choosing a picture.');
  const editorial = payload.editorial;
  if (!editorial || typeof editorial.revision !== 'string') throw new Error('Update H3 to a version with revision-checked final-cut saves.');
  if (editorial.revision !== command.editorial_revision) throw new Error('The saved cut changed. Refresh the takes before applying this choice.');
  const alternate = command.take_revision === base.revision ? null : payload.revisions?.find(item => item.scene === command.scene && item.revision === command.take_revision);
  if (command.take_revision !== base.revision && (!alternate?.ready || alternate.scene_id !== base.scene_id || alternate.take_kind !== 'editorial_alternate' || alternate.alternate_of_revision !== base.revision)) throw new Error('This picture alternate does not belong to the active checkpoint.');
  const replacements = (editorial.replacements || []).filter(item => item.scene !== base.scene && item.scene_id !== base.scene_id);
  if (alternate) replacements.push({ scene: base.scene, scene_id: base.scene_id, base_revision: base.revision, alternate_revision: alternate.revision, media_mode: 'picture_only' });
  return { ...editorial, run_name: command.project, base_revision: editorial.revision, replacements };
}

// Match H3's chapter boundaries; its own lineage and activation helpers decide
// whether a branch can be activated. Never infer ancestry from dependencies.
export function chapterRange(payload, selected) {
  const maximum = Math.max(1, ...(payload.scenes || []).map(item => Number(item.scene) || 0), ...(payload.editorial?.scene_order || []).map(item => Number(item.scene) || 0), ...(payload.revisions || []).map(item => Number(item.scene) || 0));
  const chapters = [...(payload.editorial?.chapters || [])].sort((a, b) => a.start_scene - b.start_scene);
  const index = chapters.findLastIndex(item => selected.scene >= item.start_scene);
  if (index < 0) return { title: chapters.length ? 'Unassigned' : 'All scenes', start: 1, end: chapters.length ? chapters[0].start_scene - 1 : maximum };
  return { title: chapters[index].title || `Chapter ${index + 1}`, start: chapters[index].start_scene, end: chapters[index + 1] ? chapters[index + 1].start_scene - 1 : maximum };
}
export async function checkpointStamp(payload) {
  // Include the editorial revision and full graph evidence, not just active
  // pointers, so a preview cannot silently authorize a different branch.
  // This stays in the parent adapter's single outstanding ticket. Comparing
  // serialized evidence works on plain HTTP ComfyUI hosts without Web Crypto.
  return JSON.stringify([payload.working_branch_id, payload.graph_hash, payload.editorial, payload.scenes, payload.revisions, payload.checkpoints]);
}
export function checkpointImpact(payload, command, native) {
  const selected = payload.revisions?.find(item => item.scene === command.scene && item.revision === command.take_revision);
  if (!selected || selected.scene_id !== command.scene_id) throw new Error('This checkpoint is no longer available. Refresh the takes.');
  const scope = chapterRange(payload, selected);
  const mode = native.checkpointActivationMode(payload, selected, scope);
  if (!['activate', 'rollback'].includes(mode)) throw new Error(mode === 'current' ? 'This checkpoint branch is already active.' : 'H3 cannot activate this lineage. Inspect its dependencies in the native checkpoint manager.');
  const lineage = native.checkpointRevisionLineage(payload, selected, scope);
  const restored = lineage.map(item => payload.revisions.find(record => record.scene === item.scene && record.revision === item.revision));
  if (restored.some(item => !item?.ready || item.take_kind === 'editorial_alternate')) throw new Error('The selected lineage has an unavailable checkpoint.');
  const active = payload.revisions.filter(item => (item.active || item.pointer_active) && item.take_kind !== 'editorial_alternate');
  const changed = restored.filter(item => !active.some(current => current.scene === item.scene && current.revision === item.revision));
  const retired = active.filter(item => item.scene > selected.scene && item.scene <= scope.end);
  const changedScenes = new Set([...changed, ...retired].map(item => item.scene));
  const outsideDependents = active.filter(item => (item.scene < scope.start || item.scene > scope.end) && (item.dependencies || []).some(dep => changedScenes.has(dep.scene) && !lineage.some(next => same(next, { scene: dep.scene, revision: dep.revision }))));
  return { mode, scope, lineage, changed, retired, outsideDependents, restored };
}
