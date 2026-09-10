import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); });

async function prepare(page: Page, options: { input?: string; shared?: boolean; unknown?: boolean; branch?: string; primitive?: boolean } = {}) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  await page.evaluate(options => {
    const graph = (window as any).testComfy.graph, plan = graph._nodes.find((node: any) => node.id === '1700');
    const backing = plan.widgets.find((item: any) => item.name === 'plan_json');
    const document = JSON.parse(backing.value); document.shots[0].prompt = 'From the connected source'; document.shots[0].seed = '18446744073709551615';
    if (options.branch) document._branch_id = options.branch;
    const fallback = JSON.parse(backing.value); delete fallback._branch_id; fallback.shots[0].prompt = 'Inactive fallback direction'; backing.value = JSON.stringify(fallback);
    graph._nodes.push({ id: 'source', type: options.unknown ? 'RuntimePlanGenerator' : options.primitive ? 'PrimitiveNode' : 'PrimitiveStringMultiline', title: 'Production text source', graph, widgets: [{ name: 'value', value: JSON.stringify(document), callback() { (window as any).nativeCallbacks++; } }], inputs: [], properties: {} });
    graph._nodes.push({ id: 'get-plan', type: 'GetNode', graph, widgets: [{ name: 'Constant', value: 'production-plan' }], inputs: [] });
    graph._nodes.push({ id: 'set-plan', type: 'SetNode', graph, widgets: [{ name: 'Constant', value: 'production-plan' }], inputs: [{ name: '*', link: 89001 }] });
    graph.links[89001] = { origin_id: 'source', origin_slot: 0 };
    graph.links[89002] = { origin_id: 'get-plan', origin_slot: 0 };
    plan.inputs.push({ name: options.input || 'plan_json_input', link: 89002 });
    if (options.shared) {
      graph._nodes.push({ ...plan, id: 'second-plan', title: 'Second Plan', widgets: plan.widgets.map((item: any) => ({ ...item })), inputs: [{ name: 'plan_json_input', link: 89002 }] });
      graph._nodes.push({ id: 'text-consumer', type: 'CLIPTextEncode', title: 'Shared text consumer', graph, widgets: [], inputs: [{ name: 'text', link: 89002 }] });
    }
  }, options);
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click();
  const companion = await opened;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  if (options.shared) await companion.getByRole('combobox', { name: 'Active H3 plan' }).selectOption('1700');
  return companion;
}
const sourceText = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((node: any) => node.id === 'source').widgets[0].value);
const fallbackText = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((node: any) => node.id === '1700').widgets.find((item: any) => item.name === 'plan_json').value);

test('edits a connected Primitive through Get/Set, preserves fallback and uint64 seeds, and recovers its draft', async ({ page }) => {
  const companion = await prepare(page, { primitive: true });
  await expect(companion.getByLabel('Plan text source')).toContainText('Production text source');
  const direction = companion.getByRole('textbox', { name: 'Scene direction', exact: true });
  await expect(direction).toHaveValue('From the connected source');
  await direction.fill('Edited connected direction');
  expect(JSON.parse(await sourceText(page)).shots[0].prompt).toBe('From the connected source');
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  const applied = JSON.parse(await sourceText(page));
  expect(applied.shots[0].prompt).toBe('Edited connected direction');
  expect(applied.shots[0].seed).toBe('18446744073709551615');
  expect(JSON.parse(await fallbackText(page)).shots[0].prompt).toBe('Inactive fallback direction');
  await direction.fill('Recover connected draft');
  await expect(companion.getByText('Draft backed up · apply to sync', { exact: true })).toBeVisible();
  await companion.reload();
  await expect(companion.getByRole('dialog', { name: 'Recover prompt draft' })).toBeVisible();
  await companion.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toHaveValue('Recover connected draft');
  expect(JSON.parse(await sourceText(page)).shots[0].prompt).toBe('Edited connected direction');
});

test('keeps a converted Plan JSON input selectable and edits the supplying text widget', async ({ page }) => {
  const companion = await prepare(page, { input: 'plan_json' });
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toHaveValue('From the connected source');
  await companion.getByRole('textbox', { name: 'Scene direction', exact: true }).fill('Required input edit');
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  expect(JSON.parse(await sourceText(page)).shots[0].prompt).toBe('Required input edit');
  expect(JSON.parse(await fallbackText(page)).shots[0].prompt).toBe('Inactive fallback direction');
});

