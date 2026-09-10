import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); });
async function attach(page: Page, supported = true) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const companion = await opened;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.locator('.inspector .tabs').getByRole('button', { name: 'Cut', exact: true }).click();
  if (supported) await expect(companion.getByLabel('Cut end frame')).toHaveValue('48');
  return companion;
}
test('reviews native continuation impact before saving trim and placement without editing the Plan', async ({ page, request }) => {
  const companion = await attach(page);
  const before = await page.evaluate(() => JSON.stringify((window as any).testComfy.graph._nodes.find((n: any) => n.id === '1700').widgets));
  await companion.getByLabel('Cut end frame').selectOption('27');
  await companion.getByLabel('Cut start frame').fill('120');
  await companion.getByRole('button', { name: 'Review timing', exact: true }).click();
  await expect(companion.getByRole('dialog')).toContainText('Continuation needs regeneration');
  await expect(companion.getByRole('dialog')).toContainText('depends on stale scene 2');
  expect((await (await request.get('/comfy/test/state')).json()).takeActions).toHaveLength(0);
  await companion.getByRole('button', { name: 'Save cut', exact: true }).click();
  await expect(companion.getByRole('status').filter({ hasText: 'Saved sequence updated' })).toBeVisible();
  const state = await (await request.get('/comfy/test/state')).json();
  expect(state.takeActions).toHaveLength(1); expect(state.submissions).toHaveLength(0);
  expect(state.takeActions[0].body.patch.scene).toMatchObject({ out_frame: 27, start_frame: 120, revision: 'a'.repeat(32) });
  const cut = await (await request.get('/comfy/minimax_h3_context_loop/checkpoints')).json();
  expect(cut.editorial.replacements[0].alternate_revision).toBe('b'.repeat(32));
  expect(cut.editorial.chapters).toHaveLength(2);
  expect(await page.evaluate(() => JSON.stringify((window as any).testComfy.graph._nodes.find((n: any) => n.id === '1700').widgets))).toBe(before);
  await expect(companion.locator('.timeline-clip').first()).toContainText('00:00:01:03');
});
test('a lost save result recovers the saved cut and receipt after reload without repeating the edit', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.evaluate(() => window.addEventListener('message', event => {
    if (event.data?.protocol === 'sceneweaver.live.v1' && event.data.kind === 'result' && event.data.result?.data?.editorial) event.stopImmediatePropagation();
  }, { capture: true }));
  await companion.getByLabel('Cut end frame').selectOption('27');
  await companion.getByRole('button', { name: 'Review timing', exact: true }).click();
  await companion.getByRole('button', { name: 'Save cut', exact: true }).click();
  await expect(companion.locator('.command-history summary')).toHaveText('Actions · Completed');
  await companion.reload();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.locator('.inspector .tabs').getByRole('button', { name: 'Cut', exact: true }).click();
  await expect(companion.getByLabel('Cut end frame')).toHaveValue('27');
  await companion.locator('.command-history summary').click();
  await expect(companion.locator('.command-history')).toContainText('Save sequence edit');
  expect((await (await request.get('/comfy/test/state')).json()).takeActions).toHaveLength(1);
});
test('an older H3 installation leaves saved-cut editing unavailable and keeps the workflow connected', async ({ page }) => {
  await page.context().route('**/h3_editorial_commands.mjs*', route => route.abort());
  const companion = await attach(page, false);
  await expect(companion.locator('.saved-cut-inspector')).toContainText('needs the saved-sequence editing interface');
  await expect(companion.getByRole('button', { name: 'Queue in ComfyUI' })).toBeEnabled();
  await expect(companion.getByLabel('Cut end frame')).toHaveCount(0);
});
test('caption saves preserve the cut and locked scenes require a saved unlock', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.getByLabel('Lock saved scene').check();
  await companion.getByRole('button', { name: 'Review timing', exact: true }).click();
  await companion.getByRole('button', { name: 'Save cut', exact: true }).click();
  await expect(companion.getByLabel('Cut end frame')).toBeDisabled();
  await companion.getByLabel('Saved caption offset').fill('0.5');
  await companion.getByRole('button', { name: 'Review captions', exact: true }).click();
  await companion.getByRole('button', { name: 'Save cut', exact: true }).click();
  await expect(companion.getByLabel('Saved caption offset')).toHaveValue('0.5');
  await expect.poll(async () => (await (await request.get('/comfy/test/state')).json()).takeActions.length).toBe(2);
  const cut = await (await request.get('/comfy/minimax_h3_context_loop/checkpoints')).json();
  expect(cut.editorial.locked_scene_ids).toEqual(['the_arrival']);
  expect(cut.editorial.subtitles.offset_seconds).toBe(.5); expect(cut.editorial.trims[0].out_frame).toBe(48);
});
test('a stale cut rejects saving while retaining the edited values', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.getByLabel('Cut end frame').selectOption('27');
  await companion.getByRole('button', { name: 'Review timing', exact: true }).click();
  await expect(companion.getByRole('dialog')).toBeVisible();
  await request.post('/comfy/test/takes/change');
  await companion.getByRole('button', { name: 'Save cut', exact: true }).click();
  await expect(companion.getByRole('status').filter({ hasText: 'saved cut, checkpoints or assets changed' })).toBeVisible();
  await expect(companion.getByLabel('Cut end frame')).toHaveValue('27');
  expect((await (await request.get('/comfy/test/state')).json()).takeActions).toHaveLength(0);
});
test('cut controls and consequence review remain reachable at 1280 by 720', async ({ page }) => {
  const companion = await attach(page); await companion.setViewportSize({ width: 1280, height: 720 });
  await companion.screenshot({ path: 'test-results/editorial-inspector-compact.png', fullPage: true });
  await companion.getByLabel('Cut end frame').selectOption('27');
  await companion.getByRole('button', { name: 'Review timing', exact: true }).click();
  await expect(companion.getByRole('button', { name: 'Save cut', exact: true })).toBeInViewport();
  await companion.screenshot({ path: 'test-results/editorial-compact.png', fullPage: true });
});
