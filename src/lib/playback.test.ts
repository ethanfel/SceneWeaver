import { describe, expect, it } from 'vitest';
import { checkpointMedia, parseSubtitles, playbackSegments, revisionMedia, subtitleAt } from './playback';
import type { Checkpoint, Revision } from '../types';
const file = (filename: string) => ({ filename, subfolder: 'test', type: 'output' });
const checkpoint: Checkpoint = { scene: 1, scene_id: 'one', revision: 'base', ready: true, raw_frames: 124, delivered_frames: 108, video: file('base.mp4'), audio: file('base.wav'), presentation_video: file('alternate.mp4'), presentation_revision: 'alternate' };
describe('H3 presentation playback', () => {
  it('uses the selected alternate picture with base audio and keeps the generation base available', () => {
    expect(checkpointMedia(checkpoint).url).toContain('alternate.mp4');
    expect(checkpointMedia(checkpoint).audioUrl).toContain('base.wav');
    expect(checkpointMedia(checkpoint, false).url).toContain('base.mp4');
  });
  it('avoids doubling the sound already muxed into a review preview', () => {
    expect(checkpointMedia({ ...checkpoint, presentation_video: undefined, preview_video: file('review.mp4') }).audioUrl).toBe('');
    expect(checkpointMedia({ ...checkpoint, preview_video: file('review.mp4') }).audioUrl).toContain('base.wav');
  });
  it('pairs archived picture alternates with the correct parent take audio', () => {
    const alternate = { ...checkpoint, revision: 'old-alt', take_kind: 'editorial_alternate', alternate_of_revision: 'old-base', video: file('old-alt.mp4'), preview_video: file('wrong-review.mp4'), audio: file('alternate-generated.wav') } as Revision;
    const base = { ...checkpoint, revision: 'old-base', audio: file('old-base.wav') } as Revision;
    const media = revisionMedia(alternate, [alternate, base], [checkpoint]);
    expect(media.url).toContain('old-alt.mp4'); expect(media.audioUrl).toContain('old-base.wav');
  });
  it('maps clips to saved editorial trims and placements for soundtrack/subtitle timing', () => {
    const plan = { shots: [{ id: 'one', length: 124 }, { id: 'two', length: 124 }, { id: 'three', length: 124 }] };
    const segments = playbackSegments(plan, {}, [checkpoint], { trims: [{ scene_id: 'one', out_frame: 48 }], placements: [{ scene_id: 'two', start_frame: 480 }] });
    expect(segments.map(s => s.id)).toEqual(['one', 'three', 'two']);
    expect(segments[0]).toMatchObject({ start: 0, duration: 2, estimated: false });
    expect(segments[1].start).toBeCloseTo(2 + 124 / 24);
    expect(segments[2].start).toBe(20);
  });
  it('does not match old checkpoints to a renamed scene', () => {
    expect(playbackSegments({ shots: [{ id: 'renamed', length: 124 }] }, {}, [checkpoint])[0]).toMatchObject({ estimated: true, duration: 124 / 24 });
  });
});
describe('timed project captions', () => {
  it('parses multiline SRT and applies the native positive offset', () => {
    const cues = parseSubtitles('1\r\n00:00:01,500 --> 00:00:03,000\r\nFirst line\r\nSecond line\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nLater');
    expect(cues).toHaveLength(2); expect(subtitleAt(cues, 2, 1)).toBe('');
    expect(subtitleAt(cues, 2.5, 1)).toBe('First line\nSecond line');
    expect(subtitleAt(cues, 4, 1)).toBe('');
  });
  it('parses LRC timestamps, repeated lines, and track offsets', () => {
    const cues = parseSubtitles('[offset:500]\n[00:01.25][00:05.000]Shared lyric\n[00:08.00]Last line');
    expect(cues.map(c => c.start)).toEqual([1.75, 5.5, 8.5]);
    expect(subtitleAt(cues, 6)).toBe('Shared lyric');
  });
  it('supports inline timestamps without interpreting markup as HTML', () => {
    const cues = parseSubtitles('00:01.000 --> 00:02.000 <img src=x onerror=alert(1)>\n00:03.000 --> 00:04.000 Next');
    expect(cues).toHaveLength(2); expect(cues[0].text).toBe('<img src=x onerror=alert(1)>');
    expect(parseSubtitles('Untimed text only')).toEqual([]);
  });
});
