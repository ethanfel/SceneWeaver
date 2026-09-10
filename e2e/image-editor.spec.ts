import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); await request.post('/comfy/test/asset-library'); });
async function attach(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const c = await opened;
  await expect(c.getByText('Attached to live workflow', { exact: true })).toBeVisible(); await c.getByRole('button', { name: 'Media', exact: true }).click();
  await expect(c.getByRole('button', { name: 'Edit image hero', exact: true })).toBeEnabled(); return c;
}
async function editor(page: Page) {
  const c = await attach(page); await c.getByRole('button', { name: 'Edit image hero', exact: true }).click(); await expect(c.getByLabel('Crop width', { exact: true })).toHaveValue('240'); return c;
}
async function review(c: Page) { await c.getByRole('button', { name: 'Review variant', exact: true }).click(); await expect(c.getByRole('button', { name: 'Save variant', exact: true })).toBeEnabled(); }
const plan = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((item: any) => item.id === '1700').widgets.find((item: any) => item.name === 'plan_json').value);
const screenPoint = (c: Page, x: number, y: number) => c.getByRole('group', { name: 'Crop selector' }).evaluate((element, p) => {
  const point = new DOMPoint(p.x, p.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!); return { x: point.x, y: point.y };
}, { x, y });

test('numeric crop, output, resampling and folder review create a variant without changing source or Plan', async ({ page, request }) => {
  const c = await editor(page), before = await plan(page); await c.getByLabel('Lock aspect ratio').uncheck();
  for (const [field, value] of [['Crop x', '20'], ['Crop y', '10'], ['Crop width', '100'], ['Crop height', '100'], ['Output width', '64'], ['Output height', '64']]) {
    await c.getByLabel(field, { exact: true }).fill(value); await c.getByLabel(field, { exact: true }).press('Tab');
  }
  await c.getByLabel('Variant tag').fill('hero_square'); await c.getByLabel('Variant folder').selectOption('places'); await c.getByLabel('Resampling').selectOption('nearest');
  expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(0); await review(c);
  await expect(c.locator('.image-editor')).toContainText('Reviewed 100 × 100 crop → 64 × 64 · nearest'); await c.getByRole('button', { name: 'Save variant', exact: true }).click(); await expect(c.locator('.image-editor')).toContainText('Variant saved');
  const state = (await (await request.get('/comfy/test/asset-library')).json()), variant = state.catalog.assets.at(-1);
  expect(state.catalog.assets[0].tag).toBe('hero'); expect(variant.parent_asset_id).toBe('hero'); expect(variant.folder_id).toBe('places'); expect(variant.transform.crop).toEqual({ x: 20, y: 10, width: 100, height: 100 }); expect(await plan(page)).toBe(before);
});
test('crop drawing, movement and keyboard nudging use source pixels at the rendered scale', async ({ page }) => {
  const c = await editor(page); await c.getByRole('button', { name: 'Centered crop', exact: true }).click(); await expect(c.getByLabel('Crop x', { exact: true })).toHaveValue('24');
  await c.getByRole('group', { name: 'Crop selector' }).focus(); await c.keyboard.press('ArrowRight'); await c.keyboard.press('Shift+ArrowDown');
  await expect(c.getByLabel('Crop x', { exact: true })).toHaveValue('25'); await expect(c.getByLabel('Crop y', { exact: true })).toHaveValue('26');
  await c.getByRole('button', { name: 'Draw crop', exact: true }).click(); const start = await screenPoint(c, 40, 30), end = await screenPoint(c, 160, 110);
  await c.mouse.move(start.x, start.y); await c.mouse.down(); await c.mouse.move(end.x, end.y, { steps: 4 }); await c.mouse.up();
  await expect(c.getByLabel('Crop x', { exact: true })).toHaveValue('40'); await expect(c.getByLabel('Crop width', { exact: true })).toHaveValue('120'); await expect(c.getByLabel('Crop height', { exact: true })).toHaveValue('80');
  const inside = await screenPoint(c, 80, 60), moved = await screenPoint(c, 90, 65); await c.mouse.move(inside.x, inside.y); await c.mouse.down(); await c.mouse.move(moved.x, moved.y); await c.mouse.up();
  await expect(c.getByLabel('Crop x', { exact: true })).toHaveValue('50'); await expect(c.getByLabel('Crop y', { exact: true })).toHaveValue('35');
  const corner = await screenPoint(c, 170, 115), resized = await screenPoint(c, 200, 135); await c.mouse.move(corner.x, corner.y); await c.mouse.down(); await c.mouse.move(resized.x, resized.y); await c.mouse.up();
  await expect(c.getByLabel('Crop width', { exact: true })).toHaveValue('150'); await expect(c.getByLabel('Crop height', { exact: true })).toHaveValue('100');
});
test('native megapixels, aspect lock and output multiples display the actual saved dimensions', async ({ page }) => {
  const c = await editor(page); await c.getByRole('button', { name: '1 MP', exact: true }).click();
  await expect(c.getByLabel('Output width', { exact: true })).toHaveValue('1224'); await expect(c.getByLabel('Output height', { exact: true })).toHaveValue('816');
  await c.getByLabel('Output multiple').selectOption('64'); await expect(c.getByLabel('Output width', { exact: true })).toHaveValue('1216'); await expect(c.getByLabel('Output height', { exact: true })).toHaveValue('832');
  await c.getByLabel('Output height', { exact: true }).fill('640'); await c.getByLabel('Output height', { exact: true }).press('Tab'); await expect(c.getByLabel('Output width', { exact: true })).toHaveValue('960');
  await c.getByRole('button', { name: 'Reset all', exact: true }).click(); await expect(c.getByLabel('Output width', { exact: true })).toHaveValue('240'); await expect(c.getByLabel('Output multiple')).toHaveValue('8');
});
test('changing the crop invalidates a review and a native catalog edit rejects stale saving', async ({ page, request }) => {
  const c = await editor(page); await review(c); await c.getByRole('button', { name: 'Centered crop', exact: true }).click(); await expect(c.getByRole('button', { name: 'Save variant', exact: true })).toBeDisabled(); await review(c);
  await request.post('/comfy/test/asset-library', { data: { rename: 'Native folder name' } }); await c.getByRole('button', { name: 'Save variant', exact: true }).click(); await expect(c.locator('.image-editor')).toContainText('The library changed');
  expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(0); await expect(c.getByRole('button', { name: 'Save variant', exact: true })).toBeDisabled();
});
test('a late image review cannot authorize an edited crop', async ({ page }) => {
  const c = await editor(page); let release: () => void = () => {}; const held = new Promise<void>(resolve => { release = resolve; }); let entered = false;
  await page.route('**/project-assets?*image_asset*', async route => { if (route.request().url().includes('image_edit=')) { entered = true; await held; } await route.continue(); });
  await c.getByRole('button', { name: 'Review variant', exact: true }).click(); await expect.poll(() => entered).toBe(true); await c.getByRole('button', { name: 'Centered crop', exact: true }).click(); release();
  await expect(c.getByRole('button', { name: 'Review variant', exact: true })).toBeEnabled(); await expect(c.getByRole('button', { name: 'Save variant', exact: true })).toBeDisabled();
});
test('a prepared variant resumes after reopening the parent and stays separate from media imports', async ({ page, request }) => {
  const c = await editor(page); await review(c); await request.post('/comfy/test/asset-library', { data: { failure: 'prepared' } }); await c.getByRole('button', { name: 'Save variant', exact: true }).click();
  await expect(c.locator('.image-editor')).toContainText('Variant was not confirmed'); await c.close(); const reopened = await attach(page);
  await expect(reopened.getByRole('button', { name: 'Resume image variant', exact: true })).toBeEnabled(); await reopened.getByRole('button', { name: 'Resume image variant', exact: true }).click(); await expect(reopened.getByRole('button', { name: 'Resume image variant', exact: true })).toHaveCount(0);
  const state = (await (await request.get('/comfy/test/asset-library')).json()); expect(state.actions).toHaveLength(1); expect(state.actions[0].action).toBe('asset_derive'); expect(state.catalog.assets).toHaveLength(5);
});
test('compact source and sizing controls remain reachable while older H3 disables variant creation', async ({ page, request }) => {
  const c = await editor(page); await c.setViewportSize({ width: 1280, height: 720 }); await c.getByRole('button', { name: 'Review variant', exact: true }).scrollIntoViewIfNeeded(); await expect(c.getByRole('button', { name: 'Review variant', exact: true })).toBeInViewport(); await c.screenshot({ path: 'test-results/image-editor-compact.png', fullPage: true });
  await c.keyboard.press('Escape'); await request.post('/comfy/test/asset-library', { data: { legacy: true } }); await c.locator('.project-panel:visible').getByRole('button', { name: 'Refresh', exact: true }).click(); await expect(c.getByRole('button', { name: 'Edit image hero', exact: true })).toBeDisabled();
});
