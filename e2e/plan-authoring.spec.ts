import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); });
async function attach(page: Page, shorthand = false) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  await page.evaluate(shorthand => {
    const graph = (window as any).testComfy.graph, plan = graph._nodes.find((n: any) => n.id === '1700');
    const text = shorthand ? '["First scene","Second scene"]' : JSON.stringify({ custom: { retained: true }, shots: [
      { id: 'arrival', prompt: 'First scene', seed: '18446744073709551615' },
      { id: 'landing', prompt: 'Second scene', visual_context_source: 'arrival', audio_context_source: 1 },
      { id: 'corridor', prompt: 'Third scene', visual_context_source: 2, visual_context_start_frame: 4 },
    ], chapters: [{ id: 'opening', title: 'Opening', start_scene_id: 'arrival', text: 'Keep these notes' }] }).replace('"18446744073709551615"', '18446744073709551615');
    graph._nodes.push({ id: 'source', type: 'PrimitiveStringMultiline', title: 'Production Plan text', graph, inputs: [], widgets: [{ name: 'value', value: text, callback() { (window as any).nativeCallbacks++; } }] });
    graph.links[89001] = { origin_id: 'source', origin_slot: 0 };
    plan.inputs.push({ name: 'plan_json_input', link: 89001 });
  }, shorthand);
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const companion = await opened;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible(); return companion;
}
const source = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((n: any) => n.id === 'source').widgets[0].value);
const fallback = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((n: any) => n.id === '1700').widgets.find((w: any) => w.name === 'plan_json').value);

test('duplicates the current prompt draft with native continuity remapping and exact seeds, applying only the source', async ({ page, request }) => {
  const companion = await attach(page), before = await source(page), originalFallback = await fallback(page);
  await companion.getByRole('textbox', { name: 'Scene direction', exact: true }).fill('Unapplied prompt');
  await companion.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(companion.getByLabel('Scene ID', { exact: true })).toHaveValue('arrival_copy');
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toHaveValue('Unapplied prompt');
  expect(await source(page)).toBe(before);
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  const result = JSON.parse(await source(page));
  expect(result.shots.map((s: any) => s.id)).toEqual(['arrival', 'arrival_copy', 'landing', 'corridor']);
  expect(result.shots[1].seed).toBe('18446744073709551615'); expect(result.shots[2].visual_context_source).toBe('arrival_copy'); expect(result.shots[3].visual_context_source).toBe(3);
  expect(result.chapters[0].start_scene_id).toBe('arrival'); expect(result.custom).toEqual({ retained: true }); expect(await fallback(page)).toBe(originalFallback);
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(0);
});

test('renames on explicit action, updates chapters and references, and backs up the native draft', async ({ page }) => {
  const companion = await attach(page), before = await source(page);
  await companion.getByLabel('Scene ID', { exact: true }).fill('New arrival!');
  expect(await source(page)).toBe(before);
  await companion.getByRole('button', { name: 'Rename scene', exact: true }).click();
  await expect(companion.getByLabel('Scene ID', { exact: true })).toHaveValue('New_arrival');
  await expect(companion.getByLabel('Chapter notes')).toHaveValue('Keep these notes');
  await expect(companion.getByText('Draft backed up · apply to sync', { exact: true })).toBeVisible();
  await companion.reload(); await expect(companion.getByRole('dialog', { name: 'Recover prompt draft' })).toBeVisible();
  await companion.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  const result = JSON.parse(await source(page)); expect(result.chapters[0].start_scene_id).toBe('New_arrival'); expect(result.shots[1].visual_context_source).toBe('New_arrival'); expect(result.shots[1].audio_context_source).toBe(1);
});

