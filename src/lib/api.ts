import type { MediaFile } from '../types';
import { parseJSON } from './workflow';
export const H3 = '/minimax_h3_context_loop';
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, signal: options.signal || AbortSignal.timeout(30000), headers: { ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const text = await response.text();
  let data: unknown;
  try { data = text ? parseJSON(text) : {}; } catch { throw new Error(`HTTP ${response.status}: server returned a non-JSON response.`); }
  if (!response.ok) {
    const body = data as { error?: unknown; node_errors?: unknown };
    throw new Error(typeof body.error === 'string' ? body.error : JSON.stringify(body.error || data) + (body.node_errors ? `\n${JSON.stringify(body.node_errors, null, 2)}` : ''));
  }
  return data as T;
}
export const comfy = <T,>(path: string, options?: RequestInit) => request<T>(`/comfy${path}`, options);
export const post = <T,>(path: string, data: unknown) => comfy<T>(path, { method: 'POST', body: JSON.stringify(data) });
export function mediaUrl(file?: MediaFile) {
  return file?.filename ? `/comfy/view?${new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' })}` : '';
}
