import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); await request.post('/comfy/test/asset-library'); });
async function attach(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const c = await opened;
  await expect(c.getByText('Attached to live workflow', { exact: true })).toBeVisible(); await expect(c.getByRole('button', { name: 'Capture frame', exact: true })).toBeEnabled(); return c;
}
async function seek(c: Page, seconds: number) {
  await c.getByRole('slider', { name: 'Seek sequence', exact: true }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
}
async function open(c: Page) { await c.getByRole('button', { name: 'Capture frame', exact: true }).click(); await expect(c.getByRole('button', { name: 'Review frame', exact: true })).toBeEnabled(); }
async function review(c: Page) { await c.getByRole('button', { name: 'Review frame', exact: true }).click(); await expect(c.getByRole('button', { name: 'Save captured picture', exact: true })).toBeEnabled(); }
const plan = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((item: any) => item.id === '1700').widgets.find((item: any) => item.name === 'plan_json').value);

test('capture follows the actual second clip after a gap and retains local time, folder and provenance', async ({ page, request }) => {
  const c = await attach(page), before = await plan(page);
  await seek(c, 6); await expect(c.getByRole('button', { name: 'Capture frame', exact: true })).toBeDisabled();
  await seek(c, 11.25); await expect(c.locator('.viewer-canvas video')).toHaveAttribute('src', /second.webm/);
  await expect.poll(() => c.locator('.viewer-canvas video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(1.25, 2);
  await open(c); await expect(c.getByRole('dialog')).toContainText('clip time 1.250 s');
  await c.getByLabel('Capture tag', { exact: true }).fill('stillness'); await c.getByLabel('Capture folder', { exact: true }).selectOption('cast');
  await review(c); await c.getByRole('button', { name: 'Save captured picture' }).click(); await expect(c.getByRole('dialog')).toContainText('Captured picture saved');
  const state = await (await request.get('/comfy/test/asset-library')).json();
  expect(state.actions).toHaveLength(1); expect(state.actions[0]).toMatchObject({ action: 'asset_capture', time_seconds: 1.25, folder_id: 'cast', source: { scene: 2, revision: 'c'.repeat(32), file: { filename: 'second.webm' } } });
  expect(state.catalog.assets.at(-1).source_origin.revision).toBe('c'.repeat(32)); expect(await plan(page)).toBe(before);
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(0);
});
test('final-cut capture uses alternate picture identity and the compact dialog stays inside the viewport', async ({ page, request }) => {
  const c = await attach(page); await c.setViewportSize({ width: 1280, height: 720 }); await seek(c, .5); await open(c);
  await review(c); await c.screenshot({ path: 'test-results/frame-capture-compact.png', fullPage: true });
  const bounds = (await c.getByRole('dialog').boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(1280); expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
  await c.getByRole('button', { name: 'Save captured picture' }).click(); await expect(c.getByRole('dialog')).toContainText('Captured picture saved');
  const body = (await (await request.get('/comfy/test/asset-library')).json()).actions[0]; expect(body.source.revision).toBe('b'.repeat(32)); expect(body.source.file.filename).toBe('final-alt.webm'); expect(body.time_seconds).toBeCloseTo(.5, 2);
});
test('changing capture fields invalidates review and a stale library cannot publish', async ({ page, request }) => {
  const c = await attach(page); await open(c); await review(c); await c.getByLabel('Capture tag').fill('changed');
  await expect(c.getByRole('button', { name: 'Save captured picture' })).toBeDisabled(); await review(c);
  await request.post('/comfy/test/asset-library', { data: { rename: 'Native change' } }); await c.getByRole('button', { name: 'Save captured picture' }).click();
  await expect(c.getByRole('dialog')).toContainText('The library changed'); expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(0);
});
test('lost capture acknowledgement is reconciled with one picture', async ({ page, request }) => {
  const c = await attach(page); await open(c); await review(c); await request.post('/comfy/test/asset-library', { data: { failure: 'after' } });
  await c.getByRole('button', { name: 'Save captured picture' }).click(); await expect(c.getByRole('dialog')).toContainText('pending library change committed');
  await expect(c.getByRole('button', { name: 'Save captured picture' })).toBeDisabled(); expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(1);
});
test('prepared capture resumes from the Media page after the parent adapter restarts', async ({ page, request }) => {
  const c = await attach(page); await open(c); await review(c); await request.post('/comfy/test/asset-library', { data: { failure: 'prepared' } });
  await c.getByRole('button', { name: 'Save captured picture' }).click(); await expect(c.getByRole('button', { name: 'Retry same capture' })).toBeEnabled();
  await c.close(); await page.reload(); const reopened = await attach(page); await reopened.getByRole('button', { name: 'Media', exact: true }).click();
  await reopened.getByRole('button', { name: 'Resume frame capture', exact: true }).click(); await expect(reopened.getByRole('button', { name: 'Resume frame capture', exact: true })).toHaveCount(0);
  expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(1);
});
test('an older H3 library shows a clear unavailable state and cannot save', async ({ page, request }) => {
  await request.post('/comfy/test/asset-library', { data: { legacy: true } }); const c = await attach(page); await c.getByRole('button', { name: 'Capture frame', exact: true }).click();
  await expect(c.getByRole('dialog')).toContainText('Update H3'); await expect(c.getByRole('button', { name: 'Save captured picture' })).toBeDisabled();
});
