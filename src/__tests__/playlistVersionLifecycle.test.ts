/* ============================================================
 * NodeFM Station — PlaylistVersion Delete/Restore Lifecycle Tests
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  deleteQdnResource: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  publishResource: vi.fn(),
  searchQdnResources: vi.fn(),
}));

vi.mock('../features/playlists/services/playlistVersionReferenceService', () => {
  class PlaylistVersionReferencedError extends Error {
    readonly references: unknown[];

    constructor(references: unknown[]) {
      super(`referenced by ${references.length} resource(s)`);
      this.name = 'PlaylistVersionReferencedError';
      this.references = references;
    }
  }

  return {
    PlaylistVersionReferencedError,
    collectPlaylistVersionReferences: vi.fn(),
  };
});

import { deleteQdnResource, publishResource } from '../qortium/qdn';
import { collectPlaylistVersionReferences } from '../features/playlists/services/playlistVersionReferenceService';
import {
  addPlaylist,
  deletePlaylistVersion,
  getPlaylistById,
  getPlaylistVersions,
  publishPlaylistVersion,
  resetPlaylistStore,
  restorePlaylistVersionAsLatest,
} from '../features/playlists/services/playlistStore';

const mockedDelete = vi.mocked(deleteQdnResource);
const mockedPublish = vi.mocked(publishResource);
const mockedCollect = vi.mocked(collectPlaylistVersionReferences);

function validTrack(durationMs = 60_000) {
  return { trackId: 'track-1', durationMs };
}

async function createPlaylistWithVersion(title = 'Playlist') {
  const playlist = await addPlaylist({ title, ownerAddress: 'Q-owner' }, 'NodeFM');
  const result = await publishPlaylistVersion(
    {
      playlistId: playlist.playlistId,
      createdBy: 'Q-owner',
      tracks: [validTrack()],
    },
    'NodeFM',
  );

  if (!result.ok) {
    throw new Error('Expected playlist version publication to succeed.');
  }

  return { playlist, version: result.version };
}

describe('PlaylistVersion lifecycle', () => {
  beforeEach(() => {
    resetPlaylistStore();
    mockedDelete.mockReset();
    mockedPublish.mockReset();
    mockedCollect.mockReset();
    mockedPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_QDN_RESOURCE',
      resource: { identifier: null, name: 'NodeFM', service: 'JSON' },
    } as never);
    mockedCollect.mockResolvedValue([]);
  });

  it('deletes an unreferenced old version without deleting the logical playlist', async () => {
    const { playlist, version } = await createPlaylistWithVersion();
    await publishPlaylistVersion(
      {
        playlistId: playlist.playlistId,
        createdBy: 'Q-owner',
        tracks: [validTrack(90_000)],
        lastVersion: version,
      },
      'NodeFM',
    );
    mockedDelete.mockResolvedValue({ accepted: true });

    await deletePlaylistVersion(version.versionId, 'NodeFM', 'Q-owner');

    expect(mockedCollect).toHaveBeenCalledWith(version.versionId, 'NodeFM');
    expect(mockedDelete).toHaveBeenCalledWith({
      service: 'JSON',
      name: 'NodeFM',
      identifier: `nodefm-playlist-version-${version.versionId}`,
    });
    expect(getPlaylistVersions(playlist.playlistId)).toHaveLength(1);
    expect(getPlaylistVersions(playlist.playlistId)[0].versionId).not.toBe(version.versionId);
    expect(getPlaylistById(playlist.playlistId)).toBeDefined();
  });

  it('blocks the current latest version', async () => {
    const { playlist, version } = await createPlaylistWithVersion();

    await expect(deletePlaylistVersion(version.versionId, 'NodeFM', 'Q-owner')).rejects.toThrow(
      /latest PlaylistVersion/i,
    );
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(getPlaylistVersions(playlist.playlistId)).toHaveLength(1);
  });

  it('rejects a non-owner before consulting or deleting QDN', async () => {
    const { version } = await createPlaylistWithVersion();

    await expect(deletePlaylistVersion(version.versionId, 'NodeFM', 'Q-other')).rejects.toThrow(
      /station owner/i,
    );
    expect(mockedCollect).not.toHaveBeenCalled();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('blocks a version referenced by a schedule resource', async () => {
    const { version } = await createPlaylistWithVersion();
    mockedCollect.mockResolvedValue([
      { kind: 'schedule-event', id: 'ev1', label: 'Scheduled Show' },
    ]);

    await expect(
      deletePlaylistVersion(version.versionId, 'NodeFM', 'Q-owner'),
    ).rejects.toMatchObject({
      name: 'PlaylistVersionReferencedError',
      references: [{ kind: 'schedule-event', id: 'ev1' }],
    });
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('leaves local state intact when QDN delete is not accepted', async () => {
    const { playlist, version } = await createPlaylistWithVersion();
    // Make this version non-latest by publishing a newer one.
    await publishPlaylistVersion(
      {
        playlistId: playlist.playlistId,
        createdBy: 'Q-owner',
        tracks: [validTrack(90_000)],
        lastVersion: version,
      },
      'NodeFM',
    );
    mockedDelete.mockResolvedValue({ accepted: false });

    await expect(deletePlaylistVersion(version.versionId, 'NodeFM', 'Q-owner')).rejects.toThrow(
      /not accepted/i,
    );
    expect(getPlaylistVersions(playlist.playlistId)).toHaveLength(2);
  });

  it('restores an existing immutable version as latest without mutating it', async () => {
    const { playlist, version: v1 } = await createPlaylistWithVersion();
    const result2 = await publishPlaylistVersion(
      {
        playlistId: playlist.playlistId,
        createdBy: 'Q-owner',
        tracks: [validTrack(90_000)],
        lastVersion: v1,
      },
      'NodeFM',
    );

    if (!result2.ok) {
      throw new Error('Expected second version publication to succeed.');
    }

    const restored = await restorePlaylistVersionAsLatest(
      playlist.playlistId,
      v1.versionId,
      'NodeFM',
      'Q-owner',
    );

    expect(restored.latestVersionId).toBe(v1.versionId);
    const versions = getPlaylistVersions(playlist.playlistId);
    const restoredVersion = versions.find((version) => version.versionId === v1.versionId);
    expect(restoredVersion).toBeDefined();
    expect(restoredVersion?.versionNumber).toBe(v1.versionNumber);
    expect(restoredVersion?.totalDurationMs).toBe(v1.totalDurationMs);
  });
});
