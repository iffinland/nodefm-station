import { describe, expect, it, vi } from 'vitest';
import type { IAudioMetadata, IPicture } from 'music-metadata';
import { parseBlob } from 'music-metadata';
import {
  extractEmbeddedAudioMetadata,
  metadataFromMusicMetadata,
  normalizeEmbeddedGenres,
  normalizeEmbeddedReleaseDate,
  selectEmbeddedPicture,
} from './services/audioMetadata';

vi.mock('music-metadata', () => ({
  parseBlob: vi.fn(),
}));

const mockedParseBlob = vi.mocked(parseBlob);

function picture(format = 'image/jpeg', data = new Uint8Array([1, 2, 3])): IPicture {
  return { format, data, name: 'cover.jpg' };
}

function parsed(overrides: Partial<IAudioMetadata> = {}): IAudioMetadata {
  return {
    common: {
      track: { no: 1, of: null },
      disk: { no: null, of: null },
      movementIndex: { no: null, of: null },
      artist: 'Test Artist',
      title: 'Test Title',
      album: 'Test Album',
      releasedate: '2021-05-01T00:00:00Z',
      genre: ['Rock; Electronic', 'Jazz'],
      picture: [picture()],
    },
    format: { trackInfo: [], tagTypes: [], duration: 185.25 },
    native: {},
    quality: { warnings: [] },
    ...overrides,
  };
}

describe('embedded audio metadata normalization', () => {
  it('extracts Artist, Title, Album, release date, and genres', () => {
    const result = metadataFromMusicMetadata(parsed());

    expect(result.artist).toBe('Test Artist');
    expect(result.title).toBe('Test Title');
    expect(result.album).toBe('Test Album');
    expect(result.releaseDate).toBe('2021-05-01');
    expect(result.genres).toEqual(['Rock', 'Electronic', 'Jazz']);
    expect(result.durationMs).toBe(185250);
  });

  it('falls back to year for release date and rejects malformed dates', () => {
    expect(normalizeEmbeddedReleaseDate(undefined, 1999)).toBe('1999');
    expect(normalizeEmbeddedReleaseDate('not-a-date', undefined)).toBe('');
    expect(normalizeEmbeddedReleaseDate('2023-02-29', undefined)).toBe('');
  });

  it('normalizes and deduplicates embedded genres to taxonomy limits', () => {
    expect(normalizeEmbeddedGenres(['Rock', ' rock ', 'Pop; Jazz'])).toEqual([
      'Rock',
      'Pop',
      'Jazz',
    ]);
  });

  it('selects supported embedded artwork and ignores unsupported picture formats', () => {
    expect(selectEmbeddedPicture([picture()])?.format).toBe('image/jpeg');
    expect(selectEmbeddedPicture([picture('image/svg+xml')])).toBeNull();
    expect(selectEmbeddedPicture(undefined)).toBeNull();
  });

  it('returns missing metadata as empty values rather than throwing', () => {
    const result = metadataFromMusicMetadata(
      parsed({
        common: {
          track: { no: null, of: null },
          disk: { no: null, of: null },
          movementIndex: { no: null, of: null },
          title: '',
          artist: undefined,
          album: undefined,
          genre: undefined,
          picture: undefined,
        },
        format: { trackInfo: [], tagTypes: [] },
      }),
    );

    expect(result).toEqual({
      artist: '',
      title: '',
      album: '',
      releaseDate: '',
      genres: [],
      durationMs: null,
      picture: null,
    });
  });
});

describe('extractEmbeddedAudioMetadata', () => {
  it('delegates to music-metadata parseBlob and normalizes the result', async () => {
    mockedParseBlob.mockReset();
    mockedParseBlob.mockResolvedValue(parsed());

    const file = new File(['audio'], 'A - B.mp3', { type: 'audio/mpeg' });
    const result = await extractEmbeddedAudioMetadata(file);

    expect(mockedParseBlob).toHaveBeenCalledWith(file);
    expect(result.artist).toBe('Test Artist');
    expect(result.picture?.fileName).toBe('cover.jpg');
  });
});
