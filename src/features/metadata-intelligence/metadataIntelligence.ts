/* ============================================================
 * NodeFM Station — Metadata Intelligence Index
 *
 * A role-neutral Artist/Title suggestion layer derived only
 * from already-loaded Station Track metadata.
 *
 * Artist and Title semantics are intentionally distinct from
 * Tags/Genres:
 *   - Artists are deduplicated globally by normalized key.
 *   - Titles are always scoped to an Artist key so identical
 *     Titles under different Artists never collapse together.
 *
 * Nothing here mutates persisted Track objects and nothing here
 * performs QDN work. The index is a derived in-memory projection
 * that can later be consumed by Admin forms, Listener forms,
 * Bulk Import, and playlist entry surfaces without owner
 * assumptions.
 * ============================================================ */

import type { Track } from '../../types/domain';
import { normalizeTaxonomyValue, rankSuggestions, taxonomyKey } from '../taxonomy/taxonomyService';
import { buildTrackFilterOptions } from '../tracks/selectors/trackFiltering';

export type CanonicalArtist = {
  key: string;
  displayValue: string;
};

export type CanonicalTitle = {
  key: string;
  displayValue: string;
};

export type CanonicalAlbum = {
  key: string;
  displayValue: string;
};

export type MetadataIndex = {
  artists: CanonicalArtist[];
  titlesByArtist: ReadonlyMap<string, CanonicalTitle[]>;
  albumsByArtist: ReadonlyMap<string, CanonicalAlbum[]>;
  albums: CanonicalAlbum[];
};

type DisplayStat = {
  displayValue: string;
  count: number;
};

type TitleStat = {
  displayValues: Map<string, DisplayStat>;
};

/** Trim and collapse internal whitespace without changing display casing. */
export function normalizeMetadataValue(value: string): string {
  return normalizeTaxonomyValue(value);
}

/** Case-folded key used for matching and duplicate prevention. */
export function metadataValueKey(value: string): string {
  return taxonomyKey(value);
}

function chooseCanonicalDisplayValue(stats: ReadonlyMap<string, DisplayStat>): string {
  let canonical = '';
  let bestCount = -1;

  for (const stat of stats.values()) {
    if (stat.count > bestCount) {
      bestCount = stat.count;
      canonical = stat.displayValue;
    }
  }

  return canonical;
}

function toCanonicalTitle(key: string, stat: TitleStat): CanonicalTitle {
  return {
    key,
    displayValue: chooseCanonicalDisplayValue(stat.displayValues),
  };
}

/**
 * Build one memoizable metadata index from the current Track collection.
 *
 * Artist canonical display values reuse the existing Track discovery
 * `buildTrackFilterOptions` rules. Titles use the first-display-value
 * with-highest-frequency rule within one Artist; where several display
 * variants have equal frequency, the first encountered value in the
 * source collection wins. No persisted value is bulk rewritten.
 */
export function buildMetadataIndex(tracks: readonly Track[]): MetadataIndex {
  // Reuse the existing Track discovery Artist canonicalization instead of
  // maintaining a second Artist normalization map. This keeps filter options
  // and Artist autocomplete using the same canonical Artist display rules.
  const filterOptions = buildTrackFilterOptions(tracks);
  const titlesByArtist = new Map<string, Map<string, TitleStat>>();
  const albumsByArtist = new Map<string, Map<string, DisplayStat>>();
  const globalAlbumStats = new Map<string, DisplayStat>();

  for (const track of tracks) {
    const artist = normalizeMetadataValue(track.artist ?? '');
    const artistKey = metadataValueKey(artist);

    const album = normalizeMetadataValue(track.album ?? '');
    if (album) {
      const albumKey = metadataValueKey(album);

      const existingGlobal = globalAlbumStats.get(albumKey);
      if (!existingGlobal) {
        globalAlbumStats.set(albumKey, { displayValue: album, count: 1 });
      } else {
        existingGlobal.count += 1;
      }

      if (artistKey) {
        let artistAlbums = albumsByArtist.get(artistKey);
        if (!artistAlbums) {
          artistAlbums = new Map();
          albumsByArtist.set(artistKey, artistAlbums);
        }

        let albumDisplay = artistAlbums.get(albumKey);
        if (!albumDisplay) {
          albumDisplay = { displayValue: album, count: 0 };
          artistAlbums.set(albumKey, albumDisplay);
        }
        albumDisplay.count += 1;
      }
    }

    if (!artist) continue;

    const title = normalizeMetadataValue(track.title);
    if (!title) continue;

    let artistTitles = titlesByArtist.get(artistKey);
    if (!artistTitles) {
      artistTitles = new Map();
      titlesByArtist.set(artistKey, artistTitles);
    }

    const titleKey = metadataValueKey(title);
    let titleStat = artistTitles.get(titleKey);
    if (!titleStat) {
      titleStat = {
        displayValues: new Map(),
      };
      artistTitles.set(titleKey, titleStat);
    }

    let titleDisplay = titleStat.displayValues.get(title);
    if (!titleDisplay) {
      titleDisplay = { displayValue: title, count: 0 };
      titleStat.displayValues.set(title, titleDisplay);
    }
    titleDisplay.count += 1;
  }

  const artists = filterOptions.artists.map((displayValue) => ({
    key: metadataValueKey(displayValue),
    displayValue,
  }));

  const titlesByArtistMap = new Map<string, CanonicalTitle[]>();

  for (const [artistKey, titleStats] of titlesByArtist) {
    const titles = [...titleStats.entries()]
      .map(([titleKey, stat]) => toCanonicalTitle(titleKey, stat))
      .sort((left, right) => left.displayValue.localeCompare(right.displayValue));
    titlesByArtistMap.set(artistKey, titles);
  }

  const albumsByArtistMap = new Map<string, CanonicalAlbum[]>();

  for (const [artistKey, albumStats] of albumsByArtist) {
    const albums = [...albumStats.entries()]
      .map(([albumKey, stat]) => ({
        key: albumKey,
        displayValue: chooseCanonicalDisplayValue(new Map([[stat.displayValue, stat]])),
      }))
      .sort((left, right) => left.displayValue.localeCompare(right.displayValue));
    albumsByArtistMap.set(artistKey, albums);
  }

  const albums = [...globalAlbumStats.entries()]
    .map(([albumKey, stat]) => ({
      key: albumKey,
      displayValue: chooseCanonicalDisplayValue(new Map([[stat.displayValue, stat]])),
    }))
    .sort((left, right) => left.displayValue.localeCompare(right.displayValue));

  return {
    artists,
    titlesByArtist: titlesByArtistMap,
    albumsByArtist: albumsByArtistMap,
    albums,
  };
}

