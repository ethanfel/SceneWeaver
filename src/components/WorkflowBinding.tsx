import { Link2 } from 'lucide-react';
import { useRef } from 'react';
import type { LiveSnapshot, Schemas, Workflow } from '../types';
import { resolvePlanBinding } from '../../public/integrations/binding-core.mjs';
import { productionRoles, ROLE_LABELS } from '../../public/integrations/workflow-roles.mjs';
import { planTaskCapabilities, unregisteredNodes } from '../../public/integrations/task-capabilities.mjs';
import { nodeTitle } from '../lib/workflow';

export function WorkflowBinding({ workflow, snapshot, schemas, planId, choosePlan, inspect: showInspector }: { workflow: Workflow; snapshot: LiveSnapshot; schemas: Schemas; planId: string; choosePlan: () => void; inspect: (id: string) => void }) {
  const panel = useRef<HTMLDetailsElement>(null);
  const inspect = (id: string) => { showInspector(id); if (panel.current) panel.current.open = false; };
  const binding = resolvePlanBinding(workflow.prompt, planId);
  const production = productionRoles(workflow.prompt, planId);
  const tasks = snapshot.capabilities?.taskVersion === 1 ? planTaskCapabilities(snapshot, planId).tasks : [];
  const diagnostics = snapshot.capabilities?.diagnostics;
  const unregistered = unregisteredNodes(snapshot, schemas);
  const title = (id: string) => workflow.prompt[id] ? nodeTitle(id, workflow.prompt[id]) : id;
  return <details ref={panel} className={`workflow-binding ${binding.status}`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (panel.current) panel.current.open = false; } }}>
    <summary><Link2 size={13}/><strong>{binding.status === 'bound' ? 'Project binding verified' : !planId ? 'Select the production Plan' : 'Project binding needs attention'}</strong><span>{binding.project || 'No project bound'}</span></summary>
    <div className="binding-details">
      <dl><dt>Authoring Plan</dt><dd>{planId ? title(planId) : 'Choose a Plan in the scene bin.'}</dd><dt>Asset Carousel</dt><dd>{binding.managerId ? title(binding.managerId) : 'Not bound'}</dd><dt>Resolution</dt><dd>{binding.method === 'connection' ? binding.assetPath.map(title).join(' ← ') : binding.method === 'project-name' ? 'One active Carousel with the same project name' : 'Unresolved'}</dd><dt>Plan Studio</dt><dd>{binding.studioIds.map(title).join(', ') || 'No connected Studio'}</dd></dl>
      {binding.issues.map(issue => <p key={issue}>{issue}</p>)}
      {!planId && <button onClick={choosePlan}>Choose production Plan</button>}
      {planId && <details className="production-roles"><summary>Connected production controls</summary><p>Connections identify the selected Plan’s controls. Multiple matches require a target; shared policies affect every listed Plan.</p><dl>{Object.entries(production.roles).map(([role, group]) => <div className="role-row" key={role}><dt>{ROLE_LABELS[role]}</dt><dd><span className={`role-status ${group.status}`}>{group.status === 'missing' ? 'No connected node' : group.status === 'multiple' ? 'Multiple targets' : group.status === 'shared' ? 'Shared across Plans' : group.status === 'bound' ? 'Connected' : 'Needs inspection'}</span>{group.nodes.map(node => <div key={node.nodeId}><button className="binding-node" onClick={() => inspect(node.nodeId)} title={`Inspect ${title(node.nodeId)}`}>{title(node.nodeId)} <small>#{node.nodeId}</small></button>{node.status === 'shared' && <small>Plans: {node.planIds.map(title).join(', ')}</small>}{node.note && <small>{node.note}</small>}</div>)}{group.issues.map(issue => <small key={issue}>{issue}</small>)}</dd></div>)}</dl></details>}
      {!!production.unassigned.length && <details className="unassigned-roles"><summary>{production.unassigned.length} workflow controls without a verified Plan association</summary><p>These belong to the whole workflow. They may be intentionally independent; they are not automatically assigned to this project.</p>{production.unassigned.map((node, i) => <div className="binding-issue" key={`${node.role}:${node.nodeId}:${i}`}><button className="binding-node" onClick={() => inspect(node.nodeId)}>{title(node.nodeId)} <small>#{node.nodeId}</small></button><small>{node.reason}</small></div>)}</details>}
      <details className="integration-capabilities"><summary>Integration capabilities</summary><p>Availability describes the installed command adapter. Native ownership, queue, media, and revision checks still run when an action is requested.</p>{tasks.length ? <dl>{tasks.map(task => <div className="role-row" key={task.id}><dt>{task.label}</dt><dd><strong className={`task-status ${task.status}`}>{task.status === 'available' ? 'Available' : 'Unavailable'}</strong><small>{task.detail}</small></dd></div>)}</dl> : <p>Reopen SceneWeaver from ComfyUI to load task capability reporting.</p>}
        <p>Adapter: {diagnostics?.adapter || 'Not reported'} · ComfyUI: {diagnostics?.comfyVersion || 'Not reported'} · Frontend: {diagnostics?.frontendVersion || 'Not reported'} · H3: {diagnostics?.h3Version || 'Not reported'}</p>
        {diagnostics && <details><summary>Discovery evidence</summary>{diagnostics.checks.map(check => <p key={check.id}><strong>{check.id} · {check.status}</strong><br/>{check.detail}</p>)}</details>}
        {!!unregistered.length && <div className="binding-issue"><strong>Node types absent from server schemas</strong><p>These may need an installed node pack or a frontend-only adapter. Native queue validation remains authoritative.</p>{unregistered.map(node => <div key={node.nodeId}><button className="binding-node" onClick={() => inspect(node.nodeId)}>{node.classType} <small>#{node.nodeId}</small></button></div>)}</div>}
      </details>
    </div>
  </details>;
}
