/* ============================================================
 * NodeFM Station — Domain Validation Tests
 *
 * Exercises the production domain/service validators directly.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  createTrack,
  deserializeTrackFromQdn,
  editTrack,
  isValidQdnResourceRef,
  type CreateTrackInput,
} from '../features/tracks/services/trackService';
import {
  createPlaylist,
  editPlaylist,
  createPlaylistVersion,
  isPlaylistPublishable,
  createTrackSnapshot,
  deserializePlaylistFromQdn,
  deserializePlaylistVersionFromQdn,
  type CreatePlaylistInput,
} from '../features/playlists/services/playlistService';

function trackInput(overrides: Partial<CreateTrackInput> = {}): CreateTrackInput {
  return {
    title: 'Test Track',
    audio: { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
    durationMs: 1000,
    source: 'qdn-existing',
    ownerAddress: 'Q-owner',
    ...overrides,
  };
}

function playlistInput(overrides: Partial<CreatePlaylistInput> = {}): CreatePlaylistInput {
  return {
    title: 'My Playlist',
    ownerAddress: 'Q-owner',
    ...overrides,
  };
}

describe('Track domain invariants', () => {
  it('rejects blank or whitespace titles', () => {
    expect(() => createTrack(trackInput({ title: '' }))).toThrow(/title/i);
    expect(() => createTrack(trackInput({ title: '   ' }))).toThrow(/title/i);
  });

  it('trims accepted titles', () => {
    const track = createTrack(trackInput({ title: '  Hello  ' }));
    expect(track.title).toBe('Hello');
  });

  it('rejects invalid durations', () => {
    expect(() => createTrack(trackInput({ durationMs: 0 }))).toThrow(/duration/i);
    expect(() => createTrack(trackInput({ durationMs: -1 }))).toThrow(/duration/i);
    expect(() => createTrack(trackInput({ durationMs: Number.NaN }))).toThrow(/duration/i);
    expect(() => createTrack(trackInput({ durationMs: 1000.5 }))).toThrow(/duration/i);
  });

  it('rejects malformed audio QDN references', () => {
    expect(isValidQdnResourceRef(null)).toBe(false);
    expect(isValidQdnResourceRef({ service: 'AUDIO', name: '' })).toBe(false);
    expect(isValidQdnResourceRef({ service: '', name: 'Owner' })).toBe(false);
    expect(() => createTrack(trackInput({ audio: { service: 'AUDIO', name: '' } }))).toThrow(
      /audio/i,
    );
  });

  it('rejects malformed records during deserialization', () => {
    expect(
      deserializeTrackFromQdn({
        trackId: 't1',
        ownerAddress: 'Q-owner',
        title: '',
        audio: { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
        durationMs: 1000,
        source: 'qdn-existing',
      }),
    ).toBeNull();

    expect(
      deserializeTrackFromQdn({
        trackId: 't1',
        ownerAddress: 'Q-owner',
        title: 'Test',
        audio: null,
        durationMs: 1000,
        source: 'qdn-existing',
      }),
    ).toBeNull();
  });

  it('rejects invalid edits', () => {
    const track = createTrack(trackInput());
    expect(() => editTrack(track, { title: '  ' })).toThrow(/title/i);
    expect(() => editTrack(track, { cover: { service: '', name: 'x' } })).toThrow(/cover/i);
  });

  it('removes a cover explicitly without changing audio or taxonomy', () => {
    const track = createTrack(
      trackInput({
        cover: { service: 'IMAGE', name: 'Owner', identifier: 'cover-1' },
        genres: ['Rock'],
        tags: ['chill'],
      }),
    );

    const updated = editTrack(track, { removeCover: true });

    expect(updated.cover).toBeUndefined();
    expect(updated.audio).toEqual(track.audio);
    expect(updated.genres).toEqual(['Rock']);
    expect(updated.tags).toEqual(['chill']);
  });

  it('rejects simultaneous cover replacement and removal', () => {
    const track = createTrack(trackInput());

    expect(() =>
      editTrack(track, {
        cover: { service: 'IMAGE', name: 'Owner', identifier: 'cover-2' },
        removeCover: true,
      }),
    ).toThrow(/cannot be both/i);
  });
});

describe('Playlist domain invariants', () => {
  it('rejects blank or whitespace titles and trims accepted titles', () => {
    expect(() => createPlaylist(playlistInput({ title: '' }))).toThrow(/title/i);
    expect(() => createPlaylist(playlistInput({ title: '   ' }))).toThrow(/title/i);
    expect(createPlaylist(playlistInput({ title: '  Hello  ' })).title).toBe('Hello');
  });

  it('rejects invalid visibility', () => {
    expect(() =>
      createPlaylist(playlistInput({ visibility: 'public' as 'public' | 'private' })),
    ).not.toThrow();
    expect(() =>
      createPlaylist(playlistInput({ visibility: 'secret' as 'public' | 'private' })),
    ).toThrow(/visibility/i);
  });

  it('rejects invalid visibility on edit', () => {
    const playlist = createPlaylist(playlistInput());
    expect(() => editPlaylist(playlist, { visibility: 'secret' as 'public' | 'private' })).toThrow(
      /visibility/i,
    );
  });
});

describe('Playlist version invariants', () => {
  it('rejects empty versions', () => {
    const result = createPlaylistVersion({
      playlistId: 'p1',
      createdBy: 'Q-owner',
      tracks: [],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('at least one track');
    }
  });

  it('rejects invalid track snapshots', () => {
    const result = createPlaylistVersion({
      playlistId: 'p1',
      createdBy: 'Q-owner',
      tracks: [
        { trackId: '', durationMs: 1000 },
        { trackId: 't2', durationMs: 0 },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidTrackIds).toHaveLength(2);
    }
  });

  it('derives total duration from valid snapshots', () => {
    const result = createPlaylistVersion({
      playlistId: 'p1',
      createdBy: 'Q-owner',
      tracks: [
        { trackId: 't1', durationMs: 1000 },
        { trackId: 't2', durationMs: 2000 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version.totalDurationMs).toBe(3000);
      expect(result.version.tracks).toHaveLength(2);
    }
  });

  it('keeps published snapshot separate from the source array', () => {
    const source = [
      { trackId: 't1', durationMs: 1000 },
      { trackId: 't2', durationMs: 2000 },
    ];
    const result = createPlaylistVersion({
      playlistId: 'p1',
      createdBy: 'Q-owner',
      tracks: source,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.version.tracks).not.toBe(source);
    result.version.tracks[0].trackId = 'changed';
    expect(source[0].trackId).toBe('t1');
  });

  it('keeps publication eligibility aligned with the same validation', () => {
    expect(
      isPlaylistPublishable([
        { trackId: 't1', durationMs: 1000 },
        { trackId: 't2', durationMs: 2000 },
      ]).publishable,
    ).toBe(true);

    expect(isPlaylistPublishable([]).publishable).toBe(false);
    expect(isPlaylistPublishable([{ trackId: 't1', durationMs: 0 }]).publishable).toBe(false);
  });

  it('rejects empty trackId in snapshots', () => {
    expect(() => createTrackSnapshot([{ trackId: '', durationMs: 1000 }])).toThrow(/trackId/i);
  });

  it('rejects malformed playlist/version records during deserialization', () => {
    expect(deserializePlaylistFromQdn({ playlistId: 'p1', ownerAddress: 'Q-owner' })).toBeNull();
    expect(
      deserializePlaylistVersionFromQdn({
        playlistId: 'p1',
        versionId: 'v1',
        versionNumber: 1,
        createdBy: 'Q-owner',
        createdAt: '2026-01-01T00:00:00.000Z',
        tracks: [{ trackId: '', durationMs: 1000 }],
        totalDurationMs: 1000,
      }),
    ).toBeNull();
  });
});