test('chapter markers and notes use native draft edits without removing their scenes', async ({ page }) => {
  const companion = await attach(page);
  await companion.getByLabel('Chapter title').fill('Act one'); await companion.getByLabel('Chapter notes').fill('Updated notes');
  await companion.getByRole('button', { name: 'Stage chapter', exact: true }).click();
  await expect(companion.locator('.chapter-marker summary')).toHaveText('Chapter · Act one');
  await companion.getByRole('button', { name: 'Remove marker', exact: true }).click();
  await companion.locator('.chapter-marker summary').click();
  await companion.getByRole('button', { name: 'Start chapter here', exact: true }).click();
  await expect(companion.getByLabel('Chapter title')).toHaveValue('Chapter 1');
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  const result = JSON.parse(await source(page)); expect(result.shots).toHaveLength(3); expect(result.chapters[0].start_scene_id).toBe('arrival');
});

test('native shorthand is visible without rewriting it, then duplicates with pinned implicit IDs', async ({ page }) => {
  const companion = await attach(page, true);
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toHaveValue('First scene');
  expect(await source(page)).toBe('["First scene","Second scene"]');
  await companion.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(companion.getByLabel('Scene ID', { exact: true })).toHaveValue('scene_01_copy');
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  expect(JSON.parse(await source(page)).shots.map((s: any) => s.id)).toEqual(['clip_0001', 'scene_01_copy', 'clip_0002']);
});

test('a late native edit cannot overwrite a newer prompt draft', async ({ page }) => {
  await page.context().addInitScript(() => window.addEventListener('message', event => {
    if (event.data?.kind === 'result' && event.data.result?.data?.text && !(window as any).releasePlanEdit) { (window as any).heldPlanEdit = event.data; event.stopImmediatePropagation(); }
  }, { capture: true }));
  const companion = await attach(page);
  await companion.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await companion.waitForFunction(() => Boolean((window as any).heldPlanEdit));
  await expect(companion.getByLabel('Scene ID', { exact: true })).toHaveValue('arrival');
  await companion.getByRole('textbox', { name: 'Scene direction', exact: true }).fill('Newer direction');
  await companion.evaluate(origin => { (window as any).releasePlanEdit = true; window.dispatchEvent(new MessageEvent('message', { data: (window as any).heldPlanEdit, origin, source: window.opener })); }, target);
  await expect(companion.getByRole('alert').filter({ hasText: 'Your newer draft was kept' })).toBeVisible();
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toHaveValue('Newer direction');
  await expect(companion.getByLabel('Scene ID', { exact: true })).toHaveValue('arrival');
  expect(JSON.parse(await source(page)).shots).toHaveLength(3);
});

test('chapter editing remains reachable in the compact workspace', async ({ page }) => {
  const companion = await attach(page); await companion.setViewportSize({ width: 1280, height: 720 });
  await companion.getByLabel('Chapter notes').scrollIntoViewIfNeeded();
  await expect(companion.getByRole('button', { name: 'Stage chapter', exact: true })).toBeInViewport();
  await companion.screenshot({ path: 'test-results/authoring-compact.png', fullPage: true });
});

test('missing native helpers disable structural actions while prompt drafts remain available', async ({ page }) => {
  await page.context().route('**/h3_chain_plan_core.mjs*', route => route.abort());
  const companion = await attach(page);
  await expect(companion.getByRole('button', { name: 'Duplicate', exact: true })).toBeDisabled();
  await expect(companion.getByRole('textbox', { name: 'Scene direction', exact: true })).toBeEnabled();
  await expect(companion.locator('.inspector')).toContainText('requires the native H3 authoring helpers');
});

test('unsubmitted rename and chapter fields reset when attaching another workflow with the same scene IDs', async ({ page }) => {
  const companion = await attach(page), before = await source(page);
  await companion.getByLabel('Scene ID', { exact: true }).fill('Unsubmitted name');
  await companion.getByLabel('Chapter title').fill('Unsubmitted title');
  await page.evaluate(() => { (window as any).testComfy.extensionManager.workflow.activeWorkflow.path = 'workflows/Another workflow.json'; });
  await expect(companion.getByText('ComfyUI tab changed', { exact: true })).toBeVisible();
  await companion.getByRole('button', { name: 'Attach current tab', exact: true }).click();
  await expect(companion.getByLabel('Scene ID', { exact: true })).toHaveValue('arrival');
  await expect(companion.getByLabel('Chapter title')).toHaveValue('Opening');
  expect(await source(page)).toBe(before);
});
