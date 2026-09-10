import { Link2 } from 'lucide-react';
import type { Workflow } from '../types';
import { resolvePlanBinding } from '../../public/integrations/binding-core.mjs';
import { nodeTitle } from '../lib/workflow';

export function WorkflowBinding({ workflow, planId, choosePlan }: { workflow: Workflow; planId: string; choosePlan: () => void }) {
  const binding = resolvePlanBinding(workflow.prompt, planId);
  const title = (id: string) => workflow.prompt[id] ? nodeTitle(id, workflow.prompt[id]) : id;
  return <details className={`workflow-binding ${binding.status}`}>
    <summary><Link2 size={13}/><strong>{binding.status === 'bound' ? 'Project binding verified' : !planId ? 'Select the production Plan' : 'Project binding needs attention'}</strong><span>{binding.project || 'No project bound'}</span></summary>
    <div className="binding-details">
      <dl><dt>Authoring Plan</dt><dd>{planId ? title(planId) : 'Choose a Plan in the scene bin.'}</dd><dt>Asset Carousel</dt><dd>{binding.managerId ? title(binding.managerId) : 'Not bound'}</dd><dt>Resolution</dt><dd>{binding.method === 'connection' ? binding.assetPath.map(title).join(' ← ') : binding.method === 'project-name' ? 'One active Carousel with the same project name' : 'Unresolved'}</dd><dt>Plan Studio</dt><dd>{binding.studioIds.map(title).join(', ') || 'No connected Studio'}</dd></dl>
      {binding.issues.map(issue => <p key={issue}>{issue}</p>)}
      {!planId && <button onClick={choosePlan}>Choose production Plan</button>}
    </div>
  </details>;
}