export function getArtistDisplayValues(index: MetadataIndex): string[] {
  return index.artists.map((artist) => artist.displayValue);
}

export function getArtistSuggestions(
  index: MetadataIndex,
  query: string,
  limit = 12,
): CanonicalArtist[] {
  const queryKey = metadataValueKey(query);

  if (!queryKey) {
    return index.artists.slice(0, limit);
  }

  const displayValues = getArtistDisplayValues(index);
  const rankedValues = rankSuggestions(queryKey, displayValues, undefined, limit).map(
    (entry) => entry.value,
  );
  const byDisplayValue = new Map(index.artists.map((artist) => [artist.displayValue, artist]));

  return rankedValues
    .map((value) => byDisplayValue.get(value))
    .filter((artist): artist is CanonicalArtist => Boolean(artist));
}

export function getArtistTitles(index: MetadataIndex, artistValue: string): CanonicalTitle[] {
  const key = metadataValueKey(artistValue);
  if (!key) return [];
  return index.titlesByArtist.get(key) ?? [];
}

export function getTitleDisplayValues(index: MetadataIndex, artistValue: string): string[] {
  return getArtistTitles(index, artistValue).map((title) => title.displayValue);
}

export function getTitleSuggestionsForArtist(
  index: MetadataIndex,
  artistValue: string,
  query: string,
  limit = 12,
): CanonicalTitle[] {
  const titles = getArtistTitles(index, artistValue);
  if (titles.length === 0) return [];

  const queryKey = metadataValueKey(query);
  if (!queryKey) return titles.slice(0, limit);

  const displayValues = titles.map((title) => title.displayValue);
  const rankedValues = rankSuggestions(queryKey, displayValues, undefined, limit).map(
    (entry) => entry.value,
  );
  const byDisplayValue = new Map(titles.map((title) => [title.displayValue, title]));

  return rankedValues
    .map((value) => byDisplayValue.get(value))
    .filter((title): title is CanonicalTitle => Boolean(title));
}

export function getAlbumsForArtist(index: MetadataIndex, artistValue: string): CanonicalAlbum[] {
  const key = metadataValueKey(artistValue);
  if (!key) return index.albums;

  const artistAlbums = index.albumsByArtist.get(key);
  return artistAlbums && artistAlbums.length > 0 ? artistAlbums : index.albums;
}

export function getAlbumDisplayValues(index: MetadataIndex, artistValue?: string): string[] {
  return getAlbumsForArtist(index, artistValue ?? '').map((album) => album.displayValue);
}

export function getAlbumSuggestions(
  index: MetadataIndex,
  artistValue: string,
  query: string,
  limit = 12,
): CanonicalAlbum[] {
  const albums = getAlbumsForArtist(index, artistValue);
  if (albums.length === 0) return [];

  const queryKey = metadataValueKey(query);
  if (!queryKey) return albums.slice(0, limit);

  const displayValues = albums.map((album) => album.displayValue);
  const rankedValues = rankSuggestions(queryKey, displayValues, undefined, limit).map(
    (entry) => entry.value,
  );
  const byDisplayValue = new Map(albums.map((album) => [album.displayValue, album]));

  return rankedValues
    .map((value) => byDisplayValue.get(value))
    .filter((album): album is CanonicalAlbum => Boolean(album));
}

export function getCanonicalArtistDisplayValue(index: MetadataIndex, artistValue: string): string {
  const key = metadataValueKey(artistValue);
  if (!key) return '';
  return index.artists.find((artist) => artist.key === key)?.displayValue ?? '';
}

export function getCanonicalTitleDisplayValue(
  index: MetadataIndex,
  artistValue: string,
  titleValue: string,
): string {
  const titleKey = metadataValueKey(titleValue);
  if (!titleKey) return '';
  const title = getArtistTitles(index, artistValue).find((candidate) => candidate.key === titleKey);
  return title?.displayValue ?? '';
}
