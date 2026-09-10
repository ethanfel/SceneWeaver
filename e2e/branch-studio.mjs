// Synthetic mounted Studio callbacks with the actual native branch controller.
import {app} from '/scripts/app.js';
import {StudioBranches, BranchDrafts, authoringSignature} from '/extensions/h3-test/h3_working_branches.mjs';
import {studioBranchCommands} from '/extensions/h3-test/h3_branch_commands.mjs';
const graph=app.graph, plan=graph._nodes.find(node => node.id==='1700');
const widget=(name) => plan.widgets.find(item => item.name===name);
const capture=() => ({plan_json:widget('plan_json').value,width:widget('width')?.value});
const branch='1'.repeat(32), second=JSON.parse(widget('plan_json').value);
second._branch_id=branch; second.shots[0].prompt='Saved second branch direction';
const disk=new Map([['main',{id:'main',name:'Original',revision:'r1',authoring:capture()}],[branch,{id:branch,name:'Second cut',revision:'r2',authoring:{...capture(),plan_json:JSON.stringify(second)}}]]);
const writes=[], receipts=new Map(); let sequence=2;
const studio={id:'branch-studio',type:'MiniMaxH3ChainPlanStudio',title:'Production Studio',graph,widgets:[{name:'working_branch_id',value:'main'}],inputs:[{name:'plan',link:89009}]};
graph.links[89009]={origin_id:'1700',origin_slot:0}; graph._nodes.push(studio);
const controller=new StudioBranches({capture,flush:async()=>{},changed(){},
  drafts:new BranchDrafts(localStorage,'browser-branch-fixture'),
  apply:async record => {
    if(window.branchApplyFailure)throw Error('Native policy callback failed');
    const doc=JSON.parse(record.authoring.plan_json);
    if(record.id==='main')delete doc._branch_id;else doc._branch_id=record.id;
    widget('plan_json').value=JSON.stringify(doc);widget('plan_json').callback?.();
    studio.widgets[0].value=record.id;
  },
  request:async body => {
    if(body.action==='list')return structuredClone({branches:[...disk.values()],default_branch:window.branchDefault || 'main'});
    if(body.action==='load')return structuredClone(disk.get(body.branch_id));
    writes.push(structuredClone(body));
    if(receipts.has(body.operation_id))return structuredClone(receipts.get(body.operation_id));
    if(body.action==='save' && disk.get(body.branch_id).revision!==body.revision)throw Object.assign(Error('Saved branch changed in another workflow'),{status:400});
    if(body.action==='default'){window.branchDefault=body.branch_id;return {default_branch:body.branch_id};}
    const id=body.action==='create'?body.operation_id:body.branch_id;
    const record={id,name:body.name || disk.get(id).name,revision:`r${++sequence}`,authoring:structuredClone(body.authoring)};
    disk.set(id,record);receipts.set(body.operation_id,record);
    if(body.action==='create' && window.branchLoseResponse)throw Error('Response lost');
    return structuredClone(record);
  },
});
await controller.refresh('sceneweaver_first_film');controller.observe();
studio._h3BranchCommands=studioBranchCommands(controller,{owner:()=>plan});
window.branchFixture={controller,disk,writes,studio,signature:authoringSignature};
setInterval(()=>controller.observe(),100);
