// Capability markers used by the synthetic native adapter.
const document = { base_revision: '' };
const endpoint = '/minimax_h3_context_loop/editorial';
// Installed nightly capability: h3_working_branches.mjs and working_branch_id.

import { workingBranchId, branchRequestPath } from './h3_working_branches.mjs?v=test';

export { EDITORIAL_COMMAND_VERSION, editorialCommand } from './h3_editorial_commands.mjs';

import './h3_chain_plan_core.mjs?v=test';
