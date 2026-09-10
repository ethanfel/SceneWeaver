import { useState } from 'react';
import type { CommandReceipt } from '../types';

const labels: Record<string, string> = { deliver: 'Assemble saved selection', 'generate-range': 'Generate scenes', 'branch-command': 'Working branch', patch: 'Apply draft', queue: 'Queue workflow', 'workflow-save': 'Save workflow', 'take-final-cut': 'Choose final cut', 'checkpoint-activate': 'Restore checkpoint', 'asset-update': 'Edit asset', 'asset-upload': 'Upload asset', 'asset-import': 'Import asset', 'asset-audio-tracks': 'Apply audio tracks' };
const statuses: Record<CommandReceipt['status'], string> = { pending: 'Sent', running: 'In progress', succeeded: 'Completed', rejected: 'Rejected', partial: 'Needs review', uncertain: 'Result unknown' };

export function CommandHistory({ receipts, binding, connected, check, refresh }: { receipts: CommandReceipt[]; binding: string; connected: boolean; check: (id: string) => Promise<unknown>; refresh: () => Promise<unknown> }) {
  const [error, setError] = useState(''), [checking, setChecking] = useState('');
  const visible = receipts.filter(receipt => receipt.binding === binding);
  if (!visible.length) return null;
  return <details className="command-history"><summary>Actions · {statuses[visible[0].status]}</summary><div className="command-history-list">
    <p>Receipts are retained in the ComfyUI tab. Checking a result does not repeat the action.</p>
    {visible.slice(0, 12).map(receipt => <article key={receipt.id}><div><strong>{labels[receipt.action] || receipt.action}</strong><span>{statuses[receipt.status]}</span><time>{new Date(receipt.startedAt).toLocaleTimeString()}</time></div>{receipt.project && <small>{receipt.project}{receipt.branch && ` · ${receipt.branch === 'main' ? 'Original' : receipt.branch.slice(0, 8)}`}</small>}{receipt.prompt_id && <small>ComfyUI job · {receipt.prompt_id}</small>}{receipt.message && <p>{receipt.message}</p>}{['running', 'uncertain', 'partial'].includes(receipt.status) && <button disabled={!connected || Boolean(checking)} onClick={async () => {
      setError(''); setChecking(receipt.id);
      try { await check(receipt.id); await refresh(); }
      catch (error) { setError(String(error)); }
      finally { setChecking(''); }
    }}>{checking === receipt.id ? 'Checking…' : 'Check result'}</button>}</article>)}
    {error && <p role="alert">{error}</p>}
  </div></details>;
}
