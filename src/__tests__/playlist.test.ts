/* ============================================================
 * NodeFM Station — Playlist Domain Tests
 *
 * Pure domain logic tests for playlist version creation
 * and publication eligibility.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  createPlaylistVersion,
  isPlaylistPublishable,
  createTrackSnapshot,
  createPlaylist,
} from '../features/playlists/services/playlistService';

describe('createPlaylistVersion', () => {
  const validTrack = { trackId: 't1', durationMs: 300000 };
  const invalidTrack = { trackId: 't2', durationMs: 0 };

  it('creates a valid version with correct total', () => {
    const result = createPlaylistVersion({
      playlistId: 'pl1',
      createdBy: 'owner1',
      tracks: [validTrack, { trackId: 't2', durationMs: 200000 }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version.totalDurationMs).toBe(500000);
      expect(result.version.versionNumber).toBe(1);
      expect(result.version.tracks).toHaveLength(2);
    }
  });

  it('rejects invalid durations', () => {
    const result = createPlaylistVersion({
      playlistId: 'pl1',
      createdBy: 'owner1',
      tracks: [validTrack, invalidTrack],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.invalidTrackIds).toContain('t2');
    }
  });

  it('increments version number', () => {
    const v1 = createPlaylistVersion({
      playlistId: 'pl1',
      createdBy: 'owner1',
      tracks: [validTrack],
    });

    expect(v1.ok).toBe(true);
    if (!v1.ok) return;

    const v2 = createPlaylistVersion({
      playlistId: 'pl1',
      createdBy: 'owner1',
      tracks: [validTrack],
      lastVersion: v1.version,
    });

    expect(v2.ok).toBe(true);
    if (v2.ok) {
      expect(v2.version.versionNumber).toBe(2);
      expect(v2.version.versionId).not.toBe(v1.version.versionId);
    }
  });

  it('preserves track order', () => {
    const result = createPlaylistVersion({
      playlistId: 'pl1',
      createdBy: 'owner1',
      tracks: [
        { trackId: 'first', durationMs: 1000 },
        { trackId: 'second', durationMs: 2000 },
        { trackId: 'third', durationMs: 3000 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version.tracks[0].trackId).toBe('first');
      expect(result.version.tracks[1].trackId).toBe('second');
      expect(result.version.tracks[2].trackId).toBe('third');
    }
  });
});

describe('isPlaylistPublishable', () => {
  it('accepts valid tracks', () => {
    const result = isPlaylistPublishable([
      { trackId: 't1', durationMs: 1000 },
      { trackId: 't2', durationMs: 2000 },
    ]);
    expect(result.publishable).toBe(true);
  });

  it('rejects empty playlist', () => {
    const result = isPlaylistPublishable([]);
    expect(result.publishable).toBe(false);
    expect(result.reason).toContain('no tracks');
  });

  it('rejects invalid duration', () => {
    const result = isPlaylistPublishable([
      { trackId: 't1', durationMs: 1000 },
      { trackId: 't2', durationMs: 0 },
    ]);
    expect(result.publishable).toBe(false);
    expect(result.invalidTrackIds).toContain('t2');
  });
});

describe('createTrackSnapshot', () => {
  it('preserves order and captures trackId + durationMs only', () => {
    const snapshot = createTrackSnapshot([
      { trackId: 'a', durationMs: 3000 },
      { trackId: 'b', durationMs: 5000 },
    ]);

    expect(snapshot).toEqual([
      { trackId: 'a', durationMs: 3000 },
      { trackId: 'b', durationMs: 5000 },
    ]);
  });
});

describe('createPlaylist', () => {
  it('generates unique IDs', () => {
    const p1 = createPlaylist({ title: 'Test', ownerAddress: 'addr' });
    const p2 = createPlaylist({ title: 'Test', ownerAddress: 'addr' });
    expect(p1.playlistId).not.toBe(p2.playlistId);
  });

  it('defaults to private visibility', () => {
    const p = createPlaylist({ title: 'Test', ownerAddress: 'addr' });
    expect(p.visibility).toBe('private');
  });

  it('has empty latestVersionId', () => {
    const p = createPlaylist({ title: 'Test', ownerAddress: 'addr' });
    expect(p.latestVersionId).toBe('');
  });
});
