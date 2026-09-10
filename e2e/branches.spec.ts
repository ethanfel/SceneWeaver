import { test, expect, type Page } from '@playwright/test';
let target = '';
const branch = '1'.repeat(32);
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); await request.post('/comfy/test/branches'); });
async function attach(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const popup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const companion = await popup;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await expect(companion.getByLabel('Working branch')).toContainText('Second cut');
  return companion;
}
async function switchToOriginal(page: Page) {
  await page.evaluate(() => { const widget = (window as any).testComfy.graph._nodes.find((n: any) => n.id === '1700').widgets.find((w: any) => w.name === 'plan_json'); const plan = JSON.parse(widget.value); delete plan._branch_id; widget.value = JSON.stringify(plan); });
}
test('follows branch clips and processed outputs without using Original media', async ({ page }) => {
  const companion = await attach(page);
  await expect(companion.locator('.viewer-canvas video')).toHaveAttribute('src', /older.webm/);
  await companion.locator('.viewer-tabs').getByRole('button', { name: 'Takes', exact: true }).click();
  await companion.getByRole('tab', { name: 'DeRoPE' }).click();
  await expect(companion.getByRole('article', { name: 'Processed scene 1 Second cut DeRoPE' })).toBeVisible();
  await expect(companion.getByText('Original upscale', { exact: false })).toHaveCount(0);
  await companion.screenshot({ path: 'test-results/branch-processing.png', fullPage: true });
  await companion.getByRole('button', { name: 'Preview processed take' }).click();
  await expect(companion.locator('.source-canvas video')).toHaveAttribute('src', /second-derope.webm/);
  await expect(companion.locator('.viewer-canvas video')).toHaveAttribute('src', /older.webm/);
  await switchToOriginal(page);
  await expect(companion.locator('.source-canvas video')).toHaveCount(0);
  await expect(companion.getByLabel('Working branch')).toContainText('Original');
  await expect(companion.locator('.viewer-canvas video')).toHaveAttribute('src', /final-alt.webm/);
});
test('restores and chooses a final-cut alternate only on the attached named branch', async ({ page, request }) => {
  const companion = await attach(page);
  await companion.locator('.viewer-tabs').getByRole('button', { name: 'Takes', exact: true }).click();
  await companion.getByRole('article', { name: `Scene 1 take ${'a'.repeat(32)}`, exact: true }).getByRole('button', { name: 'Restore checkpoint…' }).click();
  await expect(companion.getByRole('dialog')).toContainText('11111111');
  await companion.getByRole('button', { name: 'Restore this branch', exact: true }).click();
  await expect(companion.getByRole('dialog')).toHaveCount(0);
  await companion.getByRole('article', { name: `Scene 1 take ${'b'.repeat(32)}`, exact: true }).getByRole('button', { name: 'Use in final cut' }).click();
  await expect.poll(async () => (await (await request.get('/comfy/test/state')).json()).takeActions.length).toBe(2);
  const actions = (await (await request.get('/comfy/test/state')).json()).takeActions;
  expect(actions.map((action: any) => action.branch)).toEqual([branch, branch]);
  const original = await (await request.get('/comfy/minimax_h3_context_loop/checkpoints')).json();
  expect(original.checkpoints).toHaveLength(3);
  expect(original.editorial.revision).toBe('e'.repeat(32));
});
test('keeps unapplied drafts on their previous branch when ComfyUI switches', async ({ page }) => {
  const companion = await attach(page);
  await companion.locator('.prompt-field textarea').first().fill('Draft for second cut only');
  await expect(companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true })).toBeEnabled();
  await switchToOriginal(page);
  await expect(companion.getByText('Concurrent edit detected', { exact: true })).toBeVisible();
  await expect(companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true })).toBeDisabled();
  expect(await companion.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sceneweaver.live-draft.v1:')).every(key => key.includes('1'.repeat(32))))).toBe(true);
});

test('discards delayed checkpoint responses from the previous working branch', async ({ page, request }) => {
  const companion = await attach(page);
  let release!: () => void, captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { captured = resolve; });
  let first = true;
  await companion.route('**/checkpoints?**', async route => {
    if (!first || !route.request().url().includes('include_graph=false') || !route.request().url().includes('branch_id=')) return route.continue();
    first = false; const response = await route.fetch(); captured(); await held; await route.fulfill({ response });
  });
  await request.post('/comfy/test/takes/notify'); await ready;
  await switchToOriginal(page);
  await expect(companion.getByLabel('Working branch')).toContainText('Original');
  await expect(companion.locator('.viewer-canvas video')).toHaveAttribute('src', /final-alt.webm/);
  const response = companion.waitForResponse(response => response.url().includes('include_graph=false') && response.url().includes('branch_id='));
  release(); await (await response).finished();
  await companion.waitForTimeout(100);
  await expect(companion.locator('.viewer-canvas video')).toHaveAttribute('src', /final-alt.webm/);
});
