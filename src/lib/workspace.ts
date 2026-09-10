export const workspacePages = ['media', 'edit', 'generate', 'finish', 'audio', 'deliver'] as const;
export type WorkspacePage = typeof workspacePages[number];
export type PanelLayout = { left: number; right: number; timeline: number; source: number; bin: boolean; inspector: boolean; dual: boolean };
export type WorkspacePreferences = { page: WorkspacePage; layouts: Record<WorkspacePage, PanelLayout> };
export const workspaceKey = 'sceneweaver.workspace.v1';
export const defaultLayout = (): PanelLayout => ({ left: 238, right: 302, timeline: 224, source: 42, bin: true, inspector: true, dual: false });
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export function normalizeLayout(value: unknown = {}): PanelLayout {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<PanelLayout> : {};
  const result = defaultLayout();
  for (const key of ['bin', 'inspector', 'dual'] as const) if (typeof raw[key] === 'boolean') result[key] = raw[key];
  for (const [key, min, max] of [['left', 180, 440], ['right', 240, 520], ['timeline', 140, 500], ['source', 25, 65]] as const) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) result[key] = clamp(raw[key], min, max);
  }
  return result;
}
export function readWorkspace(storage: Pick<Storage, 'getItem'>): WorkspacePreferences {
  let value: Partial<WorkspacePreferences> = {};
  try { value = JSON.parse(storage.getItem(workspaceKey) || '{}') || {}; } catch { /* Fresh defaults remain usable. */ }
  return { page: workspacePages.includes(value.page!) ? value.page! : 'edit', layouts: Object.fromEntries(workspacePages.map(page => [page, normalizeLayout(value.layouts?.[page])])) as WorkspacePreferences['layouts'] };
}
export function fitWorkspace(layout: PanelLayout, width: number, height: number) {
  const center = layout.dual ? 560 : 360;
  let bin = layout.bin, inspector = layout.inspector;
  if (width < (bin ? layout.left + 6 : 0) + (inspector ? layout.right + 6 : 0) + center) bin = false;
  if (width < (inspector ? layout.right + 6 : 0) + center) inspector = false;
  return { ...layout, bin, inspector, timeline: clamp(layout.timeline, 140, Math.max(140, height - 270)) };
}
