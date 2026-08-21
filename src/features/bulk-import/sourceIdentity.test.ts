import { describe, expect, it } from 'vitest';
import { sourceDescriptorsMatch } from './sourceIdentity';

describe('source descriptor matching', () => {
  it('requires filename and size equality', () => {
    expect(
      sourceDescriptorsMatch(
        { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 },
        { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 },
      ),
    ).toBe(true);
    expect(
      sourceDescriptorsMatch(
        { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 },
        { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 11 },
      ),
    ).toBe(false);
  });

  it('compares MIME type only when both sides provide one', () => {
    expect(
      sourceDescriptorsMatch(
        { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 },
        { fileName: 'a.mp3', mimeType: '', sizeBytes: 10 },
      ),
    ).toBe(true);
    expect(
      sourceDescriptorsMatch(
        { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 },
        { fileName: 'a.mp3', mimeType: 'audio/ogg', sizeBytes: 10 },
      ),
    ).toBe(false);
  });

  it('never matches a missing current descriptor', () => {
    expect(
      sourceDescriptorsMatch(null, { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 10 }),
    ).toBe(false);
  });
});
