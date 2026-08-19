/* ============================================================
 * NodeFM Station — Playlist Queue Tests
 *
 * Pure order/boundary tests for PLAYLIST mode queue logic.
 * ============================================================ */

import { describe, it, expect, vi } from 'vitest';
import {
  advancePlaylistQueue,
  createPlaylistQueueState,
  getCurrentOriginalIndex,
  getCurrentPlaylistTrack,
  previousPlaylistQueue,
  setPlaylistQueueLoop,
  setPlaylistQueueShuffle,
} from '../audio/playlistQueue';
import type { AudioTrack } from '../audio/playbackTypes';

function track(id: string): AudioTrack {
  return {
    trackId: id,
    title: id,
    url: `https://example.com/${id}.mp3`,
    durationMs: 1000,
  };
}

describe('playlist queue order', () => {
  const tracks = [track('a'), track('b'), track('c')];

  it('starts at the requested index in linear order', () => {
    const queue = createPlaylistQueueState(tracks, { startIndex: 1 });

    expect(getCurrentPlaylistTrack(queue)?.trackId).toBe('b');
    expect(getCurrentOriginalIndex(queue)).toBe(1);
  });

  it('advances in order and stops at the end when loop is off', () => {
    const first = advancePlaylistQueue(createPlaylistQueueState(tracks));
    expect(getCurrentPlaylistTrack(first.queue)?.trackId).toBe('b');
    expect(first.ended).toBe(false);

    const second = advancePlaylistQueue(first.queue);
    expect(getCurrentPlaylistTrack(second.queue)?.trackId).toBe('c');

    const third = advancePlaylistQueue(second.queue);
    expect(third.ended).toBe(true);
    expect(getCurrentPlaylistTrack(third.queue)?.trackId).toBe('c');
  });

  it('wraps to the first track when loop is on', () => {
    const queue = createPlaylistQueueState(tracks, { startIndex: 2, loop: true });
    const next = advancePlaylistQueue(queue);

    expect(next.wrapped).toBe(true);
    expect(getCurrentPlaylistTrack(next.queue)?.trackId).toBe('a');
  });

  it('previous restarts the first track when loop is off', () => {
    const previous = previousPlaylistQueue(createPlaylistQueueState(tracks));

    expect(previous.restarted).toBe(true);
    expect(getCurrentPlaylistTrack(previous.queue)?.trackId).toBe('a');
  });

  it('previous wraps to the last track when loop is on', () => {
    const queue = createPlaylistQueueState(tracks, { loop: true });
    const previous = previousPlaylistQueue(queue);

    expect(previous.wrapped).toBe(true);
    expect(getCurrentPlaylistTrack(previous.queue)?.trackId).toBe('c');
  });

  it('disabling shuffle restores linear order at the current original index', () => {
    const queue = createPlaylistQueueState(tracks, { shuffle: true });
    const shuffled = setPlaylistQueueShuffle(queue, false);

    expect(shuffled.shuffleEnabled).toBe(false);
    expect(shuffled.order).toEqual([0, 1, 2]);
    expect(shuffled.position).toBe(getCurrentOriginalIndex(queue) ?? 0);
  });

  it('enabling shuffle keeps the current original track as the first shuffled entry', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const queue = createPlaylistQueueState(tracks, { startIndex: 1 });
    const shuffled = setPlaylistQueueShuffle(queue, true);

    expect(shuffled.shuffleEnabled).toBe(true);
    expect(shuffled.order[shuffled.position]).toBe(1);
    vi.restoreAllMocks();
  });

  it('toggles loop without changing position or order', () => {
    const queue = createPlaylistQueueState(tracks, { startIndex: 1 });
    const looped = setPlaylistQueueLoop(queue, true);

    expect(looped.loopEnabled).toBe(true);
    expect(looped.position).toBe(queue.position);
    expect(looped.order).toEqual(queue.order);
  });
});
