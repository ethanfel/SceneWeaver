import { useState } from 'react';
import type { LiveResult, LiveSnapshot, Workflow } from '../types';
import { Modal } from './Controls';
import { nodeTitle } from '../lib/workflow';

type Props = { project: string; planId: string; branchId: string; studios: string[]; workflow: Workflow; snapshot?: LiveSnapshot | null; editable: boolean; scene: number; command: (action: string, options?: Record<string, unknown>) => Promise<LiveResult>; close: () => void };
export function BranchMenu(p: Props) {
  const [chosen, setChosen] = useState(''), [target, setTarget] = useState(''), [name, setName] = useState('');
  const [fork, setFork] = useState(false), [newSeeds, setNewSeeds] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<{ operation: string; options: Record<string, unknown>; text: string; revision: number } | null>(null);
  const studio = p.studios.includes(chosen) ? chosen : p.studios.length === 1 ? p.studios[0] : '';
  const observed = p.snapshot?.branchControls?.[studio];
  const state = observed?.run_name === p.project && observed.selected === p.branchId ? observed : undefined;
  const blocked = busy || !p.editable || !state?.available || state.busy;
  const ready = !blocked && state?.ready && !state.pending;
  const active = state?.branches.find(item => item.id === state.selected);
  const run = async (operation: string, options: Record<string, unknown> = {}) => {
    if (!state || blocked) return;
    setBusy(true); setMessage(''); setConfirmation(null);
    try {
      const result = await p.command('branch-command', { project: p.project, plan: p.planId, studio, branch_id: p.branchId, branch_revision: state.revision, operation, options });
      setMessage(result.warning || (operation === 'save' ? 'Saved to branch. The workflow file has its own Save action.' : 'Native branch action completed.'));
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  };
  const confirm = (operation: string, text: string, options: Record<string, unknown> = {}) => state && setConfirmation({ operation, options, text, revision: state.revision });
  return <Modal title="Working branches" onClose={p.close}><div className="modal-body branch-menu">
    <p>Branch saves store H3 prompts, Plan settings and supported policy inputs. Switching loads those settings into the attached workflow. The project default is a separate selection.</p>
    {p.studios.length > 1 && <label className="field"><span>Native Plan Studio</span><select aria-label="Native Plan Studio" value={studio} onChange={e => { setChosen(e.target.value); setConfirmation(null); }}><option value="">Choose the Studio to control</option>{p.studios.map(id => <option key={id} value={id}>{nodeTitle(id, p.workflow.prompt[id])}</option>)}</select></label>}
    {!state && <p className="notice">{!p.studios.length ? 'Connect a Plan Studio to this authoring Plan to manage working branches.' : !studio ? 'Choose the associated Plan Studio.' : 'This Studio has no current native branch command interface. Update H3 with the branch integration and refresh ComfyUI.'}</p>}
    {state && <>
      <div className="branch-state"><strong>{active?.name || p.branchId}</strong><span>{state.conflict || state.pending ? 'Branch needs review' : state.dirty === true ? 'Applied edits · not saved to branch' : state.dirty === false ? 'Saved to branch' : 'Branch save state not yet observed'}</span><small>Project default: {state.branches.find(item => item.id === state.default_branch)?.name || state.default_branch}</small></div>
      {!state.available && <p className="notice">{state.reason}</p>}
      {!p.editable && <p className="notice">Apply or recover the SceneWeaver draft and reconnect the intended workflow before using branch actions.</p>}
      {state.conflict && <p className="notice">{state.conflict}</p>}
      {state.draft_available && <p className="notice">A native Studio recovery draft is available. Restore it or reload the saved branch before saving.</p>}
      {state.error && <p className="notice">{state.error}</p>}
      {state.pending && <p className="notice">Pending {state.pending.action} · {state.pending.run_name} · {state.branches.find(item => item.id === state.pending?.branch_id)?.name || state.pending.branch_id}. Retry reconciles that same native request. {state.pending.run_name !== p.project && 'Return to that project before retrying.'}</p>}
      {state.draft_status && <p className="hint">{state.draft_status}</p>}
      <div className="project-actions"><button disabled={!ready || !!state.conflict || state.draft_available} onClick={() => void run('save')}>Save branch</button><button disabled={blocked || !!state.pending} onClick={() => void run('refresh')}>Refresh branches</button>{state.pending && <button disabled={blocked || state.pending.run_name !== p.project} onClick={() => void run('retry')}>Retry pending operation</button>}</div>
      <label className="field"><span>Open branch</span><select aria-label="Open branch" value={target} onChange={e => { setTarget(e.target.value); setConfirmation(null); }}><option value="">Choose a saved branch</option>{state.branches.filter(item => item.id !== p.branchId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="project-actions"><button disabled={!ready || !target || !!state.conflict || state.draft_available} onClick={() => confirm('switch', 'Save the current branch, then load the selected branch’s prompts, Plan settings and policies into this workflow.', { target })}>Save &amp; switch</button><button disabled={!ready || !target} onClick={() => confirm('switch', 'Open the saved target branch. Native Studio keeps the current prompts, settings and pending cut edits in browser recovery without publishing them.', { target, save: false })}>Open saved without saving</button></div>
      <div className="branch-create"><label className="field"><span>New branch name</span><input aria-label="New branch name" maxLength={120} value={name} onChange={e => setName(e.target.value)}/></label><label><input type="checkbox" checked={fork} onChange={e => setFork(e.target.checked)}/>Fork saved clips through scene {p.scene}</label><label><input type="checkbox" checked={newSeeds} onChange={e => setNewSeeds(e.target.checked)}/>Generate new scene seeds</label><p className="hint">{fork ? 'H3 validates the saved prefix and preserves its checkpoint lineage.' : 'An empty branch copies the full Plan and references with no generated clips.'}</p><button disabled={!ready || !name.trim() || state.draft_available && !state.conflict || fork && (!!state.conflict || state.draft_available)} onClick={() => confirm('create', `${state.conflict ? 'Keep these edits in a new empty branch.' : 'Save the current branch, then create and open the new branch.'} ${newSeeds ? 'New uint64 seeds will be assigned to its scenes.' : 'Existing scene seeds will be preserved.'}`, { name: name.trim(), through_scene: fork ? p.scene : 0, new_seeds: newSeeds })}>Create branch</button></div>
      <div className="project-actions"><button disabled={!ready} onClick={() => confirm('reload', 'Reload this branch’s saved settings. Native Studio preserves current local edits in browser recovery.')}>Reload saved branch</button>{state.draft_available && <button disabled={!ready} onClick={() => confirm('restore-draft', 'Restore the native Studio recovery draft into the current workflow. Saved branch authoring remains separate.')}>Restore native draft</button>}<button disabled={!ready || state.default_branch === p.branchId || !!state.conflict || state.draft_available} onClick={() => confirm('default', 'Save this branch and make it the project default. Other open workflows retain their own branch selection.')}>Make project default</button></div>
      {confirmation && <div className="branch-confirmation"><p>{confirmation.text}</p>{confirmation.revision !== state.revision && <p>Branch state changed. Review the action again before continuing.</p>}<div className="project-actions"><button onClick={() => setConfirmation(null)}>Cancel</button><button className="primary" disabled={!ready || confirmation.revision !== state.revision} onClick={() => void run(confirmation.operation, confirmation.options)}>Confirm branch action</button></div></div>}
    </>}
    {message && <p role="status">{message}</p>}
  </div></Modal>;
}
