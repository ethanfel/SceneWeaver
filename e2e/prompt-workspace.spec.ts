import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); await request.post('/comfy/test/takes'); });
async function attach(page: Page, available = true) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  await page.evaluate(() => {
    const graph = (window as any).testComfy.graph, plan = graph._nodes.find((n: any) => n.id === '1700'), manager = graph._nodes.find((n: any) => n.id === '9000');
    manager.widgets.find((w: any) => w.name === 'catalog_json').value = JSON.stringify({ project: 'sceneweaver_first_film', assets: [
      { id: 'actor', tag: 'actor', kind: 'image', role: 'picture', enabled: true }, { id: 'anchor', tag: 'anchor', kind: 'image', role: 'semantic_anchor', enabled: true },
    ] });
    graph._nodes.push({ id: 'text', type: 'PrimitiveStringMultiline', title: 'Connected prompt Plan', graph, inputs: [], widgets: [{ name: 'value', value: JSON.stringify({ shots: [
      { id: 'arrival', prompt: ['A woman enters.', '', 'Rain outside.'], seed: '18446744073709551615', custom: true }, { id: 'landing', prompt: ['Second scene.'] },
    ] }), callback() {} }] });
    graph.links[88001] = { origin_id: 'text', origin_slot: 0 }; plan.inputs.push({ name: 'plan_json_input', link: 88001 });
    plan.inputs = plan.inputs.filter((i: any) => i.name !== 'project_assets'); graph.links[88002] = { origin_id: '9000', origin_slot: 0 }; plan.inputs.push({ name: 'project_assets', link: 88002 });
  });
  const opened = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click(); const companion = await opened;
  await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible();
  await companion.getByRole('button', { name: 'Open prompt workspace' }).click();
  if (available) await expect(companion.getByRole('button', { name: 'Preview missing structure' })).toBeEnabled();
  return companion;
}
const source = (page: Page) => page.evaluate(() => (window as any).testComfy.graph._nodes.find((n: any) => n.id === 'text').widgets[0].value);
async function apply(companion: Page) { await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click(); await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible(); }

test('structure is reviewed, staged and applied to the connected source without losing other scene data', async ({ page, request }) => {
  const c = await attach(page), before = await source(page);
  await c.getByRole('button', { name: 'Preview missing structure' }).click();
  await expect(c.getByRole('textbox', { name: 'Proposed', exact: true })).toHaveValue(/integrated_multimodal_description/);
  await expect(c.getByLabel('Expanded scene prompt')).toHaveValue('A woman enters.\n\nRain outside.'); expect(await source(page)).toBe(before);
  await c.getByRole('button', { name: 'Use proposed text' }).click(); await expect(c.getByLabel('Expanded scene prompt')).toHaveValue(/non_diegetic_music/);
  await c.getByRole('button', { name: 'Stage prompt', exact: true }).click(); await expect(c.getByLabel('Scene direction')).toHaveValue(/integrated_multimodal_description/);
  await expect(c.locator('.command-history')).toHaveCount(0);
  expect(await source(page)).toBe(before); await apply(c);
  const result = JSON.parse(await source(page)); expect(result.shots[0].seed).toBe('18446744073709551615'); expect(result.shots[0].custom).toBe(true); expect(result.shots[1].prompt).toEqual(['Second scene.']);
  expect((await (await request.get('/comfy/test/state')).json()).submissions).toHaveLength(0);
});

test('explicit FL2VA alignment proposes the chosen duration and final shot without changing generation mode', async ({ page }) => {
  const c = await attach(page);
  await c.getByLabel('Prompt schema', { exact: true }).selectOption('fl2va');
  await c.getByLabel('Alignment duration (seconds)').fill('8.25'); await c.getByLabel('Final shot number').fill('3');
  await c.getByRole('button', { name: 'Preview missing structure' }).click();
  await expect(c.getByRole('textbox', { name: 'Proposed', exact: true })).toHaveValue(/Picture 2 \(from Shot 3\) aligns with the 8.25-second mark/);
  await c.getByRole('button', { name: 'Dismiss proposal' }).click(); await expect(c.getByLabel('Expanded scene prompt')).toHaveValue('A woman enters.\n\nRain outside.');
});

test('connected project aliases, semantic anchors and H3 dialogue tokens complete at the caret', async ({ page }) => {
  const c = await attach(page), input = c.getByLabel('Expanded scene prompt');
  await input.fill('@ac'); await c.locator('.prompt-completions').getByText('@actor', { exact: true }).click(); await expect(input).toHaveValue('@actor');
  await input.fill('#an'); await c.locator('.prompt-completions').getByText('#anchor', { exact: true }).click(); await expect(input).toHaveValue('#anchor');
  await input.fill('<d'); await c.locator('.prompt-completions').getByText('<d>', { exact: true }).click(); await expect(input).toHaveValue('<d>');
  await c.locator('.prompt-reference-scope > summary').click(); await expect(c.locator('.prompt-reference-scope')).toContainText('connected Carousel #9000');
});

