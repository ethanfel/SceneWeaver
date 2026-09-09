import type { Checkpoint, Editorial, Plan, PlaybackSegment, PreviewMedia, Revision, SubtitleCue, Value } from '../types';
import { checkpointFor, rawFrames } from './h3';
import { H3, mediaUrl } from './api';

export type SequenceEntry = PlaybackSegment & { media: PreviewMedia };
export type SequenceSpan = { start: number; duration: number; entry?: SequenceEntry };
export function sequenceDuration(entries: SequenceEntry[]) {
  const last = entries.at(-1); return last ? last.start + last.duration : 0;
}
// Gaps occupy real timeline time. At the final boundary retain the last frame.
export function sequenceSpan(entries: SequenceEntry[], seconds: number): SequenceSpan | undefined {
  let end = 0;
  for (const entry of entries) {
    if (seconds < entry.start) return { start: end, duration: entry.start - end };
    end = entry.start + entry.duration;
    if (seconds < end) return { start: entry.start, duration: entry.duration, entry };
  }
  const entry = entries.at(-1);
  return entry ? { start: entry.start, duration: entry.duration, entry } : undefined;
}

export function checkpointMedia(checkpoint: Checkpoint, usePresentation = true): PreviewMedia {
  const replacement = usePresentation && checkpoint.presentation_video;
  const video = replacement || checkpoint.preview_video || checkpoint.video;
  return { url: mediaUrl(video), name: checkpoint.scene_id, kind: 'video', scene: checkpoint.scene, sceneId: checkpoint.scene_id,
    // H3 review MP4s already include audio; raw and alternate pictures need a WAV.
    audioUrl: replacement || !checkpoint.preview_video ? mediaUrl(checkpoint.audio) : '' };
}
export function checkpointThumbnailUrl(runName: string, checkpoint?: Checkpoint, server = '') {
  if (!runName || !checkpoint?.ready || !checkpointMedia(checkpoint).url) return '';
  // A selected replacement must have its own revision; never show the base
  // picture underneath an alternate label when its identity is unavailable.
  const revision = String(checkpoint.presentation_video ? checkpoint.presentation_revision || '' : checkpoint.revision).trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(revision)) return '';
  const query = new URLSearchParams({ run_name: runName, scene: String(checkpoint.scene), revision });
  // The local proxy URL stays the same when switching ComfyUI servers. Keep
  // their immutable thumbnail responses in separate browser cache entries.
  if (checkpoint.working_branch_id && checkpoint.working_branch_id !== 'main') query.set('branch_id', checkpoint.working_branch_id);
  if (server) query.set('sceneweaver_source', server);
  return `/comfy${H3}/plan-studio/checkpoint-thumbnail?${query}`;
}
export function revisionMedia(revision: Revision, revisions: Revision[], checkpoints: Checkpoint[]): PreviewMedia {
  if (revision.take_kind !== 'editorial_alternate' && revision.alternate_media_mode !== 'picture_only') return checkpointMedia(revision, false);
  const base = revisions.find(item => item.scene === revision.scene && item.revision === revision.alternate_of_revision)
    || checkpoints.find(item => item.scene === revision.scene && item.revision === revision.alternate_of_revision);
  return { url: mediaUrl(revision.video || revision.preview_video), audioUrl: mediaUrl(base?.audio || revision.audio), name: revision.scene_id, kind: 'video', scene: revision.scene, sceneId: revision.scene_id };
}
export function playbackSegments(plan: Plan | null, inputs: Record<string, Value>, checkpoints: Checkpoint[], editorial?: Editorial | null): PlaybackSegment[] {
  let natural = 0, cursor = 0;
  return (plan?.shots || []).map((shot, index) => {
    const checkpoint = checkpointFor(checkpoints, shot, index), id = shot.id || `scene_${index + 1}`;
    const full = checkpoint?.ready && checkpoint.delivered_frames > 0 ? checkpoint.delivered_frames : rawFrames(shot, plan!, inputs);
    const trim = editorial?.trims?.find(item => item.scene_id === id)?.out_frame;
    const frames = Number.isInteger(trim) && trim! > 0 && trim! <= full ? trim! : full;
    const placement = editorial?.placements?.find(item => item.scene_id === id)?.start_frame;
    const explicit = Number.isInteger(placement) && placement! >= 0;
    const requested = explicit ? placement! : natural; natural += frames;
    return { index, id, requested, explicit, frames, estimated: !checkpoint?.ready };
  }).sort((a, b) => a.requested - b.requested || Number(b.explicit) - Number(a.explicit) || a.index - b.index)
    .map(item => { const start = Math.max(cursor, item.requested); cursor = start + item.frames; return { index: item.index, id: item.id, start: start / 24, duration: item.frames / 24, estimated: item.estimated }; });
}
function timestamp(value: string) {
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts.every(Number.isFinite) ? parts.reduce((total, part) => total * 60 + part, 0) : NaN;
}
export function parseSubtitles(value: string): SubtitleCue[] {
  const text = value.replace(/\r\n?/g, '\n'), cues: SubtitleCue[] = [];
  // SRT / VTT blocks and timestamp ranges written inline with their text.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const range = lines[i].match(/^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d+)(.*)$/);
    if (!range) continue;
    const start = timestamp(range[1]), end = timestamp(range[2]), body: string[] = [];
    if (range[3].trim() && !/\b(?:align|position|line|size):/.test(range[3])) body.push(range[3].trim());
    while (i + 1 < lines.length && lines[i + 1].trim() && !lines[i + 1].includes('-->')) body.push(lines[++i]);
    const content = body.join('\n').trim();
    if (content && Number.isFinite(start) && end > start) cues.push({ start, end, text: content });
  }
  if (cues.length) return cues.sort((a, b) => a.start - b.start);
  const offset = Number(text.match(/^\s*\[offset:([+-]?\d+)\]/mi)?.[1] || 0) / 1000;
  const starts: { start: number; text: string }[] = [];
  for (const line of lines) {
    const body = line.replace(/\[[^\]]*\]/g, '').trim(); if (!body) continue;
    for (const match of line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)) starts.push({ start: Math.max(0, Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || '0'}`) + offset), text: body });
  }
  starts.sort((a, b) => a.start - b.start);
  return starts.map((cue, i) => ({ ...cue, end: Math.max(cue.start + .1, starts[i + 1]?.start ?? cue.start + 4) }));
}
export function subtitleAt(cues: SubtitleCue[], timelineSeconds: number, offset = 0) {
  const clock = timelineSeconds - offset;
  return cues.find(cue => clock >= cue.start && clock < cue.end)?.text || '';
}
