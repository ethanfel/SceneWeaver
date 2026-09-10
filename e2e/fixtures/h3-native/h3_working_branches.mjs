// The runtime contract exposes both identity and request-path helpers.
export function workingBranchId(value) { return value?.working_branch_id || 'main'; }
export function branchRequestPath(path, id = 'main') { return id === 'main' ? path : `${path}${path.includes('?') ? '&' : '?'}branch_id=${encodeURIComponent(id)}`; }
