import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdapter} from '../public/integrations/companion-client.mjs';

function fixture() {
  const plan={id:'plan',type:'MiniMaxH3ChainPlan',widgets:[{name:'run_name',value:'film'},{name:'plan_json',value:'{"shots":[{"id":"one"}]}'}],inputs:[]};
  const studio={id:'studio',type:'MiniMaxH3ChainPlanStudio',widgets:[],inputs:[{name:'plan',link:1}]};
  const state={version:1,available:true,run_name:'film',selected:'main',revision:1};
  const calls=[];
  studio._h3BranchCommands={version:1,owner:plan,snapshot:()=>({...state}),command:async(...args)=>{calls.push(args);return {state};}};
  const graph={id:'graph',_nodes:[plan,studio,{id:'assets',type:'MiniMaxH3ProjectAssetManager',widgets:[{name:'run_name',value:'film'}],inputs:[]}],links:{1:{origin_id:'plan',origin_slot:0}}};
  const app={graph}, queue={queue_running:[],queue_pending:[]};
  const api={fetchApi:async path=>{assert.equal(path,'/queue');return {ok:true,json:async()=>queue};}};
  const adapter=createAdapter(app,api), before=adapter.snapshot();
  const command={action:'branch-command',binding:before.binding,revision:before.revision,plan:'plan',studio:'studio',project:'film',branch_id:'main',branch_revision:1,operation:'save'};
  return {adapter,app,api,queue,state,plan,studio,calls,command};
}
test('native branch commands use the exact bound Studio and do not manufacture HTTP branch writes',async()=>{
  const f=fixture();const result=await f.adapter.command(f.command);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'save');assert.equal(result.data,f.state);
  assert.deepEqual(f.calls[0][2],{run_name:'film',selected:'main',revision:1});
  assert.equal(f.adapter.snapshot().branchControls.studio.version,1);
});
test('wrong owner, stale native state and busy queues block branch commands',async()=>{
  for(const mutate of [f=>f.studio._h3BranchCommands.owner={},f=>f.state.revision=2,f=>f.queue.queue_running.push(['running'])]){
    const f=fixture();mutate(f);
    await assert.rejects(f.adapter.command(f.command));assert.equal(f.calls.length,0);
  }
});
test('a connected text source cannot be silently overwritten by native branch restoration',async()=>{
  const f=fixture();f.plan.inputs.push({name:'plan_json_input',link:2});
  f.app.graph.links[2]={origin_id:'text',origin_slot:0};
  f.app.graph._nodes.push({id:'text',type:'PrimitiveStringMultiline',widgets:[{name:'value',value:f.plan.widgets[1].value}],inputs:[]});
  const current=f.adapter.snapshot();f.command.revision=current.revision;
  await assert.rejects(f.adapter.command(f.command),/Connected sources/);assert.equal(f.calls.length,0);
});
test('the native continuation guard rejects a different ComfyUI workflow after an await',async()=>{
  const f=fixture();f.studio._h3BranchCommands.command=async(_action,_args,_expected,assertCurrent)=>{
    f.app.graph={id:'other',_nodes:[],links:{}};
    assertCurrent();throw Error('Must not continue');
  };
  await assert.rejects(f.adapter.command(f.command),error=>error.outcome==='uncertain' && /workflow/.test(error.message));
});
test('retrying a native pending operation requires returning to its original project',async()=>{
  const f=fixture();f.state.pending={run_name:'other-film',action:'create'};f.command.operation='retry';
  await assert.rejects(f.adapter.command(f.command),/pending operation’s project/);assert.equal(f.calls.length,0);
});
