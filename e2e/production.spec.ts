import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); });
async function attach(page: Page) {
  await page.goto(`${target}/test/live`);
  await page.waitForFunction(() => Boolean((window as any).testComfy));
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const companion = await opened;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.locator('.app-footer').getByRole('button', { name: 'Generate', exact: true }).click();
  return companion;
}

test('reviews a scene range, submits native scope once and displays its job receipt', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.getByLabel('Generation scope').selectOption('range');
  await companion.getByLabel('First generation scene').fill('2');
  await companion.getByLabel('Last generation scene').fill('3');
  await companion.getByRole('button', { name: 'Review generation', exact: true }).click();
  await expect(companion.getByRole('dialog')).toContainText('Scenes 2–3');
  await expect(companion.getByRole('dialog')).toContainText('sceneweaver_first_film');
  await companion.getByRole('button', { name: 'Generate now', exact: true }).click();
  await expect(companion.getByRole('dialog')).toHaveCount(0);
  await expect(companion.getByRole('status').filter({ hasText: 'Generation accepted' })).toContainText('test-prompt-1');
  const state = await (await request.get('/comfy/test/state')).json();
  expect(state.submissions).toHaveLength(1);
  const submitted = state.submissions[0];
  expect(submitted.partial_execution_targets).toEqual(['1706']);
  expect(submitted.client_id).toBe('native-comfy-client');
  expect(submitted.extra_data.extra_pnginfo.workflow.id).toBe('live-workflow-uuid');
  for (const id of ['1701', '1947']) { expect(submitted.prompt[id].inputs.scene_range).toBe('2:3'); expect(submitted.prompt[id].inputs.start_clip).toBe(2); }
  await companion.getByRole('button', { name: 'Close render queue' }).click();
  await companion.locator('.command-history summary').click();
  await expect(companion.locator('.command-history')).toContainText('ComfyUI job · test-prompt-1');
  await companion.screenshot({ path: 'test-results/generation-range.png', fullPage: true });
});

test('a changed native Plan invalidates the review confirmation before submission', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.getByRole('button', { name: 'Review generation', exact: true }).click();
  await page.evaluate(() => { const app = (window as any).testComfy; const widget = app.graph._nodes.find((n: any) => n.id === '1700').widgets.find((w: any) => w.name === 'base_seed'); widget.value = 42; });
  await expect(companion.getByRole('dialog')).toContainText('workflow or scope changed');
  await expect(companion.getByRole('button', { name: 'Generate now', exact: true })).toBeDisabled();
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(0);
});

test('a native serializer finishing after a tab change cannot queue the wrong workflow', async ({ page, request }) => {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  await page.evaluate(() => { const app = (window as any).testComfy, original = app.graphToPrompt.bind(app); app.graphToPrompt = async (graph: any) => { const prompt = await original(graph); app.graph = { id: 'switched-workflow', _nodes: [], links: {} }; return prompt; }; });
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const companion = await opened;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.locator('.app-footer').getByRole('button', { name: 'Generate', exact: true }).click();
  await companion.getByRole('button', { name: 'Review generation', exact: true }).click();
  await companion.getByRole('button', { name: 'Generate now', exact: true }).click();
  await expect(companion.getByRole('status').filter({ hasText: 'workflow changed' })).toBeVisible();
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(0);
});

test('top-level mode explains why multi-scene submission is unavailable', async ({ page }) => {
  const companion = await attach(page);
  await page.evaluate(() => { (window as any).testComfy.graph._nodes.find((n: any) => n.id === '1705').widgets.push({ name: 'execution_mode', value: 'top_level_requeue' }); });
  await companion.getByLabel('Generation scope').selectOption('remaining');
  await expect(companion.getByLabel('Generation controls')).toContainText('one scene at a time');
  await expect(companion.getByRole('button', { name: 'Review generation', exact: true })).toBeDisabled();
  await companion.getByLabel('Generation scope').selectOption('scene');
  await expect(companion.getByRole('button', { name: 'Review generation', exact: true })).toBeEnabled();
});

test('recovers the accepted generation job ID after losing the result and reloading without resubmitting', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.evaluate(() => window.addEventListener('message', event => {
    if (event.data?.protocol === 'sceneweaver.live.v1' && event.data.kind === 'result' && event.data.result?.prompt_id) event.stopImmediatePropagation();
  }, { capture: true }));
  await companion.getByRole('button', { name: 'Review generation', exact: true }).click();
  await companion.getByRole('button', { name: 'Generate now', exact: true }).click();
  await expect(companion.locator('.command-history summary')).toHaveText('Actions · Completed');
  await companion.reload();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.locator('.command-history summary').click();
  await expect(companion.locator('.command-history')).toContainText('ComfyUI job · test-prompt-1');
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(1);
});

test('generation controls and confirmation remain reachable at 1280 by 720', async ({ page }) => {
  const companion = await attach(page); await companion.setViewportSize({ width: 1280, height: 720 });
  await companion.getByLabel('Generation scope').selectOption('range');
  await companion.getByLabel('First generation scene').fill('2');
  await companion.getByLabel('Last generation scene').fill('3');
  await companion.getByRole('button', { name: 'Review generation', exact: true }).click();
  await expect(companion.getByRole('button', { name: 'Generate now', exact: true })).toBeInViewport();
  await companion.screenshot({ path: 'test-results/generation-compact.png', fullPage: true });
  expect(await companion.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
