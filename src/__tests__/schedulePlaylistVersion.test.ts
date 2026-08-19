/* ============================================================
 * NodeFM Station — Schedule PlaylistVersion Stability Tests
 *
 * A scheduled event references an immutable PlaylistVersion.
 * Creating a newer version for the same logical playlist must not
 * silently retarget the existing scheduled event.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import { createPlaylistVersion } from '../features/playlists/services/playlistService';
import { createScheduleEvent } from '../features/scheduling/services/scheduleService';

describe('schedule playlist version immutability', () => {
  it('keeps the originally scheduled version after a newer version is published', () => {
    const firstVersion = createPlaylistVersion({
      playlistId: 'playlist-1',
      createdBy: 'Q-owner',
      tracks: [{ trackId: 'track-a', durationMs: 60_000 }],
    });

    const secondVersion = createPlaylistVersion({
      playlistId: 'playlist-1',
      createdBy: 'Q-owner',
      tracks: [{ trackId: 'track-b', durationMs: 90_000 }],
      lastVersion: firstVersion.ok ? firstVersion.version : undefined,
    });

    if (!firstVersion.ok || !secondVersion.ok) {
      throw new Error('Expected both playlist versions to be valid.');
    }

    const event = createScheduleEvent({
      startUtc: '2026-01-15T18:00:00.000Z',
      endUtc: '2026-01-15T19:00:00.000Z',
      source: {
        type: 'playlist',
        playlistId: 'playlist-1',
        playlistVersionId: firstVersion.version.versionId,
      },
    });

    expect(event.source.type).toBe('playlist');
    if (event.source.type !== 'playlist') return;

    expect(event.source.playlistVersionId).toBe(firstVersion.version.versionId);
    expect(event.source.playlistVersionId).not.toBe(secondVersion.version.versionId);
  });
});
