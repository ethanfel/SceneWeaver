import { useLayoutEffect, useState, type ReactNode } from 'react';

/** Open lazily, then retain local drafts and filters when changing pages. */
export function WorkspacePanel({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  useLayoutEffect(() => { if (active) setVisited(true); }, [active]);
  return <div className="workspace-page" hidden={!active}>{(active || visited) && children}</div>;
}
