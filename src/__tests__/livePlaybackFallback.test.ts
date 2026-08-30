/* ============================================================
 * NodeFM Station — Live Playback Fallback Tests
 *
 * Focused tests for deterministic, resource-scoped fallback when
 * one or more referenced tracks are missing/unusable.
 * ============================================================ */

import { describe, expect, it, vi } from 'vitest';
import {
  resolveLivePlaybackCandidate,
  type LivePlaybackCandidate,
} from '../features/radio/player/livePlaybackFallback';
import { createTrack } from '../features/tracks/services/trackService';
import type { Track } from '../types/domain';

function track(trackId: string): Track {
  return createTrack({
    trackId,
    title: `Track ${trackId}`,
    audio: { service: 'AUDIO', name: 'NodeFM', identifier: `audio-${trackId}` },
    durationMs: 60_000,
    source: 'qdn-existing',
    ownerAddress: 'owner',
  });
}

function candidate(
  trackId: string,
  metadata: Track | null,
  overrides: Partial<LivePlaybackCandidate> = {},
): LivePlaybackCandidate {
  const baseIndex = Number.parseInt(trackId.replace(/\D/g, ''), 10) || 0;

  return {
    trackId,
    durationMs: metadata?.durationMs ?? 60_000,
    metadata,
    trackIndex: baseIndex,
    trackStartUtcMs: baseIndex * 60_000,
    trackEndUtcMs: (baseIndex + 1) * 60_000,
    ...overrides,
  };
}

const resolvedPlayback = {
  audioUrl: 'https://node.example/render/AUDIO/NodeFM/audio',
};

