import { useLayoutEffect, useRef, useState, useEffect } from 'react';
import { defaultLayout, fitWorkspace, normalizeLayout, readWorkspace, workspaceKey, type PanelLayout, type WorkspacePage } from '../lib/workspace';

export function useWorkspace() {
  const [preferences, setPreferences] = useState(() => readWorkspace({ getItem: key => window.localStorage.getItem(key) }));
  const [size, setSize] = useState({ width: innerWidth, height: Math.max(430, innerHeight - 250) });
  const [storageError, setStorageError] = useState('');
  const area = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = area.current; if (!node) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      try { localStorage.setItem(workspaceKey, JSON.stringify(preferences)); setStorageError(''); }
      catch { setStorageError('Workspace preferences could not be saved in this browser.'); }
    }, 250);
    return () => clearTimeout(timer);
  }, [preferences]);
  const layout = preferences.layouts[preferences.page];
  const togglePanel = (panel: 'bin' | 'inspector') => setPreferences(current => {
    const desired = { ...current.layouts[current.page] }, visible = fitWorkspace(desired, size.width, size.height);
    desired[panel] = !visible[panel];
    if (desired[panel]) {
      const panelWidth = panel === 'bin' ? desired.left : desired.right;
      if (size.width < panelWidth + 6 + 560) desired.dual = false;
      if (size.width < desired.left + desired.right + 12 + (desired.dual ? 560 : 360)) desired[panel === 'bin' ? 'inspector' : 'bin'] = false;
    }
    return { ...current, layouts: { ...current.layouts, [current.page]: desired } };
  });
  return { area, page: preferences.page, layout, fitted: fitWorkspace(layout, size.width, size.height), size, storageError,
    togglePanel,
    pageTo: (page: WorkspacePage) => setPreferences(current => ({ ...current, page })),
    change: (patch: Partial<PanelLayout>) => setPreferences(current => ({ ...current, layouts: { ...current.layouts, [current.page]: normalizeLayout({ ...current.layouts[current.page], ...patch }) } })),
    reset: () => setPreferences(current => ({ ...current, layouts: { ...current.layouts, [current.page]: defaultLayout() } })),
  };
}
