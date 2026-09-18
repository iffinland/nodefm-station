import { describe, expect, it } from 'vitest';
import type { Track } from '../types/domain';
import type { LiveState } from '../features/radio/timeline';
import { buildLiveBackgroundAudioQueue } from '../features/radio/player/backgroundAudio';

function track(trackId: string, durationMs: number): Track {
  return {
    schemaVersion: 1,
    trackId,
    ownerAddress: 'owner',
    title: trackId,
    artist: 'Artist',
    audio: { service: 'AUDIO', name: 'Radio', identifier: trackId },
    durationMs,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('live background audio queue', () => {
  it('clips a scheduled track at the next deterministic transition', () => {
    const current = track('current', 360_000);
    const next = track('next', 240_000);
    const live: LiveState = {
      mode: 'scheduled',
      trackId: current.trackId,
      offsetMs: 120_000,
      sourceStartUtcMs: 1_000_000,
      sourceEndUtcMs: 1_180_000,
      trackIndex: 0,
      trackStartUtcMs: 1_000_000,
      trackEndUtcMs: 1_360_000,
      nextTransitionUtcMs: 1_180_000,
    };

    const queue = buildLiveBackgroundAudioQueue(live, current, [
      {
        trackId: next.trackId,
        durationMs: next.durationMs,
        expectedStartUtcMs: 1_180_000,
        mode: 'default-rotation',
        title: next.title,
        artist: next.artist,
        track: next,
      },
    ]);

    expect(queue).toHaveLength(2);
    expect(queue[0].endPositionMs).toBe(180_000);
    expect(queue[0].expectedStartUtcMs).toBe(1_000_000);
    expect(queue[1].endPositionMs).toBe(240_000);
  });
});
