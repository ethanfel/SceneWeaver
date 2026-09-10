import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/asset-library'); });
async function attach(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  await page.evaluate(() => { const plan = (window as any).testComfy.graph._nodes.find((item: any) => item.id === '1700'); plan.widgets.find((item: any) => item.name === 'plan_json').value = JSON.stringify({ shots: [{ id: 'scene_one', prompt: '@hero waits in #room.' }] }); });
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const c = await opened;
  await expect(c.getByText('Attached to live workflow', { exact: true })).toBeVisible(); await c.getByRole('button', { name: 'Media', exact: true }).click();
  await expect(c.getByRole('navigation', { name: 'Project media folders' })).toBeVisible(); await expect(c.getByRole('button', { name: 'New folder', exact: true })).toBeEnabled(); return c;
}
const organize = async (c: Page, tag: string) => { await c.getByRole('button', { name: `Organize ${tag}`, exact: true }).click(); await expect(c.getByRole('button', { name: 'Close organizer' })).toBeVisible(); };
const closed = (c: Page) => expect(c.getByRole('button', { name: 'Close organizer' })).toHaveCount(0);
const folder = (c: Page, name: string) => c.getByRole('navigation', { name: 'Project media folders' }).getByRole('button').filter({ has: c.locator('span').filter({ hasText: new RegExp(`^${name}$`) }) });
const planText = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((item: any) => item.id === '1700').widgets.find((item: any) => item.name === 'plan_json').value);

