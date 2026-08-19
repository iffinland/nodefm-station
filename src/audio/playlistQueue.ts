/* ============================================================
 * NodeFM Station — Playlist Queue
 *
 * Pure queue/order logic for the global AudioEngine's PLAYLIST
 * mode. Keeping this small and side-effect-free makes next,
 * previous, shuffle, loop, and playlist-end behavior testable
 * without an HTMLAudioElement.
 * ============================================================ */

import type { AudioTrack, PlaylistQueueState } from './playbackTypes';

export type PlaylistTransition = {
  queue: PlaylistQueueState;
  wrapped: boolean;
  ended: boolean;
  restarted: boolean;
};

function createLinearOrder(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

function createShuffledOrder(length: number, currentOriginalIndex: number | null): number[] {
  const indices = createLinearOrder(length);

  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }

  if (
    currentOriginalIndex !== null &&
    Number.isInteger(currentOriginalIndex) &&
    currentOriginalIndex >= 0 &&
    currentOriginalIndex < indices.length
  ) {
    const currentPosition = indices.indexOf(currentOriginalIndex);
    if (currentPosition !== 0) {
      [indices[0], indices[currentPosition]] = [indices[currentPosition], indices[0]];
    }
  }

  return indices;
}

export function createPlaylistQueueState(
  tracks: readonly AudioTrack[],
  options: {
    startIndex?: number;
    shuffle?: boolean;
    loop?: boolean;
  } = {},
): PlaylistQueueState {
  const shuffleEnabled = options.shuffle ?? false;
  const loopEnabled = options.loop ?? false;
  const requestedStartIndex = options.startIndex ?? 0;

  if (tracks.length === 0) {
    return {
      tracks: [],
      order: [],
      position: 0,
      shuffleEnabled,
      loopEnabled,
    };
  }

  const startIndex = Math.max(0, Math.min(requestedStartIndex, tracks.length - 1));
  const order = shuffleEnabled
    ? createShuffledOrder(tracks.length, startIndex)
    : createLinearOrder(tracks.length);

  return {
    tracks,
    order,
    position: shuffleEnabled ? 0 : startIndex,
    shuffleEnabled,
    loopEnabled,
  };
}

export function getCurrentPlaylistTrack(queue: PlaylistQueueState | null): AudioTrack | null {
  if (
    !queue ||
    queue.tracks.length === 0 ||
    queue.position < 0 ||
    queue.position >= queue.order.length
  ) {
    return null;
  }

  const originalIndex = queue.order[queue.position];
  return queue.tracks[originalIndex] ?? null;
}

export function getCurrentOriginalIndex(queue: PlaylistQueueState | null): number | null {
  if (
    !queue ||
    queue.tracks.length === 0 ||
    queue.position < 0 ||
    queue.position >= queue.order.length
  ) {
    return null;
  }

  return queue.order[queue.position];
}

export function advancePlaylistQueue(queue: PlaylistQueueState): PlaylistTransition {
  if (queue.order.length === 0) {
    return { queue, wrapped: false, ended: true, restarted: false };
  }

  if (queue.position < queue.order.length - 1) {
    return {
      queue: { ...queue, position: queue.position + 1 },
      wrapped: false,
      ended: false,
      restarted: false,
    };
  }

  if (queue.loopEnabled) {
    return {
      queue: { ...queue, position: 0 },
      wrapped: true,
      ended: false,
      restarted: false,
    };
  }

  return { queue, wrapped: false, ended: true, restarted: false };
}

export function previousPlaylistQueue(queue: PlaylistQueueState): PlaylistTransition {
  if (queue.order.length === 0) {
    return { queue, wrapped: false, ended: false, restarted: true };
  }

  if (queue.position > 0) {
    return {
      queue: { ...queue, position: queue.position - 1 },
      wrapped: false,
      ended: false,
      restarted: false,
    };
  }

  if (queue.loopEnabled) {
    return {
      queue: { ...queue, position: queue.order.length - 1 },
      wrapped: true,
      ended: false,
      restarted: false,
    };
  }

  return {
    queue: { ...queue, position: 0 },
    wrapped: false,
    ended: false,
    restarted: true,
  };
}

export function setPlaylistQueueShuffle(
  queue: PlaylistQueueState,
  shuffleEnabled: boolean,
): PlaylistQueueState {
  if (queue.shuffleEnabled === shuffleEnabled || queue.tracks.length === 0) {
    return { ...queue, shuffleEnabled };
  }

  const currentOriginalIndex = getCurrentOriginalIndex(queue);

  if (shuffleEnabled) {
    const order = createShuffledOrder(queue.tracks.length, currentOriginalIndex);
    const position =
      currentOriginalIndex === null ? 0 : Math.max(0, order.indexOf(currentOriginalIndex));
    return {
      ...queue,
      order,
      position,
      shuffleEnabled: true,
    };
  }

  return {
    ...queue,
    order: createLinearOrder(queue.tracks.length),
    position: currentOriginalIndex ?? 0,
    shuffleEnabled: false,
  };
}

export function setPlaylistQueueLoop(
  queue: PlaylistQueueState,
  loopEnabled: boolean,
): PlaylistQueueState {
  return {
    ...queue,
    loopEnabled,
  };
}
