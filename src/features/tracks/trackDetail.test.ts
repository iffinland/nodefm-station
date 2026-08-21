import { describe, expect, it } from 'vitest';
import type { Track } from '../../types/domain';
import { getTrackDetailPresentation, getTrackDetailSourceLabel } from './trackDetailPresentation';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    schemaVersion: 1,
    trackId: 'track-1',
    ownerAddress: 'owner',
    title: 'Time',
    artist: 'Pink Floyd',
    description: 'A classic track',
    audio: { service: 'AUDIO', name: 'Station', identifier: 'audio-1' },
    cover: { service: 'IMAGE', name: 'Station', identifier: 'cover-1' },
    durationMs: 421_000,
    genres: ['Progressive Rock', 'Classic Rock'],
    tags: ['70s', 'classic'],
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('track detail presentation', () => {
  it('renders existing metadata readably without exposing raw QDN internals', () => {
    const detail = getTrackDetailPresentation(makeTrack());

    expect(detail).toEqual({
      title: 'Time',
      artist: 'Pink Floyd',
      description: 'A classic track',
      genres: ['Progressive Rock', 'Classic Rock'],
      tags: ['#70s', '#classic'],
      duration: '7:01',
      sourceLabel: 'Station upload',
      audioPublisher: 'Station',
    });
  });

  it('handles missing Genre, Tags, description, and cover cleanly', () => {
    const detail = getTrackDetailPresentation(
      makeTrack({
        description: undefined,
        cover: undefined,
        genres: undefined,
        tags: undefined,
      }),
    );

    expect(detail.description).toBe('');
    expect(detail.genres).toEqual([]);
    expect(detail.tags).toEqual([]);
  });

  it('labels station uploads and QDN sources understandably', () => {
    expect(getTrackDetailSourceLabel('station-upload')).toBe('Station upload');
    expect(getTrackDetailSourceLabel('qdn-existing')).toBe('Existing QDN audio');
  });
});

describe('track detail modal contract', () => {
  const modalSourceModule = import.meta.glob('./components/TrackDetailModal.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const modalSource = modalSourceModule['./components/TrackDetailModal.tsx'] as string;

  it('uses the shared modal primitive and explicit close control', () => {
    expect(modalSource).toContain('<Modal');
    expect(modalSource).toContain('title="Track Details"');
    expect(modalSource).toContain('onClose={onClose}');
  });

  it('does not call the global AudioEngine when opened or closed', () => {
    expect(modalSource).not.toContain('useAudioEngine');
    expect(modalSource).not.toContain('getAudioEngine');
    expect(modalSource).not.toContain('engine.play');
    expect(modalSource).not.toContain('engine.pause');
    expect(modalSource).not.toContain('engine.load');
    expect(modalSource).not.toContain('returnToLive');
  });
});
