import { describe, expect, it } from 'vitest';
import type { Track } from '../../types/domain';
import {
  buildMetadataIndex,
  getArtistDisplayValues,
  getArtistSuggestions,
  getArtistTitles,
  getCanonicalArtistDisplayValue,
  getTitleDisplayValues,
  getTitleSuggestionsForArtist,
  metadataValueKey,
  normalizeMetadataValue,
} from './metadataIntelligence';

function makeTrack(trackId: string, title: string, artist?: string): Track {
  return {
    schemaVersion: 1,
    trackId,
    ownerAddress: 'owner',
    title,
    artist,
    audio: { service: 'AUDIO', name: 'Station', identifier: `audio-${trackId}` },
    durationMs: 1000,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('metadata normalization', () => {
  it('trims and collapses whitespace without changing display casing', () => {
    expect(normalizeMetadataValue('  Pink   Floyd  ')).toBe('Pink Floyd');
    expect(metadataValueKey('Pink Floyd')).toBe('pink floyd');
    expect(metadataValueKey('pink   floyd')).toBe('pink floyd');
  });
});

describe('artist index', () => {
  it('matches case-insensitively and collapses case/whitespace display variants', () => {
    const tracks = [
      makeTrack('1', 'Master of Puppets', 'Metallica'),
      makeTrack('2', 'One', '  metallica '),
      makeTrack('3', 'Nothing Else Matters', 'METALLICA'),
      makeTrack('4', 'Fuel', 'Metalica'),
    ];

    const index = buildMetadataIndex(tracks);
    const artists = getArtistDisplayValues(index);

    expect(artists).toHaveLength(2);
    expect(artists).toContain('Metallica');
    expect(artists).toContain('Metalica');
    expect(getArtistSuggestions(index, 'met').map((artist) => artist.displayValue)).toContain(
      'Metallica',
    );
  });

  it('preserves the first highest-frequency display variant as canonical without mutation', () => {
    const tracks = [
      makeTrack('1', 'One', 'Metallica'),
      makeTrack('2', 'Fuel', 'metallica'),
      makeTrack('3', 'Battery', 'METALLICA'),
    ];

    const index = buildMetadataIndex(tracks);

    expect(getCanonicalArtistDisplayValue(index, ' metallica ')).toBe('Metallica');
    expect(tracks.map((track) => track.artist)).toEqual(['Metallica', 'metallica', 'METALLICA']);
  });

  it('keeps genuinely unknown artists possible', () => {
    const index = buildMetadataIndex([makeTrack('1', 'One', 'Metallica')]);

    expect(getCanonicalArtistDisplayValue(index, 'Brand New Artist')).toBe('');
    expect(getArtistSuggestions(index, 'Brand New Artist')).toEqual([]);
  });
});

describe('artist-aware title index', () => {
  const tracks = [
    makeTrack('1', 'Time', 'Pink Floyd'),
    makeTrack('2', 'Comfortably Numb', 'Pink Floyd'),
    makeTrack('3', 'Time', 'The Alan Parsons Project'),
    makeTrack('4', 'Eclipse', 'Pink Floyd'),
  ];

  it('keeps identical titles distinct across artists', () => {
    const index = buildMetadataIndex(tracks);

    expect(getTitleDisplayValues(index, 'Pink Floyd')).toContain('Time');
    expect(getTitleDisplayValues(index, 'The Alan Parsons Project')).toContain('Time');
    expect(getArtistTitles(index, 'Pink Floyd')).not.toEqual(
      getArtistTitles(index, 'The Alan Parsons Project'),
    );
  });

  it('suggests titles case-insensitively within the selected artist context', () => {
    const index = buildMetadataIndex(tracks);

    expect(
      getTitleSuggestionsForArtist(index, 'pink floyd', 'Ti').map((title) => title.displayValue),
    ).toEqual(['Time']);
    expect(
      getTitleSuggestionsForArtist(index, 'The Alan Parsons Project', 'Ti').map(
        (title) => title.displayValue,
      ),
    ).toEqual(['Time']);
  });

  it('returns no title suggestions for unknown artists and updates with artist changes', () => {
    const index = buildMetadataIndex(tracks);

    expect(getTitleSuggestionsForArtist(index, 'Unknown', 'Ti')).toEqual([]);

    const pinkFloydTitles = getTitleDisplayValues(index, 'Pink Floyd');
    const parsonsTitles = getTitleDisplayValues(index, 'The Alan Parsons Project');

    expect(pinkFloydTitles).toEqual(['Comfortably Numb', 'Eclipse', 'Time']);
    expect(parsonsTitles).toEqual(['Time']);
  });
});
