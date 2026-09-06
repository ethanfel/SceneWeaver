import { describe, expect, it } from 'vitest';
import type { LiveSnapshot } from '../types';
import { draftScope, parseSavedDraft, recoverDraft, savedDraft } from './drafts';
import { liveWorkflow } from './live';
const snapshot: LiveSnapshot = { binding: 'session-1', workflowId: 'graph1', workflowKey: 'workflows/Film.json', name: 'Film.json', revision: 1, nodes: { plan: { class_type: 'MiniMaxH3ChainPlan', title: 'Plan', mode: 0, inputs: { run_name: 'film', plan_json: '{"shots":[]}', seed: '18446744073709551615', ownership_json: 'private-proof' }, editable: ['plan_json', 'seed', 'ownership_json'] } } };
describe('live draft recovery', () => {
  it('scopes edits to the server, workflow identity, Plan and original project', () => {
    const scope = draftScope('http://comfy:8188', snapshot, 'plan');
    expect(draftScope('http://comfy:8188/', { ...snapshot, binding: 'new-session' }, 'plan')).toBe(scope);
    expect(draftScope('http://other:8188', snapshot, 'plan')).not.toBe(scope);
    expect(draftScope('http://comfy:8188', { ...snapshot, workflowKey: 'workflows/Other.json' }, 'plan')).not.toBe(scope);
    const renamed = structuredClone(snapshot); renamed.nodes.plan.inputs.run_name = 'other-project';
    expect(draftScope('http://comfy:8188', renamed, 'plan')).not.toBe(scope);
  });
  it('stores only editable deltas, excludes ownership and preserves exact seeds', () => {
    const draft = liveWorkflow(snapshot); draft.prompt.plan.inputs = { ...draft.prompt.plan.inputs, seed: '18446744073709551614', ownership_json: 'different-proof' };
    const record = savedDraft('scope', snapshot, draft), serialized = JSON.stringify(record);
    expect(record.edits).toEqual([{ node: 'plan', widget: 'seed', before: '18446744073709551615', after: '18446744073709551614', class_type: 'MiniMaxH3ChainPlan' }]);
    expect(serialized).not.toContain('proof'); expect(serialized).not.toContain('shots');
    expect(parseSavedDraft(serialized, 'scope')).toEqual(record);
    expect(() => parseSavedDraft(serialized, 'different-scope')).toThrow();
  });
  it('reports newer remote values and refuses to restore removed or repurposed widgets', () => {
    const draft = liveWorkflow(snapshot); draft.prompt.plan.inputs = { ...draft.prompt.plan.inputs, plan_json: 'Saved draft' };
    const record = savedDraft('scope', snapshot, draft), current = structuredClone(snapshot);
    current.nodes.plan.inputs.plan_json = 'Newer remote';
    const result = recoverDraft(current, record);
    expect(result.changed).toEqual(['plan.plan_json']); expect(result.draft.prompt.plan.inputs.plan_json).toBe('Saved draft');
    expect(current.nodes.plan.inputs.plan_json).toBe('Newer remote');
    current.nodes.plan.class_type = 'DifferentNode'; expect(recoverDraft(current, record).unavailable).toEqual(['plan.plan_json']);
  });
});
