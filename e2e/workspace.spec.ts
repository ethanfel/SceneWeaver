import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => {
  await request.put('/api/connection', { data: { target } });
  await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes');
});
async function attach(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const popup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click();
  const companion = await popup;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await expect(companion.locator('.viewer-canvas video')).toHaveAttribute('src', /final-alt.webm/);
  return companion;
}
const navigate = (page: Page, name: string) => page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name, exact: true }).click();
const clock = (page: Page) => page.getByRole('slider', { name: 'Seek sequence', exact: true });
const graph = (page: Page) => page.evaluate(() => (window as any).testComfy.graph.serialize());

test('six pages retain the sequence position and local asset drafts without writing the workflow', async ({ page, request }) => {
  const companion = await attach(page), before = await graph(page);
  await clock(companion).fill('12');
  await navigate(companion, 'Media');
  await companion.getByLabel('Tag for hero', { exact: true }).fill('Unapplied reference tag');
  for (const name of ['Generate', 'Finish', 'Audio', 'Deliver', 'Edit']) {
    await navigate(companion, name);
    await expect(companion.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(companion.getByRole('slider', { name: 'Timeline playhead' })).toHaveAttribute('aria-valuenow', '12');
    await companion.locator('.top-toolbar').getByRole('button', { name: 'Workflow', exact: true }).click();
    await expect(companion.getByRole('complementary', { name: 'Workflow drawer' })).toBeVisible();
    await companion.getByRole('button', { name: 'Close workflow drawer' }).click();
  }
  await expect(clock(companion)).toHaveValue('12');
  await expect.poll(() => companion.locator('.viewer-canvas video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(2, 2);
  await navigate(companion, 'Media');
  await expect(companion.getByLabel('Tag for hero', { exact: true })).toHaveValue('Unapplied reference tag');
  expect(await graph(page)).toEqual(before);
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toEqual([]);
});

test('source clips have their own clock and audio, and only one monitor plays at a time', async ({ page }) => {
  const companion = await attach(page);
  await clock(companion).fill('1');
  await companion.getByRole('combobox', { name: 'Preview scene take' }).selectOption('base');
  const source = companion.locator('.source-canvas video'), sidecar = companion.locator('.source-canvas audio');
  await expect(source).toHaveAttribute('src', /base.webm/);
  await expect(sidecar).toHaveAttribute('src', /base.wav/);
  await companion.getByRole('slider', { name: 'Seek source', exact: true }).fill('3');
  await expect(clock(companion)).toHaveValue('1');
  await expect.poll(() => sidecar.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeCloseTo(3, 1);
  await companion.getByRole('button', { name: 'Play preview', exact: true }).click();
  await companion.getByRole('button', { name: 'Play source', exact: true }).click();
  await expect.poll(() => companion.locator('.viewer-canvas video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await expect.poll(() => sidecar.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  const frozen = await clock(companion).inputValue();
  await expect.poll(() => source.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(3.1);
  await expect(clock(companion)).toHaveValue(frozen);
  // Keyboard activation of the focused source button must not invoke program Space.
  await companion.getByRole('button', { name: 'Pause source', exact: true }).press('Space');
  await expect(companion.getByRole('button', { name: 'Play source', exact: true })).toBeVisible();
  await companion.getByRole('button', { name: 'Play source', exact: true }).click();
  await companion.getByRole('button', { name: 'Play preview', exact: true }).click();
  await expect.poll(() => sidecar.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  await companion.getByRole('button', { name: 'Pause preview', exact: true }).click();
  await companion.setViewportSize({ width: 1280, height: 720 });
  const audioControls = (await companion.locator('.program-viewer .audio-controls').boundingBox())!, program = (await companion.locator('.program-viewer').boundingBox())!;
  expect(audioControls.y + audioControls.height).toBeLessThanOrEqual(program.y + program.height);
  await companion.screenshot({ path: 'test-results/workspace-viewers-1280.png', fullPage: true });
  await navigate(companion, 'Audio');
  await expect.poll(() => companion.locator('.viewer-canvas video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await navigate(companion, 'Edit');
  await expect(companion.getByRole('button', { name: 'Play preview', exact: true })).toBeVisible();
});

test('panel resizing persists per page and adapts to compact windows without destroying preferences', async ({ page }) => {
  const companion = await attach(page), separator = companion.getByRole('separator', { name: 'Resize media pool', exact: true });
  const start = (await separator.boundingBox())!;
  await companion.mouse.move(start.x + 3, start.y + 40); await companion.mouse.down();
  await companion.mouse.move(start.x + 83, start.y + 40, { steps: 6 }); await companion.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '318');
  await companion.getByRole('separator', { name: 'Resize timeline', exact: true }).press('ArrowUp');
  await expect(companion.getByRole('separator', { name: 'Resize timeline', exact: true })).toHaveAttribute('aria-valuenow', '234');
  await navigate(companion, 'Media');
  await expect(separator).toHaveAttribute('aria-valuenow', '238');
  await navigate(companion, 'Edit');
  await companion.getByRole('button', { name: 'Toggle source viewer' }).click();
  await companion.setViewportSize({ width: 990, height: 720 });
  await expect(separator).toHaveCount(0);
  await expect(companion.getByRole('button', { name: 'Play preview', exact: true })).toBeVisible();
  expect(await companion.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => companion.evaluate(() => JSON.parse(localStorage.getItem('sceneweaver.workspace.v1')!).layouts.edit.left)).toBe(318);
  await companion.reload();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.setViewportSize({ width: 1440, height: 1000 });
  await expect(separator).toHaveAttribute('aria-valuenow', '318');
  await companion.getByRole('button', { name: 'Reset workspace layout' }).click();
  await expect(separator).toHaveAttribute('aria-valuenow', '238');
  await expect(companion.getByRole('button', { name: 'Toggle source viewer' })).toHaveAttribute('aria-pressed', 'false');
});

test('take comparisons survive page navigation and pause when hidden or a source plays', async ({ page }) => {
  const companion = await attach(page);
  await companion.locator('.viewer-tabs').getByRole('button', { name: 'Takes', exact: true }).click();
  const take = companion.getByRole('article', { name: `Scene 1 take ${'d'.repeat(32)}`, exact: true });
  await take.getByRole('button', { name: 'Compare takes', exact: true }).click();
  const picture = companion.getByRole('region', { name: 'Take A', exact: true }).locator('video');
  await companion.getByRole('button', { name: 'Play take A', exact: true }).click();
  await navigate(companion, 'Finish');
  await expect.poll(() => companion.locator('.take-comparison video').first().evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await navigate(companion, 'Edit');
  await expect(picture).toBeVisible();
  await companion.getByRole('button', { name: 'Play take A', exact: true }).click();
  await take.getByRole('button', { name: 'Preview take', exact: true }).click();
  await companion.getByRole('button', { name: 'Play source', exact: true }).click();
  await expect.poll(() => picture.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await companion.setViewportSize({ width: 1280, height: 720 });
  await companion.screenshot({ path: 'test-results/workspace-compact.png', fullPage: true });
  expect(await companion.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('image and soundtrack assets preview independently and pause across pages even when both source panes are open', async ({ page, request }) => {
  const companion = await attach(page);
  await clock(companion).fill('1');
  await navigate(companion, 'Media');
  await companion.locator('.asset-card').filter({ has: companion.getByLabel('Tag for hero', { exact: true }) }).locator('.asset-preview').click();
  await expect(companion.locator('.source-canvas img')).toHaveAttribute('alt', 'hero.png');
  await expect(companion.getByRole('button', { name: 'Play source', exact: true })).toBeDisabled();
  await navigate(companion, 'Audio');
  await companion.locator('.asset-card:visible').filter({ has: companion.getByLabel('Tag for score', { exact: true }) }).locator('.asset-preview').click();
  const audio = companion.locator('.source-canvas audio');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await companion.getByRole('button', { name: 'Play source', exact: true }).click();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await companion.getByRole('slider', { name: 'Seek source', exact: true }).fill('5');
  await navigate(companion, 'Media');
  await expect(companion.getByRole('region', { name: 'Source viewer', exact: true })).toBeVisible();
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await expect(companion.getByRole('slider', { name: 'Timeline playhead' })).toHaveAttribute('aria-valuenow', '1');
  await navigate(companion, 'Edit');
  await expect(clock(companion)).toHaveValue('1');
  await expect(companion.locator('.viewer-canvas video')).toHaveAttribute('src', /final-alt.webm/);
  expect((await (await request.get('/comfy/test/state')).json()).takeActions).toEqual([]);
});

test('attaching a different workflow with the same project clears and stops the previous source', async ({ page }) => {
  const companion = await attach(page);
  await companion.getByRole('combobox', { name: 'Preview scene take' }).selectOption('base');
  await companion.getByRole('button', { name: 'Play source', exact: true }).click();
  await companion.locator('.source-canvas video').evaluate(element => { (window as any).previousSource = element; });
  await page.evaluate(() => { (window as any).testComfy.extensionManager.workflow.activeWorkflow = { path: 'workflows/Other.json', filename: 'Other.json' }; });
  await expect(companion.getByText('ComfyUI tab changed', { exact: true })).toBeVisible();
  await companion.getByRole('button', { name: 'Attach current tab' }).click();
  await expect(companion.getByRole('textbox', { name: 'Project name' })).toHaveValue('Other.json');
  await expect(companion.locator('.source-canvas video')).toHaveCount(0);
  expect(await companion.evaluate(() => (window as any).previousSource.paused)).toBe(true);
  await expect(clock(companion)).toHaveValue('0');
});
