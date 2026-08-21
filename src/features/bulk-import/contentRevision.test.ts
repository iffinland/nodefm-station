import { describe, expect, it } from 'vitest';
import {
  computeAudioContentRevision,
  computeCoverContentRevision,
  computeMetadataContentRevision,
  stableContentFingerprint,
} from './contentRevision';

describe('bulk import content revisions', () => {
  it('produces stable fingerprints and different values for different content', () => {
    expect(stableContentFingerprint(['a', 'b'])).toBe(stableContentFingerprint(['a', 'b']));
    expect(stableContentFingerprint(['a', 'b'])).not.toBe(stableContentFingerprint(['a', 'c']));
  });

  it('changes when audio, metadata, or cover content changes', () => {
    expect(
      computeAudioContentRevision({ fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 1 }, 0),
    ).not.toBe(
      computeAudioContentRevision({ fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 2 }, 0),
    );

    expect(
      computeAudioContentRevision({ fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 1 }, 0),
    ).not.toBe(
      computeAudioContentRevision({ fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 1 }, 1),
    );

    const metadataA = { artist: 'A', title: 'T', album: '', releaseDate: '', genres: [], tags: [] };
    const metadataB = { ...metadataA, title: 'T2' };
    expect(computeMetadataContentRevision(metadataA)).not.toBe(
      computeMetadataContentRevision(metadataB),
    );

    expect(
      computeCoverContentRevision({
        origin: 'manual',
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        previewUrl: 'blob:ignored',
      }),
    ).not.toBe(
      computeCoverContentRevision({
        origin: 'manual',
        fileName: 'b.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        previewUrl: 'blob:ignored',
      }),
    );
  });

  it('returns null for absent audio and cover content', () => {
    expect(computeAudioContentRevision(null, 0)).toBeNull();
    expect(computeCoverContentRevision(null)).toBeNull();
  });
});
