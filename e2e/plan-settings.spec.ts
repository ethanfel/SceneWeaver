import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); });
async function attach(page: Page, connectedWidth = false) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  await page.evaluate(connectedWidth => {
    const graph = (window as any).testComfy.graph, plan = graph._nodes.find((n: any) => n.id === '1700');
    for (const [name, value] of Object.entries({ default_duration_seconds: 12, default_steps: 20, width: 960, height: 544, base_seed: '11' })) plan.widgets.find((w: any) => w.name === name).value = value;
    const document = { defaults: { duration_seconds: 6, steps: 12, custom: 'kept' }, global_prompt: ['Shared legacy direction'], shots: [
      { id: 'arrival', prompt: 'First scene', duration_seconds: 1, steps: 8, seed: '18446744073709551615' },
      { id: 'landing', prompt: 'Second scene', visual_context_source: 'arrival' },
      { id: 'corridor', prompt: 'Third scene' },
    ], chapters: [{ id: 'opening', title: 'Opening', start_scene_id: 'arrival', text: 'Keep notes', resolution: { width: 1024, height: 576 } }] };
    graph._nodes.push({ id: 'source', type: 'PrimitiveStringMultiline', title: 'Production Plan text', graph, inputs: [], widgets: [{ name: 'value', value: JSON.stringify(document), callback() { (window as any).nativeCallbacks++; } }] });
    graph.links[89001] = { origin_id: 'source', origin_slot: 0 }; plan.inputs.push({ name: 'plan_json_input', link: 89001 });
    if (connectedWidth) { graph._nodes.push({ id: 'canvas-width', type: 'PrimitiveInt', title: 'Canvas width source', graph, inputs: [], widgets: [{ name: 'value', value: 640 }] }); graph.links[89002] = { origin_id: 'canvas-width', origin_slot: 0 }; plan.inputs.push({ name: 'width', link: 89002 }); }
  }, connectedWidth);
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const companion = await opened;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await expect(companion.getByLabel('Duration source')).toHaveValue('seconds'); return companion;
}
const source = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((n: any) => n.id === 'source').widgets[0].value);
async function apply(companion: Page) { await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click(); await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible(); }

test('requested seconds and exact frames round upward while inheritance clears only scene overrides', async ({ page, request }) => {
  const companion = await attach(page), original = await source(page);
  await companion.getByLabel('Requested seconds', { exact: true }).fill('6'); await companion.getByRole('button', { name: 'Stage scene settings' }).click();
  await expect(companion.locator('.scene-generation-settings')).toContainText('158 raw frames'); expect(await source(page)).toBe(original);
  await apply(companion); expect(JSON.parse(await source(page)).shots[0].duration_seconds).toBe(6);
  await companion.getByLabel('Duration source').selectOption('frames'); await expect(companion.getByLabel('Raw frames', { exact: true })).toHaveValue('158');
  await companion.getByRole('button', { name: 'Stage scene settings' }).click(); await apply(companion);
  let plan = JSON.parse(await source(page)); expect(plan.shots[0].length).toBe(158); expect(plan.shots[0].duration_seconds).toBeUndefined();
  await companion.getByLabel('Duration source').selectOption('default'); await companion.getByLabel('Steps', { exact: true }).fill('');
  await companion.getByRole('button', { name: 'Stage scene settings' }).click(); await apply(companion);
  plan = JSON.parse(await source(page)); expect(plan.shots[0].length).toBeUndefined(); expect(plan.shots[0].steps).toBeUndefined(); expect(plan.defaults).toEqual({ duration_seconds: 6, steps: 12, custom: 'kept' });
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(0);
});

test('invalid exact frames are rejected while retaining the typed value and original Plan', async ({ page }) => {
  const companion = await attach(page), original = await source(page);
  await companion.getByLabel('Duration source').selectOption('frames'); await companion.getByLabel('Raw frames', { exact: true }).fill('24');
  await companion.getByRole('button', { name: 'Stage scene settings' }).click();
  await expect(companion.getByRole('alert')).toContainText('length % 17 == 5'); await expect(companion.getByLabel('Raw frames', { exact: true })).toHaveValue('24');
  expect(await source(page)).toBe(original);
});

