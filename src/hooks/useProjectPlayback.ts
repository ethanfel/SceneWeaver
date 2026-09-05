import { useEffect, useState } from 'react';
import type { Presentation, ProjectAsset, ProjectCatalog } from '../types';
import { comfy, H3 } from '../lib/api';

export function useProjectPlayback(project: string, connected: boolean, target: string) {
  const [value, setValue] = useState<{ project: string; assets: ProjectAsset[]; presentation: Presentation | null; warnings: string[] }>({ project: '', assets: [], presentation: null, warnings: [] });
  useEffect(() => {
    setValue({ project, assets: [], presentation: null, warnings: [] });
    if (!project || !connected) return;
    const controller = new AbortController(); let reading = false;
    const read = async () => {
      if (reading) return; reading = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      const results = await Promise.allSettled([
        comfy<ProjectCatalog>(`${H3}/project-assets?${new URLSearchParams({ project })}`, { signal }),
        comfy<Presentation>(`${H3}/plan-studio/presentation?${new URLSearchParams({ run_name: project })}`, { signal }),
      ]);
      reading = false; if (controller.signal.aborted) return;
      const assets = results[0].status === 'fulfilled' && results[0].value.project === project ? results[0].value.assets || [] : [];
      const presentation = results[1].status === 'fulfilled' && results[1].value.run_name === project ? results[1].value : null;
      const warnings = [results[0].status === 'rejected' ? 'Project captions could not be loaded.' : '', results[1].status === 'rejected' ? 'The saved Plan Studio soundtrack is unavailable. Run Plan Studio in ComfyUI to refresh its presentation.' : ''].filter(Boolean);
      setValue({ project, assets, presentation, warnings });
    };
    void read(); const interval = setInterval(() => void read(), 15000);
    return () => { controller.abort(); clearInterval(interval); };
  }, [project, connected, target]);
  return value.project === project ? value : { project, assets: [], presentation: null, warnings: [] };
}
