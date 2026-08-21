/* ============================================================
 * NodeFM Station — Like Store QDN Tests
 *
 * Exercises mode=ALL discovery, identifier deduplication,
 * name-wallet validation, and remote-failure safety.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  fetchQdnResourceData: vi.fn(),
  publishResource: vi.fn(),
  searchQdnResources: vi.fn(),
}));

vi.mock('../qortium/identity', () => ({
  resolveNameWalletAddress: vi.fn(),
}));

import { fetchQdnResourceData, publishResource, searchQdnResources } from '../qortium/qdn';
import { resolveNameWalletAddress } from '../qortium/identity';
import {
  buildLegacyTrackLikeIdentifier,
  buildTrackLikeEnvelope,
  buildTrackLikeIdentifier,
} from '../features/likes/services/likeService';
import {
  getLikeRecords,
  getTrackLikeAggregate,
  loadLikeRecords,
  resetLikeStore,
  setTrackLike,
} from '../features/likes/services/likeStore';

const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedPublish = vi.mocked(publishResource);
const mockedSearch = vi.mocked(searchQdnResources);
const mockedResolveName = vi.mocked(resolveNameWalletAddress);

function envelope(trackId: string, publisherName: string, walletAddress: string) {
  const identifier = buildTrackLikeIdentifier(trackId, walletAddress);
  return {
    identifier,
    payload: buildTrackLikeEnvelope(
      {
        operation: 'like',
        targetType: 'track',
        targetId: trackId,
        state: 'active',
        publisherName,
        walletAddress,
      },
      identifier,
      '2026-01-01T00:00:00.000Z',
    ),
  };
}

describe('Like store discovery', () => {
  beforeEach(() => {
    resetLikeStore();
    mockedFetch.mockReset();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedResolveName.mockReset();
  });

  it('uses mode=ALL and reconstructs distinct Like records without double-fetching duplicates', async () => {
    const alice = envelope('track-1', 'alice', 'Q-alice');
    const bob = envelope('track-1', 'bob', 'Q-bob');

    mockedSearch.mockResolvedValue([
      { service: 'JSON', name: 'alice', identifier: alice.identifier, created: 1, updated: 2 },
      { service: 'JSON', name: 'alice', identifier: alice.identifier, created: 1, updated: 2 },
      { service: 'JSON', name: 'bob', identifier: bob.identifier, created: 1, updated: 2 },
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === alice.identifier) return alice.payload;
      if (ref.identifier === bob.identifier) return bob.payload;
      throw new Error(`Unexpected fetch: ${ref.identifier}`);
    });
    mockedResolveName.mockImplementation(async (name) => (name === 'alice' ? 'Q-alice' : 'Q-bob'));

    await loadLikeRecords();

    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'ALL',
        prefix: true,
      }),
    );
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(getLikeRecords()).toHaveLength(2);
    expect(getTrackLikeAggregate('track-1').count).toBe(2);
  });

  it('reads legacy Like identifiers published before the bounded format', async () => {
    const trackId = 'track-1';
    const publisherName = 'alice';
    const walletAddress = 'Q-alice';
    const legacyIdentifier = buildLegacyTrackLikeIdentifier(trackId, walletAddress);

    mockedSearch.mockResolvedValue([
      {
        service: 'JSON',
        name: publisherName,
        identifier: legacyIdentifier,
        created: 1,
        updated: 2,
      },
    ]);
    mockedFetch.mockResolvedValue(
      buildTrackLikeEnvelope(
        {
          operation: 'like',
          targetType: 'track',
          targetId: trackId,
          state: 'active',
          publisherName,
          walletAddress,
        },
        legacyIdentifier,
        '2026-01-01T00:00:00.000Z',
      ),
    );
    mockedResolveName.mockResolvedValue(walletAddress);

    await loadLikeRecords();

    expect(getLikeRecords()).toHaveLength(1);
    expect(getTrackLikeAggregate(trackId).count).toBe(1);
  });

  it('does not turn a failed Like publish into local success', async () => {
    mockedPublish.mockRejectedValue(new Error('Publish failed'));

    await expect(setTrackLike('track-1', 'active', 'alice', 'Q-alice')).rejects.toThrow(
      /publish failed/i,
    );
    expect(getLikeRecords()).toEqual([]);
  });
});
