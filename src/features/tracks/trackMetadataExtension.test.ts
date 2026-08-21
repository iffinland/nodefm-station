import { describe, expect, it } from 'vitest';
import {
  createTrack,
  deserializeTrackFromQdn,
  editTrack,
  serializeTrackForQdn,
} from './services/trackService';

function createTrackInput() {
  return {
    title: 'Time',
    artist: 'Pink Floyd',
    album: 'The Dark Side of the Moon',
    releaseDate: '1973-03-01',
    audio: { service: 'AUDIO', name: 'Station', identifier: 'audio-1' },
    durationMs: 421_000,
    source: 'station-upload' as const,
    ownerAddress: 'owner',
  };
}

describe('extended track metadata persistence contract', () => {
  it('stores and reloads optional Album and Release date without normalization', () => {
    const track = createTrack(createTrackInput());
    const reloaded = deserializeTrackFromQdn(JSON.parse(serializeTrackForQdn(track)));

    expect(reloaded?.album).toBe('The Dark Side of the Moon');
    expect(reloaded?.releaseDate).toBe('1973-03-01');
    expect(serializeTrackForQdn(track)).toContain('"album":"The Dark Side of the Moon"');
    expect(serializeTrackForQdn(track)).toContain('"releaseDate":"1973-03-01"');
  });

  it('keeps legacy tracks without the new fields valid and clean', () => {
    const legacy = deserializeTrackFromQdn({
      schemaVersion: 1,
      trackId: 'track-legacy',
      ownerAddress: 'owner',
      title: 'Legacy',
      artist: 'Old Artist',
      audio: { service: 'AUDIO', name: 'Station', identifier: 'audio-legacy' },
      durationMs: 1000,
      source: 'station-upload',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(legacy).not.toBeNull();
    expect(legacy?.album).toBeUndefined();
    expect(legacy?.releaseDate).toBeUndefined();
  });

  it('rejects malformed optional metadata during deserialization without breaking legacy tracks', () => {
    expect(
      deserializeTrackFromQdn({
        schemaVersion: 1,
        trackId: 'track-invalid',
        ownerAddress: 'owner',
        title: 'Invalid',
        audio: { service: 'AUDIO', name: 'Station', identifier: 'audio-invalid' },
        durationMs: 1000,
        source: 'station-upload',
        album: 42,
      }),
    ).toBeNull();

    expect(
      deserializeTrackFromQdn({
        schemaVersion: 1,
        trackId: 'track-invalid-date',
        ownerAddress: 'owner',
        title: 'Invalid date',
        audio: { service: 'AUDIO', name: 'Station', identifier: 'audio-invalid-date' },
        durationMs: 1000,
        source: 'station-upload',
        releaseDate: '2023-02-30',
      }),
    ).toBeNull();
  });

  it('rejects invalid release dates on create and edit', () => {
    expect(() => createTrack({ ...createTrackInput(), releaseDate: '2023-02-30' })).toThrow(
      /release date/i,
    );

    const track = createTrack(createTrackInput());
    expect(() => editTrack(track, { releaseDate: 'August 1991' })).toThrow(/release date/i);
  });

  it('allows Album and Release date to be cleared while preserving other fields', () => {
    const track = createTrack(createTrackInput());
    const updated = editTrack(track, { album: '', releaseDate: '' });

    expect(updated.album).toBeUndefined();
    expect(updated.releaseDate).toBeUndefined();
    expect(updated.title).toBe('Time');
    expect(updated.audio).toEqual(track.audio);
  });
});
