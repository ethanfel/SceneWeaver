import { useEffect, useState } from 'react';
import type { LiveResult, LiveSnapshot, WorkingBranch, Workflow } from '../types';
import { BranchMenu } from './BranchMenu';
import { comfy, H3 } from '../lib/api';
import { resolvePlanBinding } from '../../public/integrations/binding-core.mjs';

export function BranchStatus({ project, planId, branchId, connected, server, supported, workflow, command, editable, snapshot, scene }: { project: string; planId: string; branchId: string; connected: boolean; server: string; supported?: boolean; workflow: Workflow; command: (action: string, options?: Record<string, unknown>) => Promise<LiveResult>; editable: boolean; snapshot?: LiveSnapshot | null; scene: number }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<{ scope: string; branches: WorkingBranch[]; error?: string }>({ scope: '', branches: [] });
  const scope = `${server}:${project}:${branchId}`;
  useEffect(() => {
    if (!connected || !supported) return;
    const controller = new AbortController();
    const read = async () => {
      try {
        const data = await comfy<{ branches: WorkingBranch[] }>(`${H3}/working-branches?${new URLSearchParams({ run_name: project })}`, { signal: controller.signal });
        if (!controller.signal.aborted) setValue({ scope, branches: data.branches || [] });
      } catch (error) { if (!controller.signal.aborted) setValue({ scope, branches: [], error: String(error) }); }
    };
    void read(); const timer = setInterval(() => void read(), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [project, scope, connected, supported]);
  const current = value.scope === scope ? value : null;
  const name = current?.branches.find(item => item.id === branchId)?.name || (!branchId ? 'Unresolved' : branchId === 'main' ? 'Original' : branchId.slice(0, 8));
  const studios = resolvePlanBinding(workflow.prompt, planId).studioIds;
  const studio = studios.length === 1 ? studios[0] : undefined;
  const native = studio && snapshot?.branchControls?.[studio];
  const nativeName = native && native.run_name === project && native.selected === branchId ? native.branches.find(item => item.id === branchId)?.name : '';
  return <><div className="branch-status" aria-label="Working branch"><span>Working branch: <strong>{nativeName || name}</strong></span><span>Follows the selected Plan in ComfyUI</span><button onClick={() => setOpen(true)}>Branches</button>{editable && studio && <button onClick={() => void command('focus', { node: studio }).catch(error => setValue({ scope, branches: current?.branches || [], error: String(error) }))}>Open Plan Studio</button>}{current?.error && <span role="alert">{current.error}</span>}</div>{open && <BranchMenu key={`${server}:${project}:${planId}`} project={project} planId={planId} branchId={branchId} studios={studios} workflow={workflow} snapshot={snapshot} editable={editable} scene={scene} command={command} close={() => setOpen(false)}/>}</>;
}
