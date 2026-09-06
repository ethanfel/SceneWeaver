import type { Value } from '../types';

export type RelayEvent = {
  channel: string; step?: number; total?: number; media_seq?: number; reset?: boolean;
  sigma?: number; delta?: number; avg_step_ms?: number; preview_ms?: number; w?: number; h?: number;
};
export type RelayMedia = { seq: number; step: number; mime: string; picture: Blob; audio?: Blob };
export type RelayPreview = Omit<RelayMedia, 'picture' | 'audio'> & { url: string; audioUrl?: string };
export type RelaySubscribe = (listener: (value: unknown) => void) => () => void;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function relayChannels(nodes: Record<string, { class_type: string; inputs: Record<string, Value>; mode?: number }>) {
  return [...new Set(Object.values(nodes).filter(node => ['PreviewRelay', 'PreviewRelayTarget'].includes(node.class_type) && node.mode !== 2 && node.mode !== 4)
    .flatMap(node => typeof node.inputs.channel === 'string' ? [node.inputs.channel] : node.inputs.channel === undefined ? ['main'] : []))].sort();
}
export function relayEvent(value: unknown): RelayEvent | null {
  if (!object(value) || typeof value.channel !== 'string') return null;
  const result: RelayEvent = { channel: value.channel };
  for (const key of ['step', 'total', 'media_seq', 'sigma', 'delta', 'avg_step_ms', 'preview_ms', 'w', 'h'] as const) {
    const number = value[key]; if (typeof number === 'number' && Number.isFinite(number) && number >= 0) result[key] = number;
  }
  if (value.reset === true) result.reset = true;
  // Native viewers also broadcast decoding-control echoes on this event name.
  // They must not interrupt restoration of a sample while opening the monitor.
  return result.step !== undefined || result.media_seq !== undefined || result.reset ? result : null;
}
function decodeBlob(value: unknown, mime: string) {
  if (typeof value !== 'string' || !value.length || value.length > 64 * 1024 * 1024) throw new Error('PreviewRelay returned an empty or oversized preview. Reduce the relay’s preview resolution or frame count.');
  let binary: string;
  try { binary = atob(value); } catch { throw new Error('PreviewRelay returned invalid media data.'); }
  return new Blob([Uint8Array.from(binary, character => character.charCodeAt(0))], { type: mime });
}
export function decodeRelayMedia(value: unknown): RelayMedia | null {
  if (!object(value) || value.seq === 0) return null;
  if (!Number.isSafeInteger(value.seq) || Number(value.seq) < 1 || !Number.isSafeInteger(value.step) || Number(value.step) < 0) throw new Error('PreviewRelay returned invalid sample metadata.');
  const mime = typeof value.mime === 'string' ? value.mime : 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'].includes(mime)) throw new Error('This PreviewRelay media format is not supported.');
  const picture = decodeBlob(value.image, mime);
  let audio: Blob | undefined;
  if (value.audio) {
    if (value.audio_mime && value.audio_mime !== 'audio/wav') throw new Error('This PreviewRelay audio format is not supported.');
    audio = decodeBlob(value.audio, 'audio/wav');
  }
  return { seq: Number(value.seq), step: Number(value.step), mime, picture, audio };
}
