import { describe, expect, it } from 'vitest';
import { createTrack } from '../../tracks/services/trackService';
import { buildAddQdnTrackInput, hasExternalAudioReference } from './addQdnService';

describe('buildAddQdnTrackInput', () => {
  const externalAudio = {
    service: 'AUDIO',
    name: 'external-publisher',
    identifier: 'external-audio-1',
  };

  it('preserves the external AUDIO reference', () => {
    const input = buildAddQdnTrackInput({
      title: 'Track',
      audio: externalAudio,
      durationMs: 1000,
      ownerAddress: 'owner',
    });
    const track = createTrack(input);

    expect(hasExternalAudioReference(track, externalAudio)).toBe(true);
    expect(track.audio).toEqual(externalAudio);
    expect(track.source).toBe('qdn-existing');
  });

  it('includes an optional published station cover reference', () => {
    const cover = { service: 'IMAGE', name: 'NodeFM', identifier: 'nodefm-cover-1' };
    const track = createTrack(
      buildAddQdnTrackInput({
        title: 'Track',
        audio: externalAudio,
        cover,
        durationMs: 1000,
        ownerAddress: 'owner',
      }),
    );

    expect(track.cover).toEqual(cover);
    expect(track.audio).toEqual(externalAudio);
  });

  it('does not require a cover', () => {
    const track = createTrack(
      buildAddQdnTrackInput({
        title: 'Track',
        audio: externalAudio,
        durationMs: 1000,
        ownerAddress: 'owner',
      }),
    );

    expect(track.cover).toBeUndefined();
  });

  it('enforces the QDN tag count and length limits at the domain boundary', () => {
    expect(() =>
      createTrack(
        buildAddQdnTrackInput({
          title: 'Track',
          audio: externalAudio,
          durationMs: 1000,
          ownerAddress: 'owner',
          tags: ['a', 'b', 'c', 'd', 'e', 'f'],
        }),
      ),
    ).toThrow(/at most 5 values/i);

    expect(() =>
      createTrack(
        buildAddQdnTrackInput({
          title: 'Track',
          audio: externalAudio,
          durationMs: 1000,
          ownerAddress: 'owner',
          tags: ['x'.repeat(21)],
        }),
      ),
    ).toThrow(/at most 20 characters/i);
  });
});
