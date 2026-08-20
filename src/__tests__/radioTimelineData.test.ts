/* ============================================================
 * NodeFM Station — Radio Timeline Data Store Tests
 *
 * Verifies immutable playlist versions and track metadata are
 * reconstructed from QDN records and invalid data is explicit.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  fetchQdnResourceData: vi.fn(),
  searchQdnResources: vi.fn(),
  publishResource: vi.fn(),
  deleteQdnResource: vi.fn(),
}));

import { fetchQdnResourceData, searchQdnResources } from '../qortium/qdn';
import { createPlaylistVersion } from '../features/playlists/services/playlistService';
import { getPlaylistVersionQdnIdentifier } from '../features/playlists/services/playlistService';
import { getTrackQdnIdentifier } from '../features/tracks/services/trackService';
import {
  getRadioTimelineData,
  getRadioTimelineDataError,
  getRadioTimelineDataLoaded,
  loadRadioTimelineData,
  resetRadioTimelineData,
} from '../features/radio/timeline/radioTimelineDataStore';
import type { Station } from '../types/domain';

const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedSearch = vi.mocked(searchQdnResources);

const station: Station = {
  schemaVersion: 1,
  stationId: 'station-1',
  name: 'NodeFM',
  publisherName: 'NodeFM',
  ownerAddress: 'Q-owner',
  ownerName: 'Owner',
  timezone: 'Europe/Helsinki',
  defaultRotationPlaylistId: 'playlist-1',
  defaultRotationPlaylistVersionId: 'version-1',
  stationEpochUtc: '2026-01-01T00:00:00.000Z',
  messagingEnabled: false,
  tipsEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeVersion() {
  const result = createPlaylistVersion({
    playlistId: 'playlist-1',
    createdBy: 'Q-owner',
    tracks: [
      { trackId: 'track-1', durationMs: 60_000 },
      { trackId: 'track-2', durationMs: 90_000 },
    ],
  });

  if (!result.ok) throw new Error(result.error);
  return { ...result.version, versionId: 'version-1' };
}

function trackPayload(trackId: string, durationMs: number) {
  return {
    trackId,
    ownerAddress: 'Q-owner',
    title: `Track ${trackId}`,
    audio: { service: 'AUDIO', name: 'Owner', identifier: `${trackId}-audio` },
    durationMs,
    source: 'qdn-existing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('radio timeline data store', () => {
  beforeEach(() => {
    resetRadioTimelineData();
    mockedFetch.mockReset();
    mockedSearch.mockReset();
    mockedSearch.mockResolvedValue([]);
  });

  it('loads the default immutable version and referenced track metadata', async () => {
    const version = makeVersion();
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === getPlaylistVersionQdnIdentifier('version-1')) {
        return version;
      }

      if (ref.identifier === getTrackQdnIdentifier('track-1')) {
        return trackPayload('track-1', 60_000);
      }

      if (ref.identifier === getTrackQdnIdentifier('track-2')) {
        return trackPayload('track-2', 90_000);
      }

      throw new Error(`Unexpected fetch: ${ref.identifier}`);
    });

    await loadRadioTimelineData(station, 'Owner');

    expect(getRadioTimelineDataLoaded()).toBe(true);
    expect(getRadioTimelineData()).toMatchObject({
      station,
      playlistVersions: {
        'version-1': version,
      },
      scheduleEvents: [],
    });
    expect(Object.keys(getRadioTimelineData()?.tracks ?? {})).toEqual(['track-1', 'track-2']);
  });

  it('reports unavailable or invalid default versions as data errors', async () => {
    const invalidVersion = {
      ...makeVersion(),
      tracks: [{ trackId: 'track-1', durationMs: 0 }],
      totalDurationMs: 0,
    };
    mockedFetch.mockResolvedValue(invalidVersion);

    await loadRadioTimelineData(station, 'Owner');

    expect(getRadioTimelineDataLoaded()).toBe(false);
    expect(getRadioTimelineDataError()).toMatch(/invalid or unavailable playlist version/i);
  });

  it('reports missing track metadata instead of silently substituting content', async () => {
    const version = makeVersion();
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === getPlaylistVersionQdnIdentifier('version-1')) {
        return version;
      }

      throw new Error('Track resource is unavailable.');
    });

    await loadRadioTimelineData(station, 'Owner');

    expect(getRadioTimelineDataLoaded()).toBe(false);
    expect(getRadioTimelineDataError()).toMatch(/track resource is unavailable/i);
  });
});
