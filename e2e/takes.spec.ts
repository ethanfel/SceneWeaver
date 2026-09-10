import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request, page }) => {
  await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes');
  // Remote Docker ComfyUI commonly runs on plain HTTP, without crypto.subtle.
  await page.addInitScript(() => Object.defineProperty(crypto, 'subtle', { value: undefined }));
});
async function attach(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const popup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click();
  const companion = await popup;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.locator('.viewer-tabs').getByRole('button', { name: 'Takes', exact: true }).click();
  return companion;
}
const take = (page: Page, revision: string) => page.getByRole('article', { name: `Scene 1 take ${revision.repeat(32)}`, exact: true });
const direction = (page: Page) => page.evaluate(() => JSON.parse((window as any).testComfy.graph._nodes.find((node: any) => node.id === '1700').widgets.find((item: any) => item.name === 'plan_json').value).shots[0].prompt);

test('compares pictures with base audio and saves alternate choices into the native final cut', async ({ page, request }) => {
  const companion = await attach(page);
  await take(companion, 'd').getByRole('button', { name: 'Compare takes', exact: true }).click();
  await expect(companion.getByRole('region', { name: 'Take A', exact: true }).locator('video')).toHaveAttribute('src', /final-alt.webm/);
  await expect(companion.getByRole('region', { name: 'Take A', exact: true }).locator('audio')).toHaveAttribute('src', /base.wav/);
  await companion.getByRole('button', { name: 'Play take A', exact: true }).click();
  await expect.poll(() => companion.getByRole('region', { name: 'Take A', exact: true }).locator('audio').evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await companion.getByRole('button', { name: 'Play take B', exact: true }).click();
  await expect.poll(() => companion.getByRole('region', { name: 'Take A', exact: true }).locator('audio').evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await companion.screenshot({ path: 'test-results/take-comparison.png', fullPage: true });
  await take(companion, 'a').getByRole('button', { name: 'Use in final cut', exact: true }).click();
  const thumbnail = companion.getByRole('button', { name: 'Select scene 1: the_arrival', exact: true }).getByRole('img');
  await expect(thumbnail).toHaveAttribute('src', new RegExp(`revision=${'a'.repeat(32)}`));
  await take(companion, 'b').getByRole('button', { name: 'Use in final cut', exact: true }).click();
  await expect(thumbnail).toHaveAttribute('src', new RegExp(`revision=${'b'.repeat(32)}`));
  const state = await (await request.get('/comfy/test/state')).json();
  expect(state.takeActions.map((item: any) => item.action)).toEqual(['final-cut', 'final-cut']);
  expect(state.takeActions[0].body.replacements).toEqual([]);
  expect(state.takeActions[1].body.replacements[0]).toMatchObject({ base_revision: 'a'.repeat(32), alternate_revision: 'b'.repeat(32), media_mode: 'picture_only' });
  expect(state.takeActions[1].body.trims).toEqual([{ scene_id: 'the_arrival', out_frame: 48 }]);
  expect(state.submissions).toEqual([]);
});

test('previews checkpoint impact and restores the chapter with native Plan callbacks', async ({ page, request }) => {
  const companion = await attach(page), before = await direction(page);
  await take(companion, 'd').getByRole('button', { name: 'Restore checkpoint…', exact: true }).click();
  await expect(companion.getByRole('dialog')).toBeVisible();
  await expect(companion.getByRole('dialog')).toContainText('First chapter · scenes 1–2');
  await expect(companion.getByRole('dialog')).toContainText(`Scene 2 · ${'c'.repeat(8)}`);
  await expect(companion.getByRole('dialog')).toContainText('Other chapters have checkpoints');
  expect(await direction(page)).toEqual(before);
  await companion.screenshot({ path: 'test-results/checkpoint-impact.png', fullPage: true });
  await companion.getByRole('button', { name: 'Restore this branch', exact: true }).click();
  await expect(companion.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => direction(page)).toEqual('Earlier checkpoint direction');
  const nativePlan = await page.evaluate(() => JSON.parse((window as any).testComfy.graph._nodes.find((node: any) => node.id === '1700').widgets.find((item: any) => item.name === 'plan_json').value));
  expect(nativePlan.shots[0].seed).toBe('9876543210987654321');
  const state = await (await request.get('/comfy/test/state')).json();
  expect(state.takeActions).toHaveLength(1);
  expect(state.takeActions[0].body).toMatchObject({ activate_only: true, resume_scene: 2, scope_start_scene: 1, scope_end_scene: 2, revisions: [{ scene: 1, revision: 'd'.repeat(32) }] });
  expect(state.submissions).toEqual([]);
  const payload = await (await request.get('/comfy/minimax_h3_context_loop/checkpoints')).json();
  expect(payload.checkpoints.map((item: any) => item.scene)).toEqual([1, 3]);
  expect(payload.revisions).toHaveLength(5);
});

test('rejects stale final-cut choices and invalidates a checkpoint confirmation after another edit', async ({ page, request }) => {
  const companion = await attach(page);
  await request.post('/comfy/test/takes/change');
  await take(companion, 'a').getByRole('button', { name: 'Use in final cut', exact: true }).click();
  await expect(companion.getByRole('alert').getByText('The saved cut changed. Refresh the takes before applying this choice.', { exact: true })).toBeVisible();
  await take(companion, 'd').getByRole('button', { name: 'Restore checkpoint…', exact: true }).click();
  await expect(companion.getByRole('dialog')).toBeVisible();
  await request.post('/comfy/test/takes/change');
  await companion.getByRole('button', { name: 'Restore this branch', exact: true }).click();
  await expect(companion.getByRole('alert').getByText('The checkpoint graph or saved cut changed. Preview the impact again.', { exact: true })).toBeVisible();
  expect((await (await request.get('/comfy/test/state')).json()).takeActions).toEqual([]);
});

test('an older checkpoint read cannot replace a newly saved final-cut picture', async ({ page, request }) => {
  const companion = await attach(page);
  let release!: () => void, captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { captured = resolve; });
  let first = true;
  await companion.route('**/checkpoints?**include_graph=false', async route => {
    if (!first) return route.continue(); first = false;
    const response = await route.fetch(); captured(); await held; await route.fulfill({ response });
  });
  await request.post('/comfy/test/takes/notify'); await ready;
  await take(companion, 'a').getByRole('button', { name: 'Use in final cut', exact: true }).click();
  const thumbnail = companion.getByRole('button', { name: 'Select scene 1: the_arrival', exact: true }).getByRole('img');
  await expect(thumbnail).toHaveAttribute('src', new RegExp(`revision=${'a'.repeat(32)}`));
  const response = companion.waitForResponse(response => response.url().includes('/checkpoints?') && response.url().includes('include_graph=false'));
  release(); await (await response).finished();
  await companion.waitForTimeout(150); // Allow the released read to reach React.
  await expect(thumbnail).toHaveAttribute('src', new RegExp(`revision=${'a'.repeat(32)}`));
});
