import { useEffect, useState } from 'react';
import type { LiveResult, WorkingBranch, Workflow } from '../types';
import { comfy, H3 } from '../lib/api';

export function BranchStatus({ project, planId, branchId, connected, server, supported, workflow, command, editable }: { project: string; planId: string; branchId: string; connected: boolean; server: string; supported?: boolean; workflow: Workflow; command: (action: string, options?: Record<string, unknown>) => Promise<LiveResult>; editable: boolean }) {
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
  const name = current?.branches.find(item => item.id === branchId)?.name || (branchId === 'main' ? 'Original' : branchId.slice(0, 8));
  const studio = workflow.prompt[planId]?.class_type === 'MiniMaxH3ChainPlanStudio' ? planId : Object.entries(workflow.prompt).find(([, node]) => node.class_type === 'MiniMaxH3ChainPlanStudio' && Array.isArray(node.inputs.plan) && node.inputs.plan[0] === planId)?.[0];
  return <div className="branch-status" aria-label="Working branch"><span>Working branch: <strong>{name}</strong></span><span>Follows the selected Plan in ComfyUI</span>{editable && studio && <button onClick={() => void command('focus', { node: studio }).catch(error => setValue({ scope, branches: current?.branches || [], error: String(error) }))}>Open Plan Studio</button>}{current?.error && <span role="alert">{current.error}</span>}</div>;
}
