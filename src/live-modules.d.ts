declare module '*bridge-core.mjs' {
  import type { LiveSnapshot, WidgetEdit } from './types';
  import type { Workflow } from './types';
  export const PROTOCOL: string;
  export function diffInputs(base: LiveSnapshot, draft: Workflow): WidgetEdit[];
  export function rebaseDraft(base: LiveSnapshot, next: LiveSnapshot, draft: Workflow): { conflicts: string[]; draft: Workflow };
}
