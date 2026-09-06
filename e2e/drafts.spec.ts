import { test, expect, type Page } from '@playwright/test';
let target = '';
test.beforeAll(async ({ request }) => { target = (await (await request.get('/api/connection')).json()).target; });
test.beforeEach(async ({ request }) => { await request.put('/api/connection', { data: { target } }); await request.post('/comfy/test/reset'); });
async function attach(page: Page) {
  await page.goto(`${target}/test/live`); await page.waitForFunction(() => Boolean((window as any).testComfy));
  const popup = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Open companion' }).click();
  const companion = await popup; await expect(companion.getByText('Attached to live workflow', { exact: true })).toBeVisible(); return companion;
}
const direction = (page: Page) => page.getByRole('textbox', { name: 'Scene direction', exact: true });
const nativeDirection = (page: Page) => page.evaluate(() => JSON.parse((window as any).testComfy.graph._nodes.find((node: any) => node.id === '1700').widgets.find((item: any) => item.name === 'plan_json').value).shots[0].prompt);

test('recovers a prompt draft after refresh, reviews newer native edits, and clears the backup after applying', async ({ page }) => {
  const companion = await attach(page);
  await direction(companion).fill('Recover this direction');
  await expect(companion.getByText('Draft backed up · apply to sync', { exact: true })).toBeVisible();
  await page.evaluate(() => { const widget = (window as any).testComfy.graph._nodes.find((node: any) => node.id === '1700').widgets.find((item: any) => item.name === 'plan_json'); const plan = JSON.parse(widget.value); plan.shots[0].prompt = 'Newer native direction'; widget.value = JSON.stringify(plan); });
  await companion.reload();
  await expect(companion.getByRole('dialog', { name: 'Recover prompt draft' })).toBeVisible();
  await expect(companion.getByRole('dialog')).toContainText('ComfyUI has newer values');
  expect(await nativeDirection(page)).toBe('Newer native direction');
  await companion.getByRole('button', { name: 'Restore draft', exact: true }).click();
  await expect(direction(companion)).toHaveValue('Recover this direction');
  expect(await nativeDirection(page)).toBe('Newer native direction');
  await companion.getByRole('button', { name: 'Apply to ComfyUI', exact: true }).click();
  await expect.poll(() => nativeDirection(page)).toBe('Recover this direction');
  await expect.poll(() => companion.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sceneweaver.live-draft.v1:')))).toEqual([]);
  expect(await companion.evaluate(() => localStorage.getItem('sceneweaver.project.v1'))).toBeNull();
  await companion.reload(); await expect(companion.getByRole('dialog')).toHaveCount(0);
  await expect(direction(companion)).toHaveValue('Recover this direction');
});

test('keeps a draft tied to its workflow and project when the native tab changes', async ({ page }) => {
  const companion = await attach(page);
  await direction(companion).fill('Only for the original workflow');
  await expect(companion.getByText('Draft backed up · apply to sync', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).testComfy.extensionManager.workflow.activeWorkflow = { path: 'workflows/Other.json', filename: 'Other.json' }; });
  await companion.reload();
  await expect(companion.getByRole('textbox', { name: 'Project name' })).toHaveValue('Other.json');
  await expect(companion.getByRole('dialog')).toHaveCount(0);
  expect(await direction(companion).inputValue()).not.toBe('Only for the original workflow');
  await page.evaluate(() => { (window as any).testComfy.extensionManager.workflow.activeWorkflow = { path: 'workflows/Live unsaved.json', filename: 'Live unsaved.json' }; });
  await companion.reload();
  await expect(companion.getByRole('dialog', { name: 'Recover prompt draft' })).toBeVisible();
  await companion.getByRole('button', { name: 'Discard saved draft', exact: true }).click();
  await expect(companion.getByRole('dialog')).toHaveCount(0);
  expect(await direction(companion).inputValue()).not.toBe('Only for the original workflow');
});
