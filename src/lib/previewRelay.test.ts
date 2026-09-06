import { describe, expect, it } from 'vitest';
import { decodeRelayMedia, relayChannels, relayEvent } from './previewRelay';

describe('PreviewRelay protocol adapter', () => {
  it('discovers literal channels from active relay and target nodes without guessing linked inputs', () => {
    expect(relayChannels({
      a: { class_type: 'PreviewRelay', inputs: { channel: 'film A' } },
      b: { class_type: 'PreviewRelayTarget', inputs: { channel: 'film A' } },
      c: { class_type: 'PreviewRelay', inputs: { channel: ['source', 0] } },
      d: { class_type: 'PreviewRelay', inputs: { channel: 'muted' }, mode: 2 },
      e: { class_type: 'PreviewRelay', inputs: {} },
      f: { class_type: 'Unrelated', inputs: { channel: 'other' } },
    })).toEqual(['film A', 'main']);
  });
  it('accepts finite sampling statistics while retaining exact channel identity', () => {
    expect(relayEvent({ channel: 'film & one', step: 3, total: 20, reset: true, avg_step_ms: Infinity, media_seq: 8 })).toEqual({ channel: 'film & one', step: 3, total: 20, media_seq: 8, reset: true });
    expect(relayEvent({ step: 3 })).toBeNull();
    expect(relayEvent({ channel: 'film A', vae_live: true })).toBeNull();
  });
  it('decodes media and separate WAV audio without interpreting remote markup or URLs', async () => {
    const media = decodeRelayMedia({ seq: 4, step: 2, mime: 'image/webp', image: 'YWJj', audio: 'ZGVm', audio_mime: 'audio/wav' });
    expect(await media?.picture.text()).toBe('abc'); expect(await media?.audio?.text()).toBe('def');
    expect(media?.picture.type).toBe('image/webp'); expect(media?.audio?.type).toBe('audio/wav');
    expect(decodeRelayMedia({ seq: 0 })).toBeNull();
    expect(() => decodeRelayMedia({ seq: 1, step: 1, mime: 'text/html', image: 'YWJj' })).toThrow('not supported');
    expect(() => decodeRelayMedia({ seq: 1, step: 1, image: 'https://untrusted.example/picture' })).toThrow('invalid media');
    expect(() => decodeRelayMedia({ seq: 1, step: 1, image: '' })).toThrow('empty or oversized');
    expect(() => decodeRelayMedia({ seq: -1, step: 1 })).toThrow('metadata');
  });
});
