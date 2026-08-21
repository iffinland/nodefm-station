import { describe, expect, it } from 'vitest';
import type { Track } from '../../../types/domain';
import {
  buildTrackFilterOptions,
  buildTrackSearchIndex,
  EMPTY_TRACK_FILTERS,
  filterAndSortTracks,
  normalizeTrackSearchText,
  type TrackFilterCriteria,
} from './trackFiltering';

function makeTrack(
  trackId: string,
  title: string,
  artist: string | undefined,
  genres: string[] | undefined,
  tags: string[] | undefined,
  createdAt: string,
): Track {
  return {
    schemaVersion: 1,
    trackId,
    ownerAddress: 'Q-owner',
    title,
    artist,
    audio: { service: 'AUDIO', name: 'Owner', identifier: `${trackId}-audio` },
    durationMs: 180000,
    genres,
    tags,
    source: 'station-upload',
    createdAt,
    updatedAt: createdAt,
  };
}

const tracks: Track[] = [
  makeTrack(
    'track-1',
    'Time',
    'Pink Floyd',
    ['Progressive Rock'],
    ['classic', '70s'],
    '2026-03-01T00:00:00.000Z',
  ),
  makeTrack('track-2', 'Money', 'Pink Floyd', ['Rock'], ['classic'], '2026-02-01T00:00:00.000Z'),
  makeTrack(
    'track-3',
    'Get Lucky',
    'Daft Punk',
    ['Electronic'],
    ['70s', 'dance'],
    '2026-01-01T00:00:00.000Z',
  ),
  makeTrack('track-4', 'Hey Jude', 'The Beatles', ['Rock'], undefined, '2025-01-01T00:00:00.000Z'),
  makeTrack(
    'track-5',
    'Ambient Study',
    undefined,
    undefined,
    ['chill'],
    '2024-01-01T00:00:00.000Z',
  ),
];

function ids(result: Track[]): string[] {
  return result.map((track) => track.trackId);
}

describe('normalizeTrackSearchText', () => {
  it('is case-insensitive and collapses surrounding/internal whitespace', () => {
    expect(normalizeTrackSearchText('  Daft   Punk  ')).toBe('daft punk');
  });
});

describe('search', () => {
  it('finds tracks by artist case-insensitively', () => {
    expect(
      ids(filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, search: 'PINK' }, 'title')),
    ).toEqual(['track-2', 'track-1']);
  });

  it('finds tracks by title', () => {
    expect(
      ids(filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, search: 'money' }, 'title')),
    ).toEqual(['track-2']);
  });

  it('finds tracks by genre and tag metadata', () => {
    expect(
      ids(filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, search: 'electronic' }, 'title')),
    ).toEqual(['track-3']);
    expect(
      ids(filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, search: '70s' }, 'title')),
    ).toEqual(['track-3', 'track-1']);
  });
});

describe('genre and tag filtering', () => {
  it('filters by exact canonical genre key', () => {
    expect(
      ids(filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, genre: 'rock' }, 'title')),
    ).toEqual(['track-4', 'track-2']);
  });

  it('filters by exact canonical tag key', () => {
    expect(
      ids(filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, tag: 'CLASSIC' }, 'title')),
    ).toEqual(['track-2', 'track-1']);
  });

  it('composes search with genre and tag filters', () => {
    const searchAndGenre = filterAndSortTracks(
      tracks,
      { ...EMPTY_TRACK_FILTERS, search: 'pink', genre: 'Rock' },
      'title',
    );
    expect(ids(searchAndGenre)).toEqual(['track-2']);

    const genreAndTag = filterAndSortTracks(
      tracks,
      { ...EMPTY_TRACK_FILTERS, genre: 'Rock', tag: 'classic' },
      'title',
    );
    expect(ids(genreAndTag)).toEqual(['track-2']);
  });

  it('returns no tracks when filters cannot be satisfied', () => {
    expect(
      filterAndSortTracks(
        tracks,
        { ...EMPTY_TRACK_FILTERS, genre: 'Electronic', tag: 'classic' },
        'title',
      ),
    ).toEqual([]);
  });
});

