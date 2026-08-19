/* ============================================================
 * NodeFM Station — Like Domain Tests
 *
 * Covers canonical Like identity, validation, deterministic
 * aggregation, unlike/idempotency, forged identity rejection,
 * and liked-track ranking.
 * ============================================================ */

import { describe, it, expect } from 'vitest';
import type {
  LikeIdentityValidator,
  TrackLikeRecord,
} from '../features/likes/services/likeService';
import {
  buildTrackLikeEnvelope,
  buildTrackLikeIdentifier,
  classifyInvalidTrackLikeEnvelope,
  isTrackLikeEnvelope,
  rankLikedTracks,
  reduceTrackLikeRecords,
} from '../features/likes/services/likeService';

const wallets: Record<string, string> = {
  alice: 'Q-alice',
  bob: 'Q-bob',
};

const identity: LikeIdentityValidator = {
  validatePublisher: (metadata, claimed) =>
    metadata.publisherName === claimed
      ? { ok: true }
      : {
          ok: false,
          code: 'IDENTITY_UNVERIFIED',
          detail: 'publisher mismatch',
        },
  validateWalletBinding: (name, wallet) =>
    wallets[name] === wallet
      ? { ok: true }
      : {
          ok: false,
          code: 'IDENTITY_UNVERIFIED',
          detail: 'wallet mismatch',
        },
};

function record(
  publisherName: string,
  walletAddress: string,
  state: 'active' | 'inactive',
  updated: number | null,
  identifier: string,
  targetId = 'track-1',
): TrackLikeRecord {
  const body = {
    operation: 'like',
    targetType: 'track',
    targetId,
    state,
    publisherName,
    walletAddress,
  } as const;

  return {
    metadata: {
      service: 'JSON',
      publisherName,
      identifier,
      created: 1,
      updated,
    },
    envelope: buildTrackLikeEnvelope(body, identifier, '2026-01-01T00:00:00.000Z'),
  };
}

describe('Like identity', () => {
  it('builds a deterministic identifier for the same track and wallet', () => {
    expect(buildTrackLikeIdentifier('track-1', ' Q-alice ')).toBe(
      buildTrackLikeIdentifier('track-1', 'Q-alice'),
    );
    expect(buildTrackLikeIdentifier('track-1', 'Q-alice')).not.toBe(
      buildTrackLikeIdentifier('track-1', 'Q-bob'),
    );
    expect(
      buildTrackLikeIdentifier('11111111-1111-1111-1111-111111111111', 'Q-alice').length,
    ).toBeLessThanOrEqual(64);
  });

  it('validates the Like envelope and rejects forged extra fields', () => {
    const body = {
      operation: 'like',
      targetType: 'track',
      targetId: 'track-1',
      state: 'active',
      publisherName: 'alice',
      walletAddress: 'Q-alice',
    } as const;
    const envelope = buildTrackLikeEnvelope(body, 'nodefm-like-track-1');

    expect(isTrackLikeEnvelope(envelope)).toBe(true);
    expect(
      isTrackLikeEnvelope({
        ...envelope,
        body: { ...envelope.body, content: 'forged track replacement' },
      }),
    ).toBe(false);
    expect(
      classifyInvalidTrackLikeEnvelope({
        ...envelope,
        body: { ...envelope.body, state: 'invalid' },
      }),
    ).toBe('MALFORMED_ENVELOPE');
  });
});

describe('Like aggregation', () => {
  it('counts each verified user once and ignores input order', () => {
    const aliceLike = record('alice', 'Q-alice', 'active', 2, 'nodefm-like-track-1-alice');
    const bobLike = record('bob', 'Q-bob', 'active', 2, 'nodefm-like-track-1-bob');

    expect(reduceTrackLikeRecords('track-1', [aliceLike, bobLike], identity).count).toBe(2);
    expect(JSON.stringify(reduceTrackLikeRecords('track-1', [bobLike, aliceLike], identity))).toBe(
      JSON.stringify(reduceTrackLikeRecords('track-1', [aliceLike, bobLike], identity)),
    );
  });

  it('repeated like is idempotent and unlike wins by trusted ordering', () => {
    const aliceLike = record('alice', 'Q-alice', 'active', 2, 'nodefm-like-track-1-alice');
    const aliceUnlike = record('alice', 'Q-alice', 'inactive', 3, 'nodefm-like-track-1-alice');

    expect(reduceTrackLikeRecords('track-1', [aliceLike, aliceLike], identity).count).toBe(1);
    expect(reduceTrackLikeRecords('track-1', [aliceUnlike, aliceLike], identity).count).toBe(0);
  });

  it('rejects forged wallet or publisher identity', () => {
    const forged = record('alice', 'Q-bob', 'active', 2, 'nodefm-like-track-1-forged');
    const forgedReduction = reduceTrackLikeRecords('track-1', [forged], identity);
    expect(forgedReduction.count).toBe(0);
    expect(forgedReduction.diagnostics[0]?.code).toBe('IDENTITY_UNVERIFIED');

    const impersonated = record('bob', 'Q-bob', 'active', 2, 'nodefm-like-track-1-alice');
    impersonated.envelope.body.publisherName = 'alice';
    const impersonatedReduction = reduceTrackLikeRecords('track-1', [impersonated], identity);
    expect(impersonatedReduction.count).toBe(0);
    expect(impersonatedReduction.diagnostics[0]?.code).toBe('IDENTITY_UNVERIFIED');
  });

  it('quarantines equal-order conflicting actor states', () => {
    const active = record('alice', 'Q-alice', 'active', 2, 'same');
    const inactive = record('alice', 'Q-alice', 'inactive', 2, 'same');

    const reduced = reduceTrackLikeRecords('track-1', [active, inactive], identity);
    expect(reduced.count).toBe(0);
    expect(reduced.diagnostics[0]?.code).toBe('DUPLICATE_CONFLICT');
  });
});

describe('liked-track ranking', () => {
  it('ranks by most liked and breaks ties by track ID', () => {
    const records = [
      record('alice', 'Q-alice', 'active', 2, 'like-a', 'track-a'),
      record('bob', 'Q-bob', 'active', 2, 'like-b', 'track-a'),
      record('alice', 'Q-alice', 'active', 2, 'like-c', 'track-b'),
      record('alice', 'Q-alice', 'active', 2, 'like-d', 'track-c'),
      record('bob', 'Q-bob', 'active', 2, 'like-e', 'track-c'),
    ];

    const ranked = rankLikedTracks(records, ['track-a', 'track-b', 'track-c'], identity);

    expect(ranked.map((entry) => [entry.trackId, entry.likeCount])).toEqual([
      ['track-a', 2],
      ['track-c', 2],
      ['track-b', 1],
    ]);
  });
});
