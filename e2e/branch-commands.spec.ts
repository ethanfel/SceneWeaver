import {test,expect,type Page} from '@playwright/test';
let target='';
test.beforeAll(async({request})=>{target=(await(await request.get('/api/connection')).json()).target;});
test.beforeEach(async({request})=>{await request.put('/api/connection',{data:{target}});await request.post('/comfy/test/reset');});
async function attach(page:Page,native=true){
  await page.goto(`${target}/test/live`);await page.waitForFunction(()=>Boolean((window as any).testComfy));
  if(native)await page.evaluate(async()=>{await import(/* @vite-ignore */ '/test/branch-studio.mjs');});
  const opening=page.waitForEvent('popup');await page.getByRole('button',{name:'Open companion'}).click();
  const companion=await opening;await expect(companion.getByText('Attached to live workflow',{exact:true})).toBeVisible();
  return companion;
}
async function menu(companion:Page){await companion.getByRole('button',{name:'Branches',exact:true}).click();return companion.getByRole('dialog',{name:'Working branches',exact:true});}
test('saves applied prompt edits to the native branch, then loads another branch',async({page,request})=>{
  const companion=await attach(page);
  await companion.getByRole('textbox',{name:'Scene direction',exact:true}).fill('Saved from SceneWeaver');
  await companion.getByRole('button',{name:'Apply to ComfyUI',exact:true}).click();
  await expect(companion.getByText('Attached to live workflow',{exact:true})).toBeVisible();
  const dialog=await menu(companion);
  await expect(dialog).toContainText('Applied edits · not saved to branch');
  await dialog.getByRole('button',{name:'Save branch',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('Saved to branch');
  expect(await page.evaluate(()=>JSON.parse((window as any).branchFixture.disk.get('main').authoring.plan_json).shots[0].prompt)).toBe('Saved from SceneWeaver');
  await dialog.getByRole('combobox',{name:'Open branch',exact:true}).selectOption('1'.repeat(32));
  await dialog.getByRole('button',{name:'Save & switch',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm branch action',exact:true}).click();
  await expect(companion.getByLabel('Working branch',{exact:true})).toContainText('Second cut');
  await dialog.getByRole('button',{name:'Close dialog'}).click();
  await expect(companion.getByRole('textbox',{name:'Scene direction',exact:true})).toHaveValue('Saved second branch direction');
  expect((await(await request.get('/comfy/test/state')).json()).submissions).toEqual([]);
});
test('blocks branch changes with an unapplied companion draft',async({page})=>{
  const companion=await attach(page);await companion.getByRole('textbox',{name:'Scene direction',exact:true}).fill('Keep local');
  const dialog=await menu(companion);await expect(dialog.getByRole('button',{name:'Save branch',exact:true})).toBeDisabled();
  await expect(dialog).toContainText('Apply or recover the SceneWeaver draft');
  expect(await page.evaluate(()=>(window as any).branchFixture.writes.length)).toBe(0);
});
test('creates and opens an empty native branch with preserved seeds',async({page})=>{
  const companion=await attach(page), dialog=await menu(companion);
  const before=await page.evaluate(()=>JSON.parse((window as any).branchFixture.disk.get('main').authoring.plan_json).shots.map((shot:any)=>shot.seed));
  await dialog.getByRole('textbox',{name:'New branch name'}).fill('Alternate direction');
  await dialog.getByRole('button',{name:'Create branch',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm branch action',exact:true}).click();
  await expect(companion.getByLabel('Working branch',{exact:true})).toContainText('Alternate direction');
  const body=await page.evaluate(()=>(window as any).branchFixture.writes.find((body:any)=>body.action==='create'));
  expect(body.through_scene).toBe(0);expect(JSON.parse(body.authoring.plan_json).shots.map((shot:any)=>shot.seed)).toEqual(before);
});
test('stale server authoring preserves the current branch and reports the native conflict',async({page})=>{
  const companion=await attach(page),dialog=await menu(companion);
  await page.evaluate(()=>{(window as any).branchFixture.disk.get('main').revision='remote-edit';});
  await dialog.getByRole('combobox',{name:'Open branch',exact:true}).selectOption('1'.repeat(32));
  await dialog.getByRole('button',{name:'Save & switch',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm branch action',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('Saved branch changed in another workflow');
  await expect(companion.getByLabel('Working branch',{exact:true})).toContainText('Original');
});
test('opening a saved branch without saving retains native recovery authoring',async({page})=>{
  const companion=await attach(page);
  await companion.getByRole('textbox',{name:'Scene direction',exact:true}).fill('Native recovery direction');
  await companion.getByRole('button',{name:'Apply to ComfyUI',exact:true}).click();
  await expect(companion.getByText('Attached to live workflow',{exact:true})).toBeVisible();
  const dialog=await menu(companion);await expect(dialog).toContainText('Applied edits · not saved to branch');
  await dialog.getByRole('combobox',{name:'Open branch',exact:true}).selectOption('1'.repeat(32));
  await dialog.getByRole('button',{name:'Open saved without saving',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm branch action',exact:true}).click();
  await expect(companion.getByLabel('Working branch',{exact:true})).toContainText('Second cut');
  const recovery=await page.evaluate(()=>(window as any).branchFixture.controller.drafts.read('sceneweaver_first_film','main'));
  expect(JSON.parse(recovery.authoring.plan_json).shots[0].prompt).toBe('Native recovery direction');
  expect(await page.evaluate(()=>(window as any).branchFixture.writes.length)).toBe(0);
});
test('older H3 remains inspectable and explains the missing native branch controller',async({page})=>{
  const companion=await attach(page,false),dialog=await menu(companion);
  await expect(dialog).toContainText('Connect a Plan Studio');
  await expect(dialog.getByRole('button',{name:'Save branch',exact:true})).toHaveCount(0);
});
test('branch actions and confirmation remain reachable at 1280 by 720',async({page})=>{
  const companion=await attach(page);await companion.setViewportSize({width:1280,height:720});
  const dialog=await menu(companion);
  await dialog.getByRole('textbox',{name:'New branch name'}).fill('Compact workspace');
  await dialog.getByRole('button',{name:'Create branch',exact:true}).click();
  const confirm=dialog.getByRole('button',{name:'Confirm branch action',exact:true});
  await confirm.scrollIntoViewIfNeeded();await expect(confirm).toBeInViewport();
  const bounds=await dialog.boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(720);
  expect(await companion.evaluate(()=>document.documentElement.scrollWidth)).toBe(1280);
  await companion.screenshot({path:'/tmp/sceneweaver-0.5.3-branches-1280.png'});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).branchFixture.writes.length)).toBe(0);
});