test('generation and prompt seeds stay separate and preserve the full uint64 range', async ({ page }) => {
  const companion = await attach(page);
  await companion.getByLabel('Scene seed', { exact: true }).fill(''); await companion.locator('.prompt-alternatives summary').click();
  await companion.getByLabel('Prompt seed mode').selectOption('fixed'); await companion.getByLabel('Prompt seed', { exact: true }).fill('18446744073709551615');
  await companion.getByRole('button', { name: 'Stage scene settings' }).click(); await apply(companion);
  let plan = JSON.parse(await source(page)); expect(plan.shots[0].seed).toBeUndefined(); expect(plan.shots[0].prompt_seed).toBe('18446744073709551615');
  await companion.getByLabel('Requested seconds', { exact: true }).fill('12');
  await companion.locator('.seed-reroll summary').click(); await companion.getByRole('button', { name: 'New generation seed' }).click(); await apply(companion);
  plan = JSON.parse(await source(page)); expect(plan.shots[0].seed).toMatch(/^\d+$/); expect(BigInt(plan.shots[0].seed)).toBeLessThanOrEqual(18446744073709551615n); expect(plan.shots[0].prompt_seed).toBe('18446744073709551615'); expect(plan.shots[0].duration_seconds).toBe(12);
  await companion.locator('.prompt-alternatives summary').click(); await companion.getByLabel('Prompt seed mode').selectOption('randomize');
  await companion.getByRole('button', { name: 'Stage scene settings' }).click(); await apply(companion);
  plan = JSON.parse(await source(page)); expect(plan.shots[0].prompt_seed_mode).toBe('randomize'); expect(plan.shots[0].prompt_seed).toBeUndefined();
});

test('clearing Plan JSON defaults restores node inheritance and preserves custom metadata', async ({ page }) => {
  const companion = await attach(page);
  await companion.locator('.plan-defaults > summary').click(); await companion.getByLabel('Default duration override (seconds)').fill(''); await companion.getByLabel('Default steps override').fill('');
  await companion.getByRole('button', { name: 'Stage Plan defaults' }).click(); await apply(companion);
  const plan = JSON.parse(await source(page)); expect(plan.defaults).toEqual({ custom: 'kept' }); expect(plan.shots[0].duration_seconds).toBe(1);
  await companion.getByLabel('Duration source').selectOption('default'); await expect(companion.locator('.scene-generation-settings')).toContainText('Plan default: 12 s');
});

test('shared direction edits preserve the legacy key and blank paragraphs', async ({ page }) => {
  const companion = await attach(page);
  await companion.locator('.shared-direction > summary').click(); await companion.getByLabel('Shared direction').fill('New direction\n\nKeep continuity');
  await companion.getByRole('button', { name: 'Stage shared direction' }).click(); await apply(companion);
  const plan = JSON.parse(await source(page)); expect(plan.global_prompt).toEqual(['New direction', '', 'Keep continuity']); expect(plan.prompt_prefix).toBeUndefined();
});

test('chapter boundaries and resolution validate before moving the selected marker', async ({ page }) => {
  const companion = await attach(page), original = await source(page);
  await companion.locator('.chapter-geometry > summary').click(); await companion.getByLabel('Chapter starts before').selectOption('landing'); await companion.getByLabel('Chapter width').fill('1000');
  await companion.getByRole('button', { name: 'Stage chapter', exact: true }).click(); await expect(companion.getByRole('alert')).toContainText('multiples of 32'); expect(await source(page)).toBe(original);
  await companion.getByLabel('Chapter width').fill('1024'); await companion.getByRole('button', { name: 'Stage chapter', exact: true }).click();
  await expect(companion.getByLabel('Scene ID', { exact: true })).toHaveValue('landing'); await apply(companion);
  let plan = JSON.parse(await source(page)); expect(plan.chapters[0].start_scene_id).toBe('landing'); expect(plan.chapters[0].resolution).toEqual({ width: 1024, height: 576 });
  await companion.locator('.chapter-geometry > summary').click(); await companion.getByLabel('Chapter resolution').selectOption('inherit');
  await companion.getByRole('button', { name: 'Stage chapter', exact: true }).click(); await apply(companion);
  plan = JSON.parse(await source(page)); expect(plan.chapters[0].resolution).toBeUndefined(); expect(plan.shots).toHaveLength(3);
});

test('connected Plan canvas inputs are inspectable without writing the inactive widget', async ({ page }) => {
  const companion = await attach(page, true);
  await companion.locator('.plan-canvas > summary').click(); await expect(companion.locator('.plan-canvas')).toContainText('Connected input #canvas-width');
  await companion.locator('.plan-canvas').getByRole('button', { name: 'Connected input #canvas-width' }).click();
  await expect(companion.locator('.inspector')).toContainText('Canvas width source'); await companion.getByLabel('value', { exact: true }).fill('704'); await companion.getByLabel('value', { exact: true }).press('Tab'); await apply(companion);
  expect(await page.evaluate(() => { const graph = (window as any).testComfy.graph; return [graph._nodes.find((n: any) => n.id === 'canvas-width').widgets[0].value, graph._nodes.find((n: any) => n.id === '1700').widgets.find((w: any) => w.name === 'width').value]; })).toEqual([704, 960]);
});

test('settings actions remain reachable at 1280 by 720', async ({ page }) => {
  const companion = await attach(page); await companion.setViewportSize({ width: 1280, height: 720 });
  await companion.getByRole('button', { name: 'Stage scene settings' }).scrollIntoViewIfNeeded(); await expect(companion.getByRole('button', { name: 'Stage scene settings' })).toBeInViewport();
  await companion.screenshot({ path: 'test-results/settings-compact.png', fullPage: true });
});
