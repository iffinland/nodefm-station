/* ============================================================
 * NodeFM Station — Track Removal Persistence Tests
 *
 * Verifies that removing a track tombstones only the track metadata
 * QDN resource, not the separate AUDIO/COVER resources, and that a
 * reload does not resurrect the removed metadata.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  searchQdnResources: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  publishResource: vi.fn(),
  deleteQdnResource: vi.fn(),
}));

import { searchQdnResources, fetchQdnResourceData, deleteQdnResource } from '../qortium/qdn';
import {
  getLibraryTracks,
  loadLibrary,
  removeTrackFromLibrary,
  resetLibrary,
} from '../features/library/services/libraryService';

const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedDelete = vi.mocked(deleteQdnResource);

const track = {
  trackId: 't1',
  ownerAddress: 'Q-owner',
  title: 'Test Track',
  audio: { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
  cover: { service: 'IMAGE', name: 'Owner', identifier: 'cover-1' },
  durationMs: 1000,
  source: 'station-upload',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('track removal persistence', () => {
  beforeEach(() => {
    resetLibrary();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedDelete.mockReset();
  });

  async function loadOneTrack() {
    mockedSearch.mockResolvedValue([
      { service: 'JSON', name: 'Owner', identifier: 'nodefm-track-t1' },
    ]);
    mockedFetch.mockResolvedValue(track);

    await loadLibrary('Owner', 'Q-owner');
  }

  it('tombstones the track metadata resource and removes it locally', async () => {
    await loadOneTrack();
    mockedDelete.mockResolvedValue({ accepted: true });

    await removeTrackFromLibrary('t1', 'Owner');

    expect(mockedDelete).toHaveBeenCalledWith({
      service: 'JSON',
      name: 'Owner',
      identifier: 'nodefm-track-t1',
    });
    expect(getLibraryTracks()).toEqual([]);
  });

  it('does not delete unrelated AUDIO or COVER resources', async () => {
    await loadOneTrack();
    mockedDelete.mockResolvedValue({ accepted: true });

    await removeTrackFromLibrary('t1', 'Owner');

    expect(mockedDelete).toHaveBeenCalledTimes(1);
    expect(mockedDelete).toHaveBeenCalledWith({
      service: 'JSON',
      name: 'Owner',
      identifier: 'nodefm-track-t1',
    });
    expect(mockedDelete).not.toHaveBeenCalledWith(expect.objectContaining({ service: 'AUDIO' }));
    expect(mockedDelete).not.toHaveBeenCalledWith(expect.objectContaining({ service: 'IMAGE' }));
  });

  it('does not resurrect removed metadata on reload', async () => {
    await loadOneTrack();
    mockedDelete.mockResolvedValue({ accepted: true });
    await removeTrackFromLibrary('t1', 'Owner');

    // Simulate a stale discovery result that still lists the tombstoned
    // resource; its fetch now fails, so it must be ignored.
    mockedSearch.mockResolvedValue([
      { service: 'JSON', name: 'Owner', identifier: 'nodefm-track-t1' },
    ]);
    mockedFetch.mockRejectedValue(new Error('Resource does not exist.'));

    resetLibrary();
    await loadLibrary('Owner', 'Q-owner');

    expect(getLibraryTracks()).toEqual([]);
  });
});
