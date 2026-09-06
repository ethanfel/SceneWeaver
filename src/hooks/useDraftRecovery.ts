import { useEffect, useRef, useState } from 'react';
import type { LiveSnapshot, Workflow } from '../types';
import { draftScope, parseSavedDraft, savedDraft, type SavedDraft } from '../lib/drafts';

export function useDraftRecovery(enabled: boolean, server: string, baseline: LiveSnapshot | null, planId: string, workflow: Workflow) {
  const scope = enabled && baseline ? draftScope(server, baseline, planId) : '';
  const [loadedScope, setLoadedScope] = useState(''), [pending, setPending] = useState<SavedDraft | null>(null), [error, setError] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const lastWritten = useRef<string | null>(null);
  useEffect(() => {
    setPending(null); setBackedUp(false); setError(''); lastWritten.current = null;
    if (scope) {
      try { const raw = localStorage.getItem(scope); lastWritten.current = raw; setPending(parseSavedDraft(raw, scope)); }
      catch { setError('The saved draft could not be read. Export your current draft before closing.'); }
    }
    setLoadedScope(scope);
  }, [scope]);
  useEffect(() => {
    if (!scope || loadedScope !== scope || !baseline || pending || error) return;
    try {
      const stored = savedDraft(scope, baseline, workflow), current = localStorage.getItem(scope);
      // Another companion window may share this project. Preserve its draft
      // instead of silently overwriting it with this window's copy.
      if (current !== lastWritten.current) throw new Error('Another SceneWeaver window changed this saved draft. Export your draft to keep both versions.');
      if (stored.edits.length) {
        const raw = JSON.stringify(stored); localStorage.setItem(scope, raw); lastWritten.current = raw; setBackedUp(true);
      } else { localStorage.removeItem(scope); lastWritten.current = null; setBackedUp(false); }
    } catch (error) { setError(error instanceof Error && error.message.startsWith('Another SceneWeaver') ? error.message : 'Browser storage is full or unavailable. Export your draft before closing.'); setBackedUp(false); }
  }, [scope, loadedScope, baseline, workflow, pending, error]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (scope && event.key === scope && event.newValue !== lastWritten.current) { setBackedUp(false); setError('Another SceneWeaver window changed this saved draft. Export your draft to keep both versions.'); }
    };
    window.addEventListener('storage', changed); return () => window.removeEventListener('storage', changed);
  }, [scope]);
  const resolve = () => { setPending(null); setError(''); };
  return { pending: loadedScope === scope ? pending : null, backedUp, error, resolve };
}
