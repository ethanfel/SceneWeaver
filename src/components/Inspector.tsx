import { ArrowDownLeft, ArrowLeft, ArrowRight, Braces, Copy, Link2, Plus, Trash2, Upload } from 'lucide-react';
import type { Plan, Schemas, Shot, Value, Workflow } from '../types';
import { inputSpecs, isLink, nodeTitle } from '../lib/workflow';
import { promptText, rawFrames } from '../lib/h3';
import { Field } from './Controls';
import { comfy } from '../lib/api';
import { PlanSource } from './PlanSource';
import { resolvePlanDocument } from '../../public/integrations/plan-source.mjs';

type Props = { workflow: Workflow; sourceBridgeReady: boolean; schemas: Schemas; plan: Plan | null; planId: string; selected: number; nodeId: string; tab: string; setTab: (tab: string) => void; updateInput: (id: string, key: string, value: Value) => void; updatePlan: (plan: Plan) => void; select: (index: number) => void; selectNode: (id: string) => void; editJson: () => void; report: (error: string) => void; connected: boolean };
export function Inspector(p: Props) {
  const node = p.workflow.prompt[p.nodeId], planNode = p.workflow.prompt[p.planId], shot = p.plan?.shots[p.selected];
  const source = resolvePlanDocument(p.workflow.prompt, p.planId);
  const patchShot = (patch: Partial<Shot>) => p.plan && p.updatePlan({ ...p.plan, shots: p.plan.shots.map((s, i) => i === p.selected ? { ...s, ...patch } : s) });
  const move = (direction: number) => {
    if (!p.plan) return;
    const shots = [...p.plan.shots], next = p.selected + direction;
    [shots[p.selected], shots[next]] = [shots[next], shots[p.selected]];
    p.updatePlan({ ...p.plan, shots }); p.select(next);
  };
  const addShot = (duplicate = false) => {
    if (!p.plan) return;
    const added: Shot = duplicate && shot ? { ...structuredClone(shot), id: `${shot.id || 'scene'}_${crypto.randomUUID().slice(0, 6)}` } : { id: `scene_${crypto.randomUUID().slice(0, 6)}`, prompt: '' };
    const shots = [...p.plan.shots]; shots.splice(p.selected + 1, 0, added);
    p.updatePlan({ ...p.plan, shots }); p.select(p.selected + 1);
  };
  return <aside className="inspector panel">
    <div className="panel-title"><span>Inspector</span><span className="eyebrow">{p.tab === 'scene' ? 'SCENE' : 'WORKFLOW'}</span></div>
    <div className="tabs"><button className={p.tab === 'scene' ? 'active' : ''} onClick={() => p.setTab('scene')}>Scene</button><button className={p.tab === 'node' ? 'active' : ''} onClick={() => p.setTab('node')}>Node settings</button></div>
    <div className="inspector-body">
      {p.tab === 'scene' && <PlanSource workflow={p.workflow} planId={p.planId} inspect={p.selectNode} bridgeReady={p.sourceBridgeReady}/>}
      {p.tab === 'scene' && p.plan && planNode ? <fieldset className="scene-fields" disabled={!p.sourceBridgeReady || source.status !== 'resolved' || source.editable === false}>
        <div className="inspector-heading"><span className="section-label">{shot ? `SCENE ${String(p.selected + 1).padStart(2, '0')}` : 'SCENE PLAN'}</span><button className="icon-button" onClick={p.editJson} aria-label="Edit plan JSON"><Braces size={16}/></button></div>
        {shot ? <>
          <Field label="Scene ID" value={shot.id || ''} onChange={value => patchShot({ id: String(value) })} />
          <label className="field prompt-field"><span>Scene direction <span className="muted">{promptText(shot.prompt).length} characters</span></span><textarea aria-label="Scene direction" rows={11} placeholder="Describe what happens in this scene…" value={promptText(shot.prompt)} onChange={e => patchShot({ prompt: Array.isArray(shot.prompt) ? e.target.value.split('\n') : e.target.value })} /></label>
          <div className="section-label">GENERATION</div>
          <div className="field-pair"><Field label="Raw frames" value={rawFrames(shot, p.plan, planNode.inputs)} spec={['INT', { min: 5, max: 3592, step: 17 }]} onChange={value => { const next = { ...shot, length: Number(value) }; delete next.frames; delete next.duration_seconds; patchShot({ ...next, frames: undefined, duration_seconds: undefined }); }} /><Field label="Steps" value={shot.steps ?? Number(p.plan.defaults?.steps ?? planNode.inputs.default_steps ?? 20)} spec={['INT', { min: 1, max: 10000 }]} onChange={value => patchShot({ steps: Number(value) })}/></div>
          <small className="hint">H3 frame grid: 5 + 17k at 24 fps. Delivered clips may be shorter after continuity trimming.</small>
          <Field label="Scene seed" value={shot.seed ?? ''} onChange={value => patchShot({ seed: String(value) || undefined })}/><small className="hint">Leave blank to inherit a deterministic scene seed.</small>
          <div className="scene-actions"><button onClick={() => move(-1)} disabled={p.selected === 0} title="Move scene earlier"><ArrowLeft size={14}/></button><button onClick={() => move(1)} disabled={p.selected >= p.plan.shots.length - 1} title="Move scene later"><ArrowRight size={14}/></button><button onClick={() => addShot(true)}><Copy size={14}/>Duplicate</button><button aria-label="Delete scene" onClick={() => { p.updatePlan({ ...p.plan!, shots: p.plan!.shots.filter((_, i) => i !== p.selected) }); p.select(Math.max(0, p.selected - 1)); }}><Trash2 size={14}/></button></div>
        </> : <button onClick={() => addShot()}><Plus size={15}/>Add first scene</button>}
        <details className="shared-direction"><summary>Shared direction</summary><textarea aria-label="Shared direction" rows={6} placeholder="Identity, setting, and continuity across every scene…" value={promptText(p.plan.prompt_prefix ?? p.plan.global_prompt)} onChange={e => p.updatePlan({ ...p.plan!, prompt_prefix: e.target.value })}/></details>
        <button className="subtle-button" onClick={() => { p.selectNode(p.planId); p.setTab('node'); }}><ArrowDownLeft size={15}/>All plan settings</button>
      </fieldset> : p.tab === 'node' && node ? <>
        <div className="node-inspector-name"><span className="section-label">NODE {p.nodeId}</span><h3>{nodeTitle(p.nodeId, node)}</h3><small>{node.class_type}</small></div>
        {Object.entries(node.inputs).map(([key, value]) => {
          const spec = inputSpecs(p.schemas[node.class_type]).find(([name]) => key === name)?.[1];
          return isLink(value) ? <div className="connection-field" key={key}><span>{key.replaceAll('_', ' ')}</span><button onClick={() => p.selectNode(value[0])}><Link2 size={12}/>{p.workflow.prompt[value[0]] ? nodeTitle(value[0], p.workflow.prompt[value[0]]) : `Missing node ${value[0]}`}<small>out {value[1]}</small></button></div>
            : <fieldset className="node-widget-field" disabled={!p.sourceBridgeReady || Array.isArray(node._meta?.editable) && !node._meta.editable.includes(key)} key={key}><Field label={key} value={value} spec={spec} onChange={v => p.updateInput(p.nodeId, key, v)}/>{key === 'image' && node.class_type === 'LoadImage' && <label className="button file-label"><Upload size={13}/>Upload image<input type="file" accept="image/*" disabled={!p.connected} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { const form = new FormData(); form.append('image', file); const data = await comfy<{ name: string; subfolder?: string }>('/upload/image', { method: 'POST', body: form }); p.updateInput(p.nodeId, key, [data.subfolder, data.name].filter(Boolean).join('/')); } catch (error) { p.report(String(error)); } }}/></label>}</fieldset>;
        })}
      </> : <div className="empty-small">{p.tab === 'scene' ? 'Select an H3 Plan node to edit scenes.' : 'Select a workflow node to inspect all of its inputs.'}</div>}
    </div>
  </aside>;
}
