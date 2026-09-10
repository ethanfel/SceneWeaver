import { useState } from 'react';
import { Save } from 'lucide-react';
import type { LiveResult, WorkflowFileState } from '../types';

export function WorkflowSave({ file, enabled, draftCount, save, report }: { file?: WorkflowFileState; enabled: boolean; draftCount: number; save: () => Promise<LiveResult>; report: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const reason = draftCount ? 'Apply your draft to ComfyUI before saving the workflow.' : file?.reason || '';
  const label = file?.state === 'saved' ? 'Workflow saved' : file?.state === 'modified' ? 'Workflow has unsaved changes' : file?.state === 'temporary' ? 'Workflow not yet named' : 'Workflow save state unknown';
  return <div className="workflow-save"><span title={file?.path}>{draftCount ? `Draft · ${draftCount} change${draftCount === 1 ? '' : 's'}` : 'Draft applied'} · {label}</span><button disabled={!enabled || !file?.canSave || Boolean(draftCount) || busy} title={reason} onClick={async () => {
    setBusy(true); setMessage('');
    try { const result = await save(); if (result.warning) report(result.warning); else setMessage(`Saved ${result.path}`); }
    catch (error) { report(String(error)); }
    finally { setBusy(false); }
  }}><Save size={13}/>{busy ? 'Saving workflow…' : 'Save workflow'}</button>{message && <span role="status">{message}</span>}</div>;
}
