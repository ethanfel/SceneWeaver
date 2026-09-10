import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/asset-library'); });
async function open(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const c = await opened;
  await expect(c.getByText('Attached to live workflow', { exact: true })).toBeVisible(); await c.getByRole('button', { name: 'Media', exact: true }).click();
  await c.getByRole('button', { name: 'Other projects', exact: true }).click();
  await expect(c.getByLabel('Source project').locator('option[value="source_film"]')).toHaveCount(1);
  return c;
}
async function select(c: Page, name = 'hero') {
  await c.getByLabel('Source project').selectOption('source_film');
  await c.getByLabel('Source assets').getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(c.getByRole('button', { name: 'Copy into project', exact: true })).toBeEnabled();
}
const plan = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((item: any) => item.id === '1700').widgets.find((item: any) => item.name === 'plan_json').value);

test('other projects browse original media and copy provenance into a destination folder without changing Plan', async ({ page, request }) => {
  const c = await open(page), before = await plan(page); await select(c);
  await expect(c.getByAltText('Original hero')).toHaveAttribute('src', /project=source_film.*variant=original/);
  expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(0);
  await c.getByLabel('Destination folder').selectOption('places'); await expect(c.getByRole('button', { name: 'Copy into project' })).toBeEnabled(); await c.getByRole('button', { name: 'Copy into project' }).click();
  await expect(c.getByRole('status')).toContainText('Copied 1 asset from source_film');
  await c.getByRole('button', { name: 'Close project browser' }).click(); await c.getByRole('button', { name: 'Organize hero_2', exact: true }).click();
  await expect(c.locator('.library-organizer')).toContainText('Copied from source_film'); await expect(c.locator('.library-organizer')).toContainText('source parent original_picture');
  const state = (await (await request.get('/comfy/test/asset-library')).json()); expect(state.catalog.assets.at(-1).folder_id).toBe('places'); expect(await plan(page)).toBe(before);
});
test('a grouped Source track defaults disabled and its copied stems keep destination bindings', async ({ page, request }) => {
  const c = await open(page); await select(c, 'imported_score'); await expect(c.getByLabel('Enable copied asset')).not.toBeChecked();
  await expect(c.locator('.project-import-review')).toContainText('2 assets to copy'); await c.getByLabel('Enable copied asset').check();
  await expect(c.getByRole('button', { name: 'Copy into project' })).toBeDisabled(); await expect(c.getByRole('alert')).toContainText('already has an enabled Source track');
  await c.getByLabel('Enable copied asset').uncheck(); await expect(c.getByRole('button', { name: 'Copy into project' })).toBeEnabled(); await c.getByRole('button', { name: 'Copy into project' }).click();
  await expect(c.getByRole('status')).toContainText('Copied 2 assets');
  const assets = (await (await request.get('/comfy/test/asset-library')).json()).catalog.assets, [mix, vocals] = assets.slice(-2);
  expect(mix.options.audio_tracks.full_mix).toBe(mix.id); expect(mix.options.audio_tracks.vocals).toBe(vocals.id); expect(mix.enabled).toBe(false); expect(vocals.enabled).toBe(false);
});
test('source and target changes reject the reviewed copy until it is refreshed', async ({ page, request }) => {
  const c = await open(page); await select(c); await request.post('/comfy/test/asset-library', { data: { sourceRename: 'Native source tag' } });
  await c.getByRole('button', { name: 'Copy into project' }).click(); await expect(c.locator('.project-import').getByRole('alert')).toContainText('Copy was not confirmed');
  expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(0);
  await c.getByRole('button', { name: 'Refresh copy review' }).click(); await expect(c.locator('.project-import-review li')).toContainText('Native source tag'); await expect(c.getByRole('button', { name: 'Copy into project' })).toBeEnabled();
  await request.post('/comfy/test/asset-library', { data: { rename: 'Native destination folder' } }); await c.getByRole('button', { name: 'Copy into project' }).click();
  await expect(c.locator('.project-import')).toContainText('The destination library changed'); expect((await (await request.get('/comfy/test/asset-library')).json()).actions).toHaveLength(0);
});
test('a prepared import can be resumed after reopening the ComfyUI parent', async ({ page, request }) => {
  const c = await open(page); await select(c, 'imported_score'); await request.post('/comfy/test/asset-library', { data: { failure: 'prepared' } });
  await c.getByRole('button', { name: 'Copy into project' }).click(); await expect(c.locator('.project-import').getByRole('alert')).toContainText('Copy was not confirmed'); await c.close();
  const reopened = await open(page); await expect(reopened.getByRole('button', { name: 'Resume saved import' })).toBeEnabled(); await reopened.getByRole('button', { name: 'Resume saved import' }).click();
  await expect(reopened.getByRole('button', { name: 'Resume saved import' })).toHaveCount(0);
  const state = (await (await request.get('/comfy/test/asset-library')).json()); expect(state.actions).toHaveLength(1); expect(state.actions[0].asset_id).toBe('source_mix'); expect(state.catalog.assets).toHaveLength(6);
});
test('a late source preview cannot replace the newly selected asset review', async ({ page }) => {
  const c = await open(page); let finish: () => void = () => {}; const held = new Promise<void>(resolve => { finish = resolve; }); let started = false;
  await page.route('**/project-assets?*copy_source*', async route => { if (route.request().url().includes('copy_asset=source_hero')) { started = true; await held; } await route.continue(); });
  await c.getByLabel('Source project').selectOption('source_film'); await c.getByLabel('Source assets').getByRole('button', { name: /^hero/ }).click(); await expect.poll(() => started).toBe(true);
  await c.getByLabel('Source assets').getByRole('button', { name: /^imported_score/ }).click(); await expect(c.locator('.project-import-review')).toContainText('2 assets to copy'); finish();
  await expect(c.locator('.project-import-review')).toContainText('2 assets to copy'); await expect(c.locator('.project-import-review h3').first()).toHaveText('imported_score');
});
test('older H3 keeps source browsing and compact layouts keep all copy controls reachable', async ({ page, request }) => {
  const c = await open(page); await select(c); await c.setViewportSize({ width: 1280, height: 720 });
  await expect(c.getByRole('button', { name: 'Copy into project' })).toBeInViewport(); await c.screenshot({ path: 'test-results/project-import-compact.png', fullPage: true });
  await c.getByRole('button', { name: 'Close project browser' }).click(); await request.post('/comfy/test/asset-library', { data: { legacy: true } });
  await c.locator('.project-panel:visible').getByRole('button', { name: 'Refresh', exact: true }).click(); await c.getByRole('button', { name: 'Other projects', exact: true }).click();
  await c.getByLabel('Source project').selectOption('source_film'); await c.getByLabel('Source assets').getByRole('button', { name: /^hero/ }).click(); await expect(c.getByAltText('Original hero')).toBeVisible(); await expect(c.getByRole('button', { name: 'Copy into project' })).toBeDisabled();
  await c.keyboard.press('Escape'); await expect(c.getByRole('dialog', { name: 'Other project media' })).toHaveCount(0);
});