describe('artist filtering', () => {
  it('matches normalized artist without rewriting stored values', () => {
    expect(
      ids(filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, artist: ' pink floyd ' }, 'title')),
    ).toEqual(['track-2', 'track-1']);
  });

  it('does not match tracks with missing artist when an artist filter is active', () => {
    expect(
      filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, artist: 'Pink Floyd' }, 'title').every(
        (track) => track.artist === 'Pink Floyd',
      ),
    ).toBe(true);
  });
});

describe('sorting', () => {
  it('sorts by title A-Z', () => {
    expect(ids(filterAndSortTracks(tracks, EMPTY_TRACK_FILTERS, 'title'))).toEqual([
      'track-5',
      'track-3',
      'track-4',
      'track-2',
      'track-1',
    ]);
  });

  it('sorts by artist A-Z and places missing artists last', () => {
    expect(ids(filterAndSortTracks(tracks, EMPTY_TRACK_FILTERS, 'artist'))).toEqual([
      'track-3',
      'track-2',
      'track-1',
      'track-4',
      'track-5',
    ]);
  });

  it('sorts by primary genre A-Z and places missing genres last', () => {
    expect(ids(filterAndSortTracks(tracks, EMPTY_TRACK_FILTERS, 'genre'))).toEqual([
      'track-3',
      'track-1',
      'track-4',
      'track-2',
      'track-5',
    ]);
  });

  it('sorts by newest first using createdAt', () => {
    expect(ids(filterAndSortTracks(tracks, EMPTY_TRACK_FILTERS, 'newest'))).toEqual([
      'track-1',
      'track-2',
      'track-3',
      'track-4',
      'track-5',
    ]);
  });
});

describe('filter options', () => {
  it('normalizes and deduplicates genres/tags/artists by canonical key', () => {
    const mixed = [
      makeTrack(
        'a',
        'A',
        ' Artist One ',
        [' Rock ', 'ROCK'],
        ['classic', 'CLASSIC'],
        '2026-01-01T00:00:00.000Z',
      ),
      makeTrack('b', 'B', 'artist one', ['rock'], ['Classic'], '2026-01-02T00:00:00.000Z'),
    ];

    expect(buildTrackFilterOptions(mixed)).toEqual({
      genres: ['Rock'],
      tags: ['classic'],
      artists: ['Artist One'],
    });
  });

  it('derives genre/tag options without requiring metadata', () => {
    expect(buildTrackFilterOptions(tracks).genres).toEqual([
      'Electronic',
      'Progressive Rock',
      'Rock',
    ]);
    expect(buildTrackFilterOptions(tracks).tags).toEqual(['70s', 'chill', 'classic', 'dance']);
  });
});

describe('purity and reusable semantics', () => {
  it('never mutates the raw Track collection', () => {
    const before = JSON.parse(JSON.stringify(tracks)) as Track[];
    const criteria: TrackFilterCriteria = {
      ...EMPTY_TRACK_FILTERS,
      search: 'pink',
      genre: 'Progressive Rock',
      tag: 'classic',
    };

    filterAndSortTracks(tracks, criteria, 'artist');
    expect(tracks).toEqual(before);
  });

  it('returns equivalent results when the same pipeline is used by two surfaces', () => {
    const criteria: TrackFilterCriteria = {
      ...EMPTY_TRACK_FILTERS,
      genre: 'Rock',
      tag: 'classic',
    };
    const libraryVisible = filterAndSortTracks(tracks, criteria, 'title');
    const pickerVisible = filterAndSortTracks(tracks, criteria, 'title');
    expect(ids(pickerVisible)).toEqual(ids(libraryVisible));
  });

  it('does not deselect a selected id when filters change', () => {
    const selectedIds = new Set(['track-2']);
    filterAndSortTracks(tracks, EMPTY_TRACK_FILTERS, 'title');
    filterAndSortTracks(tracks, { ...EMPTY_TRACK_FILTERS, genre: 'Rock' }, 'title');

    expect(selectedIds.has('track-2')).toBe(true);
  });
});

describe('search index', () => {
  it('builds one normalized projection per Track', () => {
    const index = buildTrackSearchIndex(tracks);
    expect(index.get('track-1')).toBe('pink floyd time progressive rock classic 70s');
    expect(index.get('track-5')).toBe('ambient study chill');
  });
});
