import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const starter = JSON.parse(readFileSync('public/examples/h3-starter.api.json', 'utf8'));
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request, page }) => {
  await request.put('/api/connection', { data: { target } });
  await request.post('/comfy/test/reset'); await request.post('/comfy/test/playback');
  await page.addInitScript(prompt => localStorage.setItem('sceneweaver.project.v1', JSON.stringify({ name: 'Timeline test', prompt, bindings: {}, warnings: [] })), starter);
  await page.goto('/');
  await expect(page.locator('.viewer-canvas video')).toHaveAttribute('src', /final-alt.webm/);
  await expect(page.getByRole('slider', { name: 'Timeline playhead' })).toHaveAttribute('aria-valuemax', String(20 + 124 / 24));
});

async function rulerPoint(page: Page, scene: number, fraction: number) {
  const box = (await page.locator('.ruler > div').nth(scene).boundingBox())!;
  return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
}
async function clickRuler(page: Page, scene: number, fraction: number) {
  const point = await rulerPoint(page, scene, fraction); await page.mouse.click(point.x, point.y);
}
async function expectTime(page: Page, seconds: number) {
  await expect.poll(() => page.getByRole('slider', { name: 'Seek sequence', exact: true }).inputValue().then(Number)).toBeCloseTo(seconds, 2);
  await expect(page.getByRole('slider', { name: 'Timeline playhead' })).toHaveAttribute('aria-valuenow', String(seconds));
}

test('ruler clicks seek across scenes with aligned video, audio, captions, and widened short clips', async ({ page }) => {
  await clickRuler(page, 1, 2 / 4.5); await expectTime(page, 12);
  await expect(page.locator('.viewer-canvas video')).toHaveAttribute('src', /second.webm/);
  await expect.poll(() => page.locator('.viewer-canvas video').evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 2);
  await expect.poll(() => page.getByTestId('source-audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(14, 2);
  await expect.poll(() => page.getByTestId('generated-audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(2, 2);
  await expect(page.getByTestId('subtitle-overlay')).toHaveText('Second scene caption');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');

  await clickRuler(page, 0, .5); await expectTime(page, 1);
  await expect(page.locator('.viewer-canvas video')).toHaveAttribute('src', /final-alt.webm/);
  await expect.poll(() => page.locator('.viewer-canvas video').evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(1, 2);
  const expectedX = (await rulerPoint(page, 0, .5)).x;
  expect((await page.locator('.playhead').boundingBox())!.x).toBeCloseTo(expectedX, 0);
  await page.screenshot({ path: 'test-results/timeline-seek.png', fullPage: true });
});

test('ruler drag scrubs gaps, stays accurate when zoomed and scrolled, and supports frame keys', async ({ page }) => {
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  const start = await rulerPoint(page, 1, .5), first = (await page.locator('.ruler > div').first().boundingBox())!;
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(first.x + first.width + 4 * 23, start.y, { steps: 5 }); await page.mouse.up();
  await expectTime(page, 6);
  await expect(page.getByRole('heading', { name: 'Timeline gap' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play preview', exact: true })).toBeVisible();
  await expect.poll(() => page.getByTestId('source-audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeCloseTo(8, 2);
  expect(await page.getByTestId('source-audio').evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);

  await page.getByRole('slider', { name: 'Timeline zoom', exact: true }).fill('3');
  await page.locator('.timeline-scroll').evaluate(element => { element.scrollLeft = 250; });
  expect(await page.locator('.timeline-scroll').evaluate(element => element.scrollLeft)).toBe(250);
  await clickRuler(page, 1, 1 / 3); await expectTime(page, 11.5);
  const ruler = page.getByRole('slider', { name: 'Timeline playhead' });
  await ruler.press('Home'); await expectTime(page, 0);
  await ruler.press('ArrowRight'); await expectTime(page, 1 / 24);
  await ruler.press('Shift+ArrowRight'); await expectTime(page, 1 + 1 / 24);
  await ruler.press('End'); await expectTime(page, 20 + 124 / 24);
});

test('timeline seeks retain independent source previews and return from other pages, and clip double-clicks retain their position', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Preview scene take' }).selectOption('base');
  await expect(page.locator('.source-canvas video')).toHaveAttribute('src', /base.webm/);
  await expect(page.getByRole('button', { name: 'Sequence', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await clickRuler(page, 0, .5); await expectTime(page, 1);
  await expect(page.getByRole('button', { name: 'Sequence', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.viewer-canvas video')).toHaveAttribute('src', /final-alt.webm/);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.locator('.viewer-canvas video')).toBeHidden();
  await clickRuler(page, 1, 2 / 4.5); await expectTime(page, 12);
  await expect(page.locator('.viewer-canvas video')).toHaveAttribute('src', /second.webm/);
  await expect.poll(() => page.locator('.viewer-canvas video').evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 2);
  const first = page.getByRole('button', { name: 'Select scene 1: the_arrival', exact: true });
  const box = (await first.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + 20); await expectTime(page, 1);
  await page.getByRole('button', { name: 'Select scene 2: a_moment_of_stillness', exact: true }).click(); await expectTime(page, 10);
});