describe('resolveLivePlaybackCandidate', () => {
  it('falls forward when the current track metadata is missing', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const result = await resolveLivePlaybackCandidate(
      [candidate('track-0', null), candidate('track-1', track('track-1'))],
      { startIndex: 0, resolveTrack },
    );

    expect(result).toMatchObject({
      status: 'ready',
      track: expect.objectContaining({ trackId: 'track-1' }),
      skippedTrackIds: ['track-0'],
    });
    expect(resolveTrack).toHaveBeenCalledTimes(1);
    expect(resolveTrack).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-1' }));
  });

  it('skips the current track when its AUDIO resolution returns Core 1401', async () => {
    const resolveTrack = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "QDN error 1401: Couldn't find PUT transaction for name NodeFM, service AUDIO and identifier audio-track-0",
        ),
      )
      .mockResolvedValueOnce(resolvedPlayback);
    const result = await resolveLivePlaybackCandidate(
      [candidate('track-0', track('track-0')), candidate('track-1', track('track-1'))],
      { startIndex: 0, resolveTrack },
    );

    expect(result).toMatchObject({
      status: 'ready',
      track: expect.objectContaining({ trackId: 'track-1' }),
      skippedTrackIds: ['track-0'],
    });
  });

  it('skips several consecutive missing tracks and finds a later valid candidate', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const result = await resolveLivePlaybackCandidate(
      [
        candidate('track-0', null),
        candidate('track-1', null),
        candidate('track-2', null),
        candidate('track-3', track('track-3')),
      ],
      { startIndex: 0, resolveTrack },
    );

    expect(result).toMatchObject({
      status: 'ready',
      track: expect.objectContaining({ trackId: 'track-3' }),
      skippedTrackIds: ['track-0', 'track-1', 'track-2'],
    });
  });

  it('returns an honest no-playable-track state when every candidate is missing', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const result = await resolveLivePlaybackCandidate(
      [candidate('track-0', null), candidate('track-1', null), candidate('track-2', null)],
      { startIndex: 0, resolveTrack },
    );

    expect(result).toEqual({
      status: 'no-playable-track',
      skippedTrackIds: ['track-0', 'track-1', 'track-2'],
    });
    expect(resolveTrack).not.toHaveBeenCalled();
  });

  it('terminates without looping for a one-track missing playlist', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const result = await resolveLivePlaybackCandidate([candidate('solo', null)], {
      startIndex: 0,
      resolveTrack,
    });

    expect(result.status).toBe('no-playable-track');
    expect(resolveTrack).not.toHaveBeenCalled();
  });

  it('handles duplicate track IDs without retrying the same bad candidate', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const result = await resolveLivePlaybackCandidate(
      [
        candidate('dup', null),
        candidate('dup', track('dup')),
        candidate('track-2', track('track-2')),
      ],
      { startIndex: 0, resolveTrack },
    );

    expect(result).toMatchObject({
      status: 'ready',
      track: expect.objectContaining({ trackId: 'track-2' }),
    });
    expect(resolveTrack).toHaveBeenCalledTimes(1);
    expect(resolveTrack).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'track-2' }));
  });

  it('respects a hard scheduled end boundary', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const result = await resolveLivePlaybackCandidate(
      [
        candidate('track-0', track('track-0'), {
          trackStartUtcMs: 100_000,
          trackEndUtcMs: 210_000,
        }),
        candidate('track-1', track('track-1'), {
          trackStartUtcMs: 150_000,
          trackEndUtcMs: 190_000,
        }),
      ],
      {
        startIndex: 0,
        sourceEndUtcMs: 200_000,
        resolveTrack,
      },
    );

    expect(result).toMatchObject({
      status: 'ready',
      track: expect.objectContaining({ trackId: 'track-1' }),
    });
  });

  it('falls forward inside a scheduled event when the scheduled candidate is missing', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const result = await resolveLivePlaybackCandidate(
      [
        candidate('track-0', null, {
          trackStartUtcMs: 100_000,
          trackEndUtcMs: 160_000,
        }),
        candidate('track-1', track('track-1'), {
          trackStartUtcMs: 160_000,
          trackEndUtcMs: 220_000,
        }),
      ],
      {
        startIndex: 0,
        sourceEndUtcMs: 240_000,
        resolveTrack,
      },
    );

    expect(result).toMatchObject({
      status: 'ready',
      track: expect.objectContaining({ trackId: 'track-1' }),
      skippedTrackIds: ['track-0'],
    });
  });

  it('falls forward deterministically for AutoDJ candidates', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const candidates = [
      candidate('track-0', null),
      candidate('track-1', null),
      candidate('track-2', track('track-2')),
    ];

    const result = await resolveLivePlaybackCandidate(candidates, {
      startIndex: 0,
      resolveTrack,
    });

    expect(result).toMatchObject({
      status: 'ready',
      track: expect.objectContaining({ trackId: 'track-2' }),
      skippedTrackIds: ['track-0', 'track-1'],
    });
  });

  it('does not treat generic network failure as a deleted track', async () => {
    const resolveTrack = vi.fn().mockRejectedValueOnce(new Error('temporarily unavailable'));
    const result = await resolveLivePlaybackCandidate(
      [candidate('track-0', track('track-0')), candidate('track-1', track('track-1'))],
      { startIndex: 0, resolveTrack },
    );

    expect(result).toMatchObject({
      status: 'fatal',
      code: 'playback-resolution-error',
      message: 'temporarily unavailable',
      trackId: 'track-0',
    });
    expect(resolveTrack).toHaveBeenCalledTimes(1);
  });

  it('is deterministic for repeated equal inputs', async () => {
    const resolveTrack = vi.fn(async () => resolvedPlayback);
    const candidates = [
      candidate('track-0', null),
      candidate('track-1', track('track-1')),
      candidate('track-2', track('track-2')),
    ];

    const first = await resolveLivePlaybackCandidate(candidates, {
      startIndex: 0,
      resolveTrack,
    });
    const second = await resolveLivePlaybackCandidate(candidates, {
      startIndex: 0,
      resolveTrack,
    });

    expect(second).toEqual(first);
  });
});
