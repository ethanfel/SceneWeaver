import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); });
async function attach(page: Page, branch = 'main', secondScene = false) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  await page.evaluate(({ branch, secondScene }) => {
    const graph = (window as any).testComfy.graph, plan = graph._nodes.find((n: any) => n.id === '1700');
    plan.widgets.find((w: any) => w.name === 'plan_json').value = JSON.stringify({ _branch_id: branch, shots: [{ id: 'scene', prompt: ['Current Plan prompt.'], seed: '18446744073709551615', custom: true }, ...(secondScene ? [{ id: 'next_scene', prompt: ['Second scene.'] }] : [])] });
  }, { branch, secondScene });
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const c = await opened;
  await expect(c.getByText('Attached to live workflow', { exact: true })).toBeVisible(); await c.getByRole('button', { name: 'Open prompt workspace' }).click();
  return c;
}
const source = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((n: any) => n.id === '1700').widgets.find((w: any) => w.name === 'plan_json').value);
async function history(c: Page) { await c.getByRole('button', { name: 'Saved prompt history', exact: true }).click(); await expect(c.getByRole('button', { name: 'Refresh history' })).toBeEnabled(); }
const row = (c: Page, name: string) => c.getByRole('navigation', { name: 'Saved prompt revisions' }).getByRole('button').filter({ hasText: name });
async function confirm(c: Page) { await c.getByRole('button', { name: 'Confirm history change' }).click(); await expect(c.getByRole('button', { name: 'Refresh history' })).toBeEnabled(); }