test('shows all consumers and requires review before changing shared Plan text', async ({ page }) => {
  const companion = await prepare(page, { shared: true });
  await expect(companion.getByLabel('Plan text source')).toContainText('3 consumers');
  await companion.getByRole('textbox', { name: 'Scene direction', exact: true }).fill('Direction for every consumer');
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  const dialog = companion.getByRole('dialog', { name: 'Apply shared Plan text', exact: true });
  await expect(dialog).toContainText('Second Plan');
  await expect(dialog).toContainText('Shared text consumer');
  expect(JSON.parse(await sourceText(page)).shots[0].prompt).toBe('From the connected source');
  await dialog.getByRole('button', { name: 'Keep draft', exact: true }).click();
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  await page.evaluate(() => {
    const graph = (window as any).testComfy.graph;
    graph._nodes.push({ id: 'later-consumer', type: 'CLIPTextEncode', title: 'Later consumer', graph, widgets: [], inputs: [{ name: 'text', link: 89002 }] });
  });
  await expect(companion.getByLabel('Plan text source')).toContainText('4 consumers');
  await dialog.getByRole('button', { name: 'Apply to all listed inputs', exact: true }).click();
  await expect(dialog).toContainText('Later consumer');
  expect(JSON.parse(await sourceText(page)).shots[0].prompt).toBe('From the connected source');
  await dialog.getByRole('button', { name: 'Apply to all listed inputs', exact: true }).click();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  expect(JSON.parse(await sourceText(page)).shots[0].prompt).toBe('Direction for every consumer');
  await companion.getByRole('combobox', { name: 'Active H3 plan' }).selectOption('second-plan');
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toHaveValue('Direction for every consumer');
});

test('a cached older bridge cannot edit connected Plan text until ComfyUI is refreshed', async ({ page }) => {
  await page.route('**/integrations/companion-client.mjs', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('planSourceVersion: 1, ', '') });
  });
  const companion = await prepare(page);
  await expect(companion.getByLabel('Plan text source')).toContainText('Refresh the ComfyUI tab');
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toBeDisabled();
  await expect(companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true })).toBeDisabled();
  await companion.getByRole('button', { name: 'Inspect text source', exact: true }).click();
  await expect(companion.locator('.inspector').getByRole('textbox', { name: 'value', exact: true })).toBeDisabled();
  expect(JSON.parse(await sourceText(page)).shots[0].prompt).toBe('From the connected source');
});

test('rewiring a text source preserves its pending draft and blocks applying it to the new source', async ({ page }) => {
  const companion = await prepare(page);
  const direction = companion.getByRole('textbox', { name: 'Scene direction', exact: true });
  await direction.fill('Keep my source draft');
  await page.evaluate(() => {
    const graph = (window as any).testComfy.graph, source = graph._nodes.find((node: any) => node.id === 'source');
    graph._nodes.push({ ...source, id: 'new-source', widgets: [{ name: 'value', value: JSON.stringify({ shots: [{ id: 'new', prompt: 'New source' }] }) }] });
    graph.links[89001].origin_id = 'new-source';
  });
  await expect(companion.getByText('Concurrent edit detected', { exact: true })).toBeVisible();
  await expect(companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true })).toBeDisabled();
  await expect(direction).toHaveValue('Keep my source draft');
  expect(JSON.parse(await sourceText(page)).shots[0].prompt).toBe('From the connected source');
});

test('uses the connected document branch for saved takes and disables fallback-only restoration', async ({ page, request }) => {
  await request.post('/comfy/test/takes'); await request.post('/comfy/test/branches');
  const companion = await prepare(page, { branch: '1'.repeat(32) });
  await expect(companion.getByLabel('Working branch')).toContainText('Second cut');
  await companion.locator('.viewer-tabs').getByRole('button', { name: 'Takes', exact: true }).click();
  const active = companion.getByRole('article', { name: `Scene 1 take ${'d'.repeat(32)}`, exact: true });
  await expect(active).toContainText('In final cut');
  await expect(active.getByRole('button', { name: 'Restore checkpoint…', exact: true })).toBeDisabled();
  await expect(companion.locator('.takes-panel')).toContainText('Restoring checkpoints into connected or read-only Plan text is not supported yet');
});

test('unknown runtime Plans do not show fallback scenes or Original checkpoints, while project assets remain usable', async ({ page, request }) => {
  await request.post('/comfy/test/takes');
  const checkpointReads: string[] = [];
  page.context().on('request', request => { if (request.url().includes('/checkpoints?')) checkpointReads.push(request.url()); });
  const companion = await prepare(page, { unknown: true });
  await expect(companion.getByLabel('Plan text source')).toContainText('Runtime Plan is unknown');
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toHaveCount(0);
  await expect(companion.getByLabel('Working branch')).toContainText('Unresolved');
  expect(checkpointReads).toEqual([]);
  await companion.locator('.viewer-tabs').getByRole('button', { name: 'Assets', exact: true }).click();
  await companion.getByRole('textbox', { name: 'Tag for hero', exact: true }).fill('still-shared');
  await companion.locator('.asset-card').filter({ has: companion.getByRole('textbox', { name: 'Tag for hero', exact: true }) }).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(companion.getByRole('textbox', { name: 'Tag for still-shared', exact: true })).toBeVisible();
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toEqual([]);
});
