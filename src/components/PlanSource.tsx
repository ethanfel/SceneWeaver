import { useMemo } from 'react';
import { Link2 } from 'lucide-react';
import type { Workflow } from '../types';
import { planBranchSource, resolvePlanDocument, textConsumers } from '../../public/integrations/plan-source.mjs';
import { nodeTitle } from '../lib/workflow';

export function PlanSource({ workflow, planId, inspect, bridgeReady = true }: { workflow: Workflow; planId: string; inspect: (id: string) => void; bridgeReady?: boolean }) {
  const source = useMemo(() => resolvePlanDocument(workflow.prompt, planId), [workflow.prompt, planId]);
  const branch = useMemo(() => planBranchSource(workflow.prompt, planId), [workflow.prompt, planId]);
  const consumers = useMemo(() => textConsumers(workflow.prompt, source), [workflow.prompt, source]);
  if (!planId || bridgeReady && source.status === 'resolved' && source.editable !== false && branch.id && source.nodeId === planId && source.widget === 'plan_json' && !source.fallback) return null;
  const id = source.nodeId || source.path.at(-1) || planId;
  const title = workflow.prompt[id] ? nodeTitle(id, workflow.prompt[id]) : id;
  return <div className={`plan-source ${source.status}`} aria-label="Plan text source">
    <strong><Link2 size={12}/>{!bridgeReady ? 'Refresh connected-text support' : source.status !== 'resolved' ? 'Runtime Plan is unknown' : source.editable === false ? 'Plan text is read-only' : source.fallback ? 'Using Plan fallback' : source.nodeId === planId ? 'Plan text override' : 'Connected Plan text'}</strong>
    {!bridgeReady && <p>Refresh the ComfyUI tab and reopen SceneWeaver before editing this connected Plan.</p>}
    {source.status !== 'resolved' ? <p>{source.reason}</p> : <p>{source.fallback ? 'The optional text input is blank, so H3 uses the fallback document.' : `Scene edits target ${title} · ${source.widget}.`}{source.editable === false && ' This source is read-only.'}</p>}
    {consumers.length > 1 && <p>Shared source · {consumers.length} consumers. Applying a draft will show every affected input for review.</p>}
    {!branch.id && <p>{branch.reason}</p>}
    <button onClick={() => inspect(id)}>Inspect text source</button>
  </div>;
}
