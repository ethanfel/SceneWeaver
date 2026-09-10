// Test double for native parent-lineage traversal and activation eligibility.
export function checkpointRevisionLineage(payload, selected, scope) {
  const result = []; let item = selected;
  while (item && item.scene >= scope.start) {
    result.unshift({ scene: item.scene, revision: item.revision });
    if (item.scene === scope.start) break;
    item = payload.revisions.find(next => next.scene === item.parent?.scene && next.revision === item.parent?.revision);
  }
  return result.length === selected.scene - scope.start + 1 ? result : [];
}
export function checkpointActivationMode(payload, selected, scope) {
  if (!selected?.ready || selected.take_kind === 'editorial_alternate') return 'disabled';
  const lineage = checkpointRevisionLineage(payload, selected, scope);
  if (!lineage.length) return 'disabled';
  if (lineage.some(item => !payload.revisions.find(next => item.scene === next.scene && item.revision === next.revision)?.active)) return 'activate';
  return payload.revisions.some(item => item.active && item.scene > selected.scene && item.scene <= scope.end) ? 'rollback' : 'current';
}

export { checkpointLocalSelectionJson } from './h3_checkpoint_selection_native.mjs';
