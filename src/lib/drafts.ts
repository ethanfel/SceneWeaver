import type { LiveSnapshot, WidgetEdit, Workflow } from '../types';
import { diffInputs } from '../../public/integrations/bridge-core.mjs';
import { planBranchSource, resolvePlanDocument } from '../../public/integrations/plan-source.mjs';
import { effectiveRunName } from './h3';
import { liveWorkflow } from './live';

export const DRAFT_PREFIX = 'sceneweaver.live-draft.v1:';
export type SavedDraft = { version: 1; scope: string; name: string; updatedAt: string; edits: (WidgetEdit & { class_type: string })[] };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const scalar = (value: unknown) => ['string', 'boolean', 'number'].includes(typeof value) && (typeof value !== 'number' || Number.isFinite(value));
const privateWidget = /ownership|operation_json|catalog_json|api[_ -]?key|password|secret|access[_ -]?token/i;
export function draftScope(server: string, snapshot: LiveSnapshot, planId: string) {
  if (!snapshot.nodes[planId] || !snapshot.workflowId && !snapshot.workflowKey) return '';
  const workflow = liveWorkflow(snapshot);
  const branch = planBranchSource(snapshot.nodes, planId).id;
  if (!branch) return '';
  const source = resolvePlanDocument(snapshot.nodes, planId);
  const connected = source.nodeId !== planId || source.widget !== 'plan_json' || source.emptyOverride;
  const sourceScope = connected ? [source.nodeId, source.widget, source.input, source.path, source.emptyOverride?.path] : null;
  // Preserve existing Original backups, while isolating every named branch.
  return DRAFT_PREFIX + JSON.stringify([server.replace(/\/$/, ''), snapshot.workflowKey || snapshot.workflowId, snapshot.workflowId, planId, effectiveRunName(workflow.prompt, planId), ...(branch === 'main' ? [] : [branch]), ...(sourceScope ? [sourceScope] : [])]);
}
export function savedDraft(scope: string, base: LiveSnapshot, draft: Workflow): SavedDraft {
  return { version: 1, scope, name: base.name, updatedAt: new Date().toISOString(), edits: diffInputs(base, draft).filter(edit => !privateWidget.test(edit.widget)).map(edit => ({ ...edit, class_type: base.nodes[edit.node].class_type })) };
}
export function parseSavedDraft(value: string | null, scope: string): SavedDraft | null {
  if (!value) return null;
  const data = JSON.parse(value) as SavedDraft;
  if (data.version !== 1 || data.scope !== scope || typeof data.name !== 'string' || typeof data.updatedAt !== 'string' || !Array.isArray(data.edits) || !data.edits.length || data.edits.length > 200) throw new Error('This stored draft has an unsupported format.');
  const keys = new Set();
  for (const edit of data.edits) {
    const key = `${edit.node}:${edit.widget}`;
    if (keys.has(key) || !edit.node || !edit.class_type || typeof edit.widget !== 'string' || privateWidget.test(edit.widget) || !scalar(edit.before) || !scalar(edit.after)) throw new Error('This stored draft contains an unsupported widget edit.');
    keys.add(key);
  }
  return data;
}
export function recoverDraft(snapshot: LiveSnapshot, saved: SavedDraft) {
  const draft = liveWorkflow(snapshot), changed: string[] = [], unavailable: string[] = [];
  for (const edit of saved.edits) {
    const node = snapshot.nodes[edit.node], name = `${edit.node}.${edit.widget}`;
    if (!node || node.class_type !== edit.class_type || !node.editable.includes(edit.widget) || privateWidget.test(edit.widget)) { unavailable.push(name); continue; }
    if (!same(node.inputs[edit.widget], edit.before) && !same(node.inputs[edit.widget], edit.after)) changed.push(name);
    draft.prompt[edit.node].inputs = { ...draft.prompt[edit.node].inputs, [edit.widget]: edit.after };
  }
  return { draft, changed, unavailable };
}