test('highlighted view preserves literal text and cannot interpret HTML as markup', async ({ page }) => {
  const c = await attach(page), text = 'integrated_multimodal_description: [Shot 1] <Subject 1> @actor\n\n<d>Hello</d> <img src=x onerror=alert(1)>';
  await c.getByLabel('Expanded scene prompt').fill(text); await c.getByRole('button', { name: 'Highlighted view' }).click();
  await expect(c.getByLabel('Highlighted prompt')).toHaveText(text); expect(await c.getByLabel('Highlighted prompt').locator('img').count()).toBe(0);
  await c.getByRole('button', { name: 'Plain text', exact: true }).click(); await expect(c.getByLabel('Expanded scene prompt')).toHaveValue(text);
});

test('prompt undo stays local and unstaged text survives scene and page navigation', async ({ page }) => {
  const c = await attach(page), input = c.getByLabel('Expanded scene prompt');
  await input.fill('First local draft'); await input.fill('Second local draft'); await input.press('Control+z'); await expect(input).toHaveValue('First local draft');
  await c.getByRole('button', { name: 'Redo prompt' }).click(); await expect(input).toHaveValue('Second local draft');
  await c.getByRole('button', { name: 'Next scene', exact: true }).click(); await expect(input).toHaveValue('Second scene.'); await input.fill('Other local draft');
  await c.getByRole('button', { name: 'Previous scene', exact: true }).click(); await expect(input).toHaveValue('Second local draft');
  await c.locator('.viewer-tabs').getByRole('button', { name: 'Viewer', exact: true }).click(); await c.locator('.viewer-tabs').getByRole('button', { name: 'Prompt', exact: true }).click();
  await expect(input).toHaveValue('Second local draft'); expect(JSON.parse(await source(page)).shots[0].prompt[0]).toBe('A woman enters.');
});

test('concurrent Inspector edits require explicit reload before a local prompt can be staged', async ({ page }) => {
  const c = await attach(page);
  await c.getByLabel('Expanded scene prompt').fill('Local expanded text'); await c.getByLabel('Scene direction').fill('Newer Inspector draft');
  await expect(c.locator('.prompt-workspace').getByRole('alert')).toContainText('changed elsewhere'); await expect(c.getByRole('button', { name: 'Stage prompt', exact: true })).toBeDisabled();
  await c.getByRole('button', { name: 'Reload scene draft' }).click(); await expect(c.getByLabel('Expanded scene prompt')).toHaveValue('Newer Inspector draft');
  await expect(c.getByRole('button', { name: 'Undo prompt' })).toBeEnabled();
});

test('prompt schema and staging controls remain reachable at 1280 by 720', async ({ page }) => {
  const c = await attach(page); await c.screenshot({ path: 'test-results/prompt-expanded.png', fullPage: true }); await c.setViewportSize({ width: 1280, height: 720 });
  await c.getByRole('button', { name: 'Preview missing structure' }).scrollIntoViewIfNeeded(); await expect(c.getByRole('button', { name: 'Preview missing structure' })).toBeInViewport();
  await c.getByLabel('Expanded scene prompt').fill('Compact viewport edit'); await c.getByRole('button', { name: 'Stage prompt', exact: true }).scrollIntoViewIfNeeded(); await expect(c.getByRole('button', { name: 'Stage prompt', exact: true })).toBeInViewport();
  await c.screenshot({ path: 'test-results/prompt-compact.png', fullPage: true });
});

test('missing prompt helpers leave existing scene settings and basic drafting available', async ({ page }) => {
  await page.route('**/h3_prompt_schema_core.mjs*', route => route.abort());
  const c = await attach(page, false);
  await expect(c.locator('.prompt-workspace')).toContainText('Native prompt tools require');
  await expect(c.getByLabel('Expanded scene prompt')).toBeDisabled();
  await expect(c.getByLabel('Duration source')).toBeEnabled();
  await c.getByLabel('Scene direction').fill('Basic editing still works');
  await apply(c); expect(JSON.parse(await source(page)).shots[0].prompt).toEqual(['Basic editing still works']);
});

test('a late structure proposal cannot replace the newly selected scene', async ({ page }) => {
  const c = await attach(page);
  await c.evaluate(() => {
    const capture = (event: MessageEvent) => {
      if (event.data?.kind !== 'result' || !event.data.result?.data?.proposal) return;
      event.stopImmediatePropagation(); window.removeEventListener('message', capture, true);
      (window as any).releaseProposal = () => window.dispatchEvent(new MessageEvent('message', { data: event.data, origin: event.origin, source: event.source }));
    };
    window.addEventListener('message', capture, true);
  });
  await c.getByRole('button', { name: 'Preview missing structure' }).click();
  await c.waitForFunction(() => Boolean((window as any).releaseProposal));
  await c.locator('.scene-card').nth(1).click(); await c.locator('.viewer-tabs').getByRole('button', { name: 'Prompt', exact: true }).click();
  await c.evaluate(() => (window as any).releaseProposal());
  await expect(c.getByLabel('Expanded scene prompt')).toHaveValue('Second scene.');
  await expect(c.getByRole('button', { name: 'Preview missing structure' })).toBeEnabled();
  await expect(c.getByRole('button', { name: 'Use proposed text' })).toHaveCount(0);
  expect(JSON.parse(await source(page)).shots[1].prompt).toEqual(['Second scene.']);
});