test('browsing and restoring saved text preserves native history until an explicit save', async ({ page, request }) => {
  const c = await attach(page), before = await source(page); await history(c); await row(c, 'Executed opening').click();
  await expect(c.getByRole('textbox', { name: 'Saved revision text', exact: true })).toHaveValue('Saved first prompt.\n\nKeep the rain.');
  expect((await (await request.get('/comfy/test/prompt-history')).json()).actions).toHaveLength(0);
  await c.getByRole('button', { name: 'Use revision text', exact: true }).click(); await expect(c.getByLabel('Expanded scene prompt')).toHaveValue('Saved first prompt.\n\nKeep the rain.');
  expect(await source(page)).toBe(before); await c.getByRole('button', { name: 'Stage prompt', exact: true }).click();
  await c.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click(); await expect(c.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  const result = JSON.parse(await source(page)); expect(result.shots[0].prompt).toEqual(['Saved first prompt.', '', 'Keep the rain.']); expect(result.shots[0].seed).toBe('18446744073709551615'); expect(result.shots[0].custom).toBe(true);
  expect((await (await request.get('/comfy/test/prompt-history')).json()).actions).toHaveLength(0);
});
test('saving editor text reviews the active mutable draft without applying it to the workflow', async ({ page, request }) => {
  const c = await attach(page), before = await source(page); await c.getByLabel('Expanded scene prompt').fill('A saved editor draft.'); await history(c);
  await c.getByRole('button', { name: 'Save editor text to history' }).click();
  await expect(c.getByRole('textbox', { name: 'Saved text before', exact: true })).toHaveValue('A different saved prompt.');
  await expect(c.getByRole('textbox', { name: 'Editor text to save', exact: true })).toHaveValue('A saved editor draft.'); await confirm(c);
  const state = (await (await request.get('/comfy/test/prompt-history')).json()); expect(state.actions).toHaveLength(1); expect(state.actions[0].action).toBe('save'); expect(state.actions[0].prompt).toBe('A saved editor draft.'); expect(await source(page)).toBe(before);
});
test('forking preserves the selected revision and labels and archives the new history independently', async ({ page }) => {
  const c = await attach(page); await c.getByLabel('Expanded scene prompt').fill('Forked text'); await history(c); await row(c, 'Executed opening').click();
  await c.getByRole('button', { name: 'Fork with editor text' }).click(); await confirm(c);
  await row(c, 'Revision 3').click(); await c.getByLabel('Revision label').fill('My fork'); await c.getByRole('button', { name: 'Save label' }).click(); await confirm(c);
  await row(c, 'Executed opening').click(); await expect(c.getByRole('textbox', { name: 'Saved revision text', exact: true })).toHaveValue('Saved first prompt.\n\nKeep the rain.');
  await expect(c.getByRole('button', { name: 'Delete draft revision' })).toBeDisabled();
  await c.getByRole('button', { name: 'Set active in history' }).click(); await confirm(c);
  await row(c, 'My fork').click(); await c.getByRole('button', { name: 'Archive revision', exact: true }).click(); await confirm(c);
  await expect(row(c, 'My fork')).toHaveCount(0); await c.getByLabel('Show archived').check(); await row(c, 'My fork').click();
  await c.getByRole('button', { name: 'Unarchive revision' }).click(); await confirm(c); await row(c, 'My fork').click();
  await c.getByRole('button', { name: 'Delete draft revision' }).click(); await confirm(c); await expect(row(c, 'My fork')).toHaveCount(0);
});
test('a native conflict rejects the reviewed write and leaves no pending retry', async ({ page, request }) => {
  const c = await attach(page); await history(c); await c.getByRole('button', { name: 'Save editor text to history' }).click();
  await request.post('/comfy/test/prompt-history', { data: { failure: 'conflict' } }); await confirm(c);
  await expect(c.locator('.prompt-history-panel')).toContainText('Prompt history changed'); await expect(c.getByRole('button', { name: 'Retry exact history command' })).toHaveCount(0);
  expect((await (await request.get('/comfy/test/prompt-history')).json()).actions).toHaveLength(0);
});
test('lost acknowledgements reconcile and dropped requests retry exactly once', async ({ page, request }) => {
  const c = await attach(page); await history(c); await c.getByRole('button', { name: 'Save editor text to history' }).click();
  await request.post('/comfy/test/prompt-history', { data: { failure: 'after' } }); await confirm(c);
  await expect(c.locator('.prompt-history-panel')).toContainText('committed'); expect((await (await request.get('/comfy/test/prompt-history')).json()).actions).toHaveLength(1);
  await c.getByRole('button', { name: 'Close history' }).click(); await c.getByLabel('Expanded scene prompt').fill('Second save'); await history(c); await c.getByRole('button', { name: 'Save editor text to history' }).click();
  await request.post('/comfy/test/prompt-history', { data: { failure: 'before' } }); await confirm(c); await expect(c.getByRole('button', { name: 'Retry exact history command' })).toBeVisible();
  await c.getByRole('button', { name: 'Close history' }).click(); await history(c); await c.getByRole('button', { name: 'Retry exact history command' }).click();
  await expect(c.getByRole('button', { name: 'Refresh history' })).toBeEnabled(); expect((await (await request.get('/comfy/test/prompt-history')).json()).actions).toHaveLength(2);
});
test('legacy servers permit reads while named branches require an echoed branch identity', async ({ page, request }) => {
  await request.post('/comfy/test/prompt-history', { data: { legacy: true } }); const c = await attach(page); await history(c);
  await expect(c.getByRole('button', { name: 'Save editor text to history' })).toBeDisabled(); await row(c, 'Executed opening').click(); await expect(c.getByRole('button', { name: 'Use revision text' })).toBeEnabled();
});
test('named branch history is empty and never substitutes Original when routing is ignored', async ({ page, request }) => {
  const c = await attach(page, '1'.repeat(32)); await history(c); await expect(c.locator('.prompt-history-panel')).toContainText('No saved prompt revisions');
  await request.post('/comfy/test/prompt-history', { data: { ignoreBranch: true } }); await c.getByRole('button', { name: 'Refresh history' }).click(); await expect(c.locator('.prompt-history-panel')).toContainText('different working branch');
  await expect(row(c, 'Executed opening')).toHaveCount(0);
  await expect(c.getByRole('button', { name: 'Save editor text to history' })).toBeDisabled();
});
test('a late history read cannot load text into another scene', async ({ page }) => {
  const c = await attach(page, 'main', true); await history(c);
  await c.evaluate(() => {
    const capture = (event: MessageEvent) => {
      if (event.data?.kind !== 'result' || !event.data.result?.data?.revision?.prompt) return;
      event.stopImmediatePropagation(); window.removeEventListener('message', capture, true);
      (window as any).releaseHistory = () => window.dispatchEvent(new MessageEvent('message', { data: event.data, origin: event.origin, source: event.source }));
    };
    window.addEventListener('message', capture, true);
  });
  await row(c, 'Executed opening').click(); await c.waitForFunction(() => Boolean((window as any).releaseHistory));
  await c.getByRole('button', { name: 'Close history' }).click(); await c.locator('.scene-card').nth(1).click();
  await c.locator('.viewer-tabs').getByRole('button', { name: 'Prompt', exact: true }).click(); await history(c);
  await c.evaluate(() => (window as any).releaseHistory());
  await expect(c.locator('.prompt-history-panel')).toContainText('next_scene');
  await expect(c.getByRole('textbox', { name: 'Saved revision text', exact: true })).toHaveCount(0);
  await c.getByRole('button', { name: 'Close history' }).click();
  await expect(c.getByLabel('Expanded scene prompt')).toHaveValue('Second scene.');
  expect(JSON.parse(await source(page)).shots[1].prompt).toEqual(['Second scene.']);
});
test('text import/export stays local and history controls remain reachable at 1280 by 720', async ({ page }) => {
  const c = await attach(page), before = await source(page); await c.locator('label.file-label').filter({ hasText: 'Import prompt text' }).locator('input').setInputFiles({ name: 'prompt.txt', mimeType: 'text/plain', buffer: Buffer.from('Imported prompt\n\nKeep spacing.') });
  await expect(c.getByLabel('Expanded scene prompt')).toHaveValue('Imported prompt\n\nKeep spacing.'); const download = c.waitForEvent('download'); await c.getByRole('button', { name: 'Export prompt text' }).click(); expect((await download).suggestedFilename()).toBe('scene.txt'); expect(await source(page)).toBe(before);
  await c.setViewportSize({ width: 1280, height: 720 }); await history(c); await row(c, 'Executed opening').click(); await c.getByRole('button', { name: 'Use revision text' }).scrollIntoViewIfNeeded(); await expect(c.getByRole('button', { name: 'Use revision text' })).toBeInViewport(); await c.screenshot({ path: 'test-results/history-compact.png', fullPage: true });
});
