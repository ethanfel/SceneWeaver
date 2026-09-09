declare module '*branches-core.mjs' {
  export function workingBranch(inputs?: Record<string, unknown>): string;
  export function branchPath(path: string, id?: string): string;
  export function verifyBranch<T extends { working_branch_id?: string }>(payload: T, id?: string): T;
}
declare module '*bridge-core.mjs' {
  import type { LiveSnapshot, WidgetEdit } from './types';
  import type { Workflow } from './types';
  export const PROTOCOL: string;
  export function diffInputs(base: LiveSnapshot, draft: Workflow): WidgetEdit[];
  export function rebaseDraft(base: LiveSnapshot, next: LiveSnapshot, draft: Workflow): { conflicts: string[]; draft: Workflow };
}
