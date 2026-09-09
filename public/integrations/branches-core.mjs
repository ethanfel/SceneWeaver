// H3 nightly routes use explicit branch IDs; omission means Original, never
// the project's preferred branch. A malformed ID must not fall back to it.
export function workingBranch(inputs = {}) {
  let plan = {};
  try { plan = JSON.parse(String(inputs.plan_json || '{}')); } catch { /* Plan validation reports syntax separately. */ }
  const id = String(inputs.working_branch_id ?? plan?._branch_id ?? 'main');
  return id;
}
export function branchPath(path, id = 'main') {
  if (id !== 'main' && !/^[0-9a-f]{32}$/.test(id)) throw new Error('Invalid H3 working branch. Reload the Plan from ComfyUI.');
  return id === 'main' ? path : `${path}${path.includes('?') ? '&' : '?'}branch_id=${encodeURIComponent(id)}`;
}
export function verifyBranch(payload, id = 'main') {
  if ((payload.working_branch_id ?? 'main') !== id) throw new Error('H3 returned a different working branch. Refresh ComfyUI and reopen SceneWeaver; no Original clips were substituted.');
  return payload;
}
