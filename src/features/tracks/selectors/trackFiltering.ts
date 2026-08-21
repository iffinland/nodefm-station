/* ============================================================
 * NodeFM Station — Reusable Track Discovery Pipeline
 *
 * Pure filtering and sorting for management/selection surfaces.
 *
 * The canonical Track metadata model remains authoritative. This
 * module never mutates raw Track objects and performs no QDN work;
 * it operates only on already-loaded Track metadata.
 * ============================================================ */

import type { Track } from '../../../types/domain';
import {
  mergeTaxonomySuggestions,
  normalizeTaxonomyValue,
  splitTaxonomyValues,
  taxonomyKey,
} from '../../taxonomy';

export type TrackFilterCriteria = {
  search: string;
  genre: string;
  tag: string;
  artist: string;
};

export type TrackSort = 'artist' | 'title' | 'genre' | 'newest';

export type TrackFilterOptions = {
  genres: string[];
  tags: string[];
  artists: string[];
};

export const EMPTY_TRACK_FILTERS: TrackFilterCriteria = {
  search: '',
  genre: '',
  tag: '',
  artist: '',
};

export const DEFAULT_TRACK_SORT: TrackSort = 'title';

const trackCollator = new Intl.Collator('en', {
  sensitivity: 'base',
  numeric: true,
});

export function normalizeTrackSearchText(value: string): string {
  return normalizeTaxonomyValue(value).toLowerCase();
}

function normalizeTrackTaxonomyValues(values: readonly string[] | undefined): string[] {
  return splitTaxonomyValues((values ?? []).join(','));
}

function getTrackArtist(track: Track): string {
  return normalizeTaxonomyValue(track.artist ?? '');
}

function getTrackArtistKey(track: Track): string {
  return getTrackArtist(track).toLowerCase();
}

function getTrackPrimaryGenre(track: Track): string {
  return normalizeTrackTaxonomyValues(track.genres)[0] ?? '';
}

function getTrackSearchableText(track: Track): string {
  return normalizeTrackSearchText(
    [
      track.artist ?? '',
      track.title,
      ...normalizeTrackTaxonomyValues(track.genres),
      ...normalizeTrackTaxonomyValues(track.tags),
    ].join(' '),
  );
}

/**
 * Build one normalized search projection per Track so filtering can
 * avoid repeatedly rebuilding text for the same collection.
 */
export function buildTrackSearchIndex(tracks: readonly Track[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const track of tracks) {
    index.set(track.trackId, getTrackSearchableText(track));
  }

  return index;
}

/**
 * Derive normalized, deduplicated selection options directly from the
 * current Track collection. Casing/whitespace are normalized for
 * comparison, but stored Track values are never rewritten.
 */
export function buildTrackFilterOptions(tracks: readonly Track[]): TrackFilterOptions {
  const genres = mergeTaxonomySuggestions(
    [],
    tracks.flatMap((track) => normalizeTrackTaxonomyValues(track.genres)),
  );
  const tags = mergeTaxonomySuggestions(
    [],
    tracks.flatMap((track) => normalizeTrackTaxonomyValues(track.tags)),
  );

  const artistMap = new Map<string, string>();

  for (const track of tracks) {
    const artist = getTrackArtist(track);
    if (!artist) continue;

    const key = artist.toLowerCase();
    if (!artistMap.has(key)) {
      artistMap.set(key, artist);
    }
  }

  const artists = [...artistMap.values()].sort((left, right) => trackCollator.compare(left, right));

  return { genres, tags, artists };
}

function matchesSearch(track: Track, query: string, searchIndex: Map<string, string>): boolean {
  if (!query) return true;
  const haystack = searchIndex.get(track.trackId) ?? getTrackSearchableText(track);
  return haystack.includes(query);
}

function matchesGenre(track: Track, selectedGenreKey: string): boolean {
  if (!selectedGenreKey) return true;
  return normalizeTrackTaxonomyValues(track.genres).some(
    (genre) => taxonomyKey(genre) === selectedGenreKey,
  );
}

function matchesTag(track: Track, selectedTagKey: string): boolean {
  if (!selectedTagKey) return true;
  return normalizeTrackTaxonomyValues(track.tags).some(
    (tag) => taxonomyKey(tag) === selectedTagKey,
  );
}

function matchesArtist(track: Track, selectedArtistKey: string): boolean {
  if (!selectedArtistKey) return true;
  return getTrackArtistKey(track) === selectedArtistKey;
}

function compareTitle(left: Track, right: Track): number {
  const result = trackCollator.compare(
    normalizeTaxonomyValue(left.title).toLowerCase(),
    normalizeTaxonomyValue(right.title).toLowerCase(),
  );

  if (result !== 0) return result;
  return trackCollator.compare(left.trackId, right.trackId);
}

function compareArtist(left: Track, right: Track): number {
  const leftArtist = getTrackArtistKey(left);
  const rightArtist = getTrackArtistKey(right);

  if (!leftArtist && rightArtist) return 1;
  if (leftArtist && !rightArtist) return -1;
  if (leftArtist && rightArtist) {
    const artistResult = trackCollator.compare(leftArtist, rightArtist);
    if (artistResult !== 0) return artistResult;
  }

  return compareTitle(left, right);
}

function compareGenre(left: Track, right: Track): number {
  const leftGenre = getTrackPrimaryGenre(left).toLowerCase();
  const rightGenre = getTrackPrimaryGenre(right).toLowerCase();

  if (!leftGenre && rightGenre) return 1;
  if (leftGenre && !rightGenre) return -1;
  if (leftGenre && rightGenre) {
    const genreResult = trackCollator.compare(leftGenre, rightGenre);
    if (genreResult !== 0) return genreResult;
  }

  return compareTitle(left, right);
}

function compareNewest(left: Track, right: Track): number {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  const leftValue = Number.isFinite(leftTime) ? leftTime : 0;
  const rightValue = Number.isFinite(rightTime) ? rightTime : 0;

  if (rightValue !== leftValue) return rightValue - leftValue;
  return compareTitle(left, right);
}

function getTrackComparator(sort: TrackSort): (left: Track, right: Track) => number {
  switch (sort) {
    case 'artist':
      return compareArtist;
    case 'genre':
      return compareGenre;
    case 'newest':
      return compareNewest;
    case 'title':
      return compareTitle;
  }
}

/**
 * Run the complete discovery pipeline without modifying `tracks`.
 *
 * raw Tracks -> normalized search projection -> search -> Genre ->
 * Tag -> Artist -> sort -> visible Tracks
 */
export function filterAndSortTracks(
  tracks: readonly Track[],
  criteria: TrackFilterCriteria,
  sort: TrackSort,
  searchIndex = buildTrackSearchIndex(tracks),
): Track[] {
  const query = normalizeTrackSearchText(criteria.search);
  const genreKey = taxonomyKey(criteria.genre);
  const tagKey = taxonomyKey(criteria.tag);
  const artistKey = normalizeTrackSearchText(criteria.artist);

  return tracks
    .filter(
      (track) =>
        matchesSearch(track, query, searchIndex) &&
        matchesGenre(track, genreKey) &&
        matchesTag(track, tagKey) &&
        matchesArtist(track, artistKey),
    )
    .sort(getTrackComparator(sort));
}

export function hasActiveTrackFilters(criteria: TrackFilterCriteria): boolean {
  return Boolean(
    criteria.search.trim() ||
    criteria.genre.trim() ||
    criteria.tag.trim() ||
    criteria.artist.trim(),
  );
}
