/* ============================================================
 * NodeFM Station — Station Config Tests
 *
 * Covers station domain validation and the QDN-backed singleton
 * station store using mocked QDN transport.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  fetchQdnResourceData: vi.fn(),
  publishResource: vi.fn(),
  searchQdnResources: vi.fn(),
}));

import { fetchQdnResourceData, publishResource, searchQdnResources } from '../qortium/qdn';
import {
  createStation,
  deserializeStationFromQdn,
  editStation,
  getStationQdnIdentifier,
} from '../features/station/services/stationService';
import {
  getStation,
  getStationError,
  getStationLoaded,
  loadStationConfig,
  resetStationStore,
  saveStationConfig,
} from '../features/station/services/stationStore';

const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedSearch = vi.mocked(searchQdnResources);
const mockedPublish = vi.mocked(publishResource);

function stationPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    stationId: 'station-1',
    name: 'NodeFM',
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
    ...overrides,
  };
}

describe('station domain validation', () => {
  it('creates a valid station and trims display fields', () => {
    const station = createStation({
      name: '  NodeFM  ',
      ownerAddress: 'Q-owner',
      ownerName: 'Owner',
      timezone: ' Europe/Helsinki ',
      defaultRotationPlaylistId: ' playlist-1 ',
      defaultRotationPlaylistVersionId: ' version-1 ',
      stationEpochUtc: '2026-01-01T00:00:00.000Z',
      messagingEnabled: false,
      tipsEnabled: true,
    });

    expect(station.name).toBe('NodeFM');
    expect(station.timezone).toBe('Europe/Helsinki');
    expect(station.defaultRotationPlaylistId).toBe('playlist-1');
    expect(station.tipsEnabled).toBe(true);
  });

  it('rejects invalid required fields', () => {
    expect(() =>
      createStation({
        name: '',
        ownerAddress: 'Q-owner',
        ownerName: 'Owner',
        timezone: 'Europe/Helsinki',
        defaultRotationPlaylistId: 'playlist-1',
        defaultRotationPlaylistVersionId: 'version-1',
        stationEpochUtc: '2026-01-01T00:00:00.000Z',
        messagingEnabled: false,
        tipsEnabled: false,
      }),
    ).toThrow(/name/i);

    expect(() =>
      createStation({
        name: 'NodeFM',
        ownerAddress: 'Q-owner',
        ownerName: 'Owner',
        timezone: 'Europe/Helsinki',
        defaultRotationPlaylistId: 'playlist-1',
        defaultRotationPlaylistVersionId: 'version-1',
        stationEpochUtc: 'not-a-date',
        messagingEnabled: false,
        tipsEnabled: false,
      }),
    ).toThrow(/epoch/i);
  });

  it('rejects malformed station records during deserialization', () => {
    expect(deserializeStationFromQdn(null)).toBeNull();
    expect(
      deserializeStationFromQdn(stationPayload({ defaultRotationPlaylistVersionId: '' })),
    ).toBeNull();
    expect(deserializeStationFromQdn(stationPayload({ stationEpochUtc: 'not-a-date' }))).toBeNull();
    expect(deserializeStationFromQdn(stationPayload())).toMatchObject({ stationId: 'station-1' });
  });

  it('rejects invalid edits', () => {
    const station = createStation({
      name: 'NodeFM',
      ownerAddress: 'Q-owner',
      ownerName: 'Owner',
      timezone: 'Europe/Helsinki',
      defaultRotationPlaylistId: 'playlist-1',
      defaultRotationPlaylistVersionId: 'version-1',
      stationEpochUtc: '2026-01-01T00:00:00.000Z',
      messagingEnabled: false,
      tipsEnabled: false,
    });

    expect(() => editStation(station, { name: '' })).toThrow(/name/i);
    expect(() => editStation(station, { stationEpochUtc: 'bad' })).toThrow(/epoch/i);
  });
});

describe('station QDN store', () => {
  beforeEach(() => {
    resetStationStore();
    mockedFetch.mockReset();
    mockedSearch.mockReset();
    mockedPublish.mockReset();
  });

  it('loads the station directly under the preferred publisher name', async () => {
    mockedFetch.mockResolvedValue(stationPayload());

    await loadStationConfig('Owner');

    expect(getStationLoaded()).toBe(true);
    expect(getStation()).toMatchObject({ stationId: 'station-1', ownerAddress: 'Q-owner' });
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(mockedFetch).toHaveBeenCalledWith({
      service: 'JSON',
      name: 'Owner',
      identifier: getStationQdnIdentifier(),
    });
  });

  it('falls back to global discovery for a public listener', async () => {
    mockedFetch
      .mockRejectedValueOnce(new Error('No account-selected resource.'))
      .mockResolvedValueOnce(stationPayload());
    mockedSearch.mockResolvedValue([
      {
        name: 'Owner',
        service: 'JSON',
        identifier: getStationQdnIdentifier(),
      },
    ]);

    await loadStationConfig('OtherListener');

    expect(getStation()).toMatchObject({ stationId: 'station-1' });
    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        query: getStationQdnIdentifier(),
        prefix: true,
      }),
    );
  });

  it('treats no discovery matches as no station program', async () => {
    mockedFetch.mockRejectedValue(new Error('not found'));
    mockedSearch.mockResolvedValue([]);

    await loadStationConfig(null);

    expect(getStationLoaded()).toBe(true);
    expect(getStation()).toBeNull();
    expect(getStationError()).toBeNull();
  });

  it('fails explicitly when discovery is ambiguous', async () => {
    mockedSearch.mockResolvedValue([
      { name: 'Owner-A', service: 'JSON', identifier: getStationQdnIdentifier() },
      { name: 'Owner-B', service: 'JSON', identifier: getStationQdnIdentifier() },
    ]);

    await loadStationConfig(null);

    expect(getStationLoaded()).toBe(false);
    expect(getStationError()).toMatch(/ambiguous/i);
  });

  it('treats a discovered but malformed station record as a data error', async () => {
    mockedFetch.mockResolvedValue({ stationId: 'station-1', name: '' });
    mockedSearch.mockResolvedValue([
      { name: 'Owner', service: 'JSON', identifier: getStationQdnIdentifier() },
    ]);

    await loadStationConfig(null);

    expect(getStationLoaded()).toBe(false);
    expect(getStationError()).toMatch(/invalid nodefm station configuration/i);
  });

  it('publishes and updates the singleton station resource', async () => {
    mockedPublish.mockResolvedValue({ accepted: true } as never);
    const station = createStation({
      name: 'NodeFM',
      ownerAddress: 'Q-owner',
      ownerName: 'Owner',
      timezone: 'Europe/Helsinki',
      defaultRotationPlaylistId: 'playlist-1',
      defaultRotationPlaylistVersionId: 'version-1',
      stationEpochUtc: '2026-01-01T00:00:00.000Z',
      messagingEnabled: false,
      tipsEnabled: false,
    });

    await saveStationConfig(station, 'Owner');

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        name: 'Owner',
        identifier: getStationQdnIdentifier(),
      }),
    );
    expect(getStation()?.stationId).toBe(station.stationId);
  });
});
