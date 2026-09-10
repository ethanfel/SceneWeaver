import { describe, expect, it } from 'vitest';
import { defaultLayout, fitWorkspace, normalizeLayout, readWorkspace } from './workspace';

describe('workspace preference recovery', () => {
  it('recovers malformed and unavailable browser storage', () => {
    for (const raw of ['broken', 'null', '[]', '42', '{"page":"obsolete","layouts":{"edit":null,"media":[]}}']) {
      const restored = readWorkspace({ getItem: () => raw });
      expect(restored.page).toBe('edit');
      expect(restored.layouts.edit).toEqual(defaultLayout());
    }
    expect(readWorkspace({ getItem: () => { throw new Error('Storage disabled'); } }).layouts.audio).toEqual(defaultLayout());
  });
  it('restores independent page layouts and clamps invalid geometry', () => {
    const restored = readWorkspace({ getItem: () => JSON.stringify({ page: 'audio', layouts: { edit: { left: 320, dual: true }, audio: { right: 500, timeline: 999, source: -20, bin: false } } }) });
    expect(restored.page).toBe('audio');
    expect(restored.layouts.edit).toMatchObject({ left: 320, dual: true, bin: true });
    expect(restored.layouts.audio).toMatchObject({ right: 500, timeline: 500, source: 25, bin: false });
    expect(normalizeLayout({ left: NaN, right: Infinity })).toEqual(defaultLayout());
  });
  it('makes room for two viewers without overwriting a preferred layout', () => {
    const layout = Object.freeze({ ...defaultLayout(), dual: true });
    expect(fitWorkspace(layout, 990, 450)).toMatchObject({ bin: false, inspector: true, timeline: 180 });
    expect(fitWorkspace(layout, 768, 500)).toMatchObject({ bin: false, inspector: false });
    expect(fitWorkspace(layout, 1440, 750)).toEqual(layout);
  });
});