test('folder browsing is read-only and folder creation, rename, ordering and removal preserve media and Plan', async ({ page, request }) => {
  const c = await attach(page), before = await planText(page); await folder(c, 'Cast').click(); await expect(c.getByLabel('Tag for hero', { exact: true })).toBeVisible(); await expect(c.getByLabel('Tag for room', { exact: true })).toBeHidden();
  expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(0);
  await c.getByRole('button', { name: 'New folder', exact: true }).click(); await c.getByLabel('Folder name', { exact: true }).fill('Props'); await c.getByRole('button', { name: 'Create folder', exact: true }).click(); await closed(c);
  await folder(c, 'Props').click(); await c.getByRole('button', { name: 'Edit folder', exact: true }).click(); await c.getByLabel('Folder name', { exact: true }).fill('Objects'); await c.getByRole('button', { name: 'Save folder', exact: true }).click(); await closed(c);
  await c.getByRole('button', { name: 'Edit folder', exact: true }).click(); await c.getByRole('button', { name: 'Folder earlier', exact: true }).click(); await closed(c);
  await c.getByRole('button', { name: 'Edit folder', exact: true }).click(); await c.getByRole('button', { name: 'Remove folder', exact: true }).click(); await closed(c);
  const state = (await (await request.get('/comfy/test/asset-library')).json()); expect(state.catalog.folders.map((item: any) => item.name)).toEqual(['Cast', 'Locations']); expect(state.catalog.assets).toHaveLength(4); expect(await planText(page)).toBe(before);
});
test('asset moves, duplicate provenance, scoped usage and confirmed deletion use the native library', async ({ page, request }) => {
  const c = await attach(page); await organize(c, 'hero'); await expect(c.locator('.library-usage')).toContainText('scene_one'); await c.getByLabel('Asset folder', { exact: true }).selectOption('places'); await c.getByRole('button', { name: 'Move to folder', exact: true }).click(); await closed(c);
  await organize(c, 'hero'); await c.getByRole('button', { name: 'Duplicate card', exact: true }).click(); await closed(c);
  await organize(c, 'hero'); await expect(c.locator('.library-usage')).toContainText('Shared media cards: hero_copy'); await c.getByRole('button', { name: 'Delete asset…', exact: true }).click();
  expect((await (await request.get('/comfy/test/asset-library')).json()).catalog.assets.some((item: any) => item.id === 'hero')).toBe(true);
  await c.getByRole('button', { name: 'Confirm asset deletion', exact: true }).click(); await closed(c);
  const state = (await (await request.get('/comfy/test/asset-library')).json()); expect(state.catalog.assets.some((item: any) => item.id === 'hero')).toBe(false); expect(state.catalog.assets.find((item: any) => item.tag === 'hero_copy').parent_asset_id).toBe('hero');
});
test('dragging to a folder and filtered reordering keep unrelated asset positions', async ({ page, request }) => {
  const c = await attach(page); const card = c.locator('.asset-card').filter({ has: c.getByLabel('Tag for hero', { exact: true }) });
  await card.dragTo(folder(c, 'Locations'));
  await expect.poll(async () => (await (await request.get('/comfy/test/asset-library')).json()).catalog.assets[0].folder_id).toBe('places');
  await organize(c, 'hero'); await c.getByRole('button', { name: 'Duplicate card', exact: true }).click(); await closed(c);
  await c.getByLabel('Search project assets').fill('hero'); await organize(c, 'hero'); await c.getByRole('button', { name: 'Move later', exact: true }).click(); await closed(c);
  const ids = (await (await request.get('/comfy/test/asset-library')).json()).catalog.assets.map((item: any) => item.id); expect(ids.slice(1, 4)).toEqual(['room', 'mix', 'vocals']); expect(ids.at(-1)).toBe('hero');
});
test('grouped audio cannot be deleted and metadata edits use conditional library writes', async ({ page, request }) => {
  const c = await attach(page); await organize(c, 'vocals'); await expect(c.getByRole('button', { name: 'Delete asset…', exact: true })).toBeDisabled(); await expect(c.locator('.library-usage')).toContainText('Track groups: score'); await c.getByRole('button', { name: 'Close organizer' }).click();
  await c.getByLabel('Tag for hero', { exact: true }).fill('lead'); await c.locator('.asset-card').filter({ has: c.getByLabel('Tag for hero', { exact: true }) }).getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(c.getByLabel('Tag for lead', { exact: true })).toBeVisible(); const actions = (await (await request.get('/comfy/test/asset-library')).json()).actions; expect(actions[0].action).toBe('asset_update'); expect(actions[0].changes).toEqual({ tag: 'lead' });
});
test('native library edits invalidate an open review without overwriting them', async ({ page, request }) => {
  const c = await attach(page); await folder(c, 'Cast').click(); await c.getByRole('button', { name: 'Edit folder', exact: true }).click(); await c.getByLabel('Folder name', { exact: true }).fill('My cast name');
  await request.post('/comfy/test/asset-library', { data: { rename: 'Native cast name' } }); await c.getByRole('button', { name: 'Save folder', exact: true }).click();
  await expect(c.locator('.library-organizer')).toContainText('The library changed'); await expect(c.getByRole('button', { name: 'Save folder', exact: true })).toBeDisabled(); expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(0);
});
test('uncertain library changes reconcile or retry the retained request once', async ({ page, request }) => {
  const c = await attach(page); await organize(c, 'hero'); await request.post('/comfy/test/asset-library', { data: { failure: 'after' } }); await c.getByRole('button', { name: 'Duplicate card', exact: true }).click();
  await expect(c.locator('.library-organizer')).toContainText('The library changed'); await c.getByRole('button', { name: 'Close organizer' }).click(); expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(1);
  await c.getByRole('button', { name: 'New folder', exact: true }).click(); await c.getByLabel('Folder name', { exact: true }).fill('Retained folder'); await request.post('/comfy/test/asset-library', { data: { failure: 'before' } }); await c.getByRole('button', { name: 'Create folder', exact: true }).click();
  await expect(c.getByRole('button', { name: 'Create folder', exact: true })).toBeDisabled(); await c.getByRole('button', { name: 'Close organizer' }).click(); await c.getByRole('button', { name: 'Retry exact library change', exact: true }).click();
  await expect(folder(c, 'Retained folder')).toBeVisible(); expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(2);
});
test('older H3 catalogs keep folder browsing while conditional organization stays unavailable', async ({ page, request }) => {
  const c = await attach(page); await request.post('/comfy/test/asset-library', { data: { legacy: true } }); await c.locator('.project-panel:visible').getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(c.getByRole('button', { name: 'New folder', exact: true })).toBeDisabled(); await folder(c, 'Cast').click(); await organize(c, 'hero'); await expect(c.getByRole('button', { name: 'Duplicate card', exact: true })).toBeDisabled();
});
test('folder and deletion controls remain reachable at 1280 by 720', async ({ page }) => {
  const c = await attach(page); await c.setViewportSize({ width: 1280, height: 720 }); await organize(c, 'hero'); await c.getByRole('button', { name: 'Delete asset…', exact: true }).scrollIntoViewIfNeeded(); await expect(c.getByRole('button', { name: 'Delete asset…', exact: true })).toBeInViewport(); await c.screenshot({ path: 'test-results/library-organizer-compact.png', fullPage: true });
  await c.getByRole('button', { name: 'Close organizer' }).click(); await c.getByRole('button', { name: 'New folder', exact: true }).scrollIntoViewIfNeeded(); await expect(c.getByRole('button', { name: 'New folder', exact: true })).toBeInViewport(); await c.screenshot({ path: 'test-results/library-bins-compact.png', fullPage: true });
});
