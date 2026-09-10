import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); });
async function attach(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const companion = await opened;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.locator('.app-footer').getByRole('button', { name: 'Deliver', exact: true }).click();
  await companion.getByLabel('Delivery through scene').selectOption(`2:${'c'.repeat(32)}`);
  return companion;
}
test('prepares and queues a frozen saved cut with native assembly settings and no generation nodes', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.getByLabel('Delivery filename').fill('saved_selection_%date:yyyy-MM-dd%');
  await companion.getByRole('button', { name: 'Review saved delivery', exact: true }).click();
  await expect(companion.getByRole('dialog')).toContainText('picture bbbbbbbb');
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(0);
  await request.post('/comfy/minimax_h3_context_loop/editorial', { headers: { 'x-h3-workflow-owner': 'test-native-owner' }, data: { base_revision: 'e'.repeat(32), replacements: [], subtitles: { mode: 'off' } } });
  await companion.getByRole('button', { name: 'Assemble now', exact: true }).click();
  await expect(companion.getByRole('status').filter({ hasText: 'Delivery accepted' })).toBeVisible();
  const submitted = (await (await request.get('/comfy/test/state')).json()).submissions;
  expect(submitted).toHaveLength(1);
  const { prompt, extra_data, partial_execution_targets } = submitted[0];
  expect(partial_execution_targets).toEqual(['1706']);
  expect(Object.values(prompt).map((node: any) => node.class_type).sort()).toEqual(['MiniMaxH3ChainAssemble', 'MiniMaxH3ChainDeliverySource']);
  const source: any = Object.values(prompt).find((node: any) => node.class_type === 'MiniMaxH3ChainDeliverySource');
  expect(JSON.parse(source.inputs.snapshot_json).manifest.editorial.replacements[0].alternate_revision).toBe('b'.repeat(32));
  expect(JSON.parse(source.inputs.snapshot_json).manifest.editorial.subtitles.mode).toBe('preview_srt');
  expect(prompt['1706'].inputs.filename).toBe('saved_selection_%date:yyyy-MM-dd%');
  expect(extra_data.extra_pnginfo.workflow.id).toBe('live-workflow-uuid');
  expect(await page.evaluate(() => (window as any).testComfy.graph._nodes.some((n: any) => n.type === 'MiniMaxH3ChainDeliverySource'))).toBe(false);
});
test('recovers an accepted delivery receipt after losing its result and reloading without resubmission', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.evaluate(() => window.addEventListener('message', event => {
    if (event.data?.protocol === 'sceneweaver.live.v1' && event.data.kind === 'result' && event.data.result?.prompt_id) event.stopImmediatePropagation();
  }, { capture: true }));
  await companion.getByRole('button', { name: 'Review saved delivery', exact: true }).click();
  await companion.getByRole('button', { name: 'Assemble now', exact: true }).click();
  await expect(companion.locator('.command-history summary')).toHaveText('Actions · Completed');
  await companion.reload();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.locator('.command-history summary').click();
  await expect(companion.locator('.command-history')).toContainText('Assemble saved selection');
  await expect(companion.locator('.command-history')).toContainText('ComfyUI job · test-prompt-1');
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(1);
});
test('stale workflow settings invalidate a prepared delivery without queuing', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.getByRole('button', { name: 'Review saved delivery', exact: true }).click();
  await expect(companion.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => { (window as any).testComfy.graph._nodes.find((n: any) => n.id === '1706').widgets.find((w: any) => w.name === 'audio_bitrate').value = 192; });
  await expect(companion.getByRole('dialog')).toContainText('workflow or delivery settings changed');
  await expect(companion.getByRole('button', { name: 'Assemble now', exact: true })).toBeDisabled();
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(0);
});
test('delivery confirmation remains reachable at 1280 by 720', async ({ page }) => {
  const companion = await attach(page); await companion.setViewportSize({ width: 1280, height: 720 });
  await companion.getByRole('button', { name: 'Review saved delivery', exact: true }).click();
  await expect(companion.getByRole('button', { name: 'Assemble now', exact: true })).toBeInViewport();
  await companion.screenshot({ path: 'test-results/delivery-compact.png', fullPage: true });
});
