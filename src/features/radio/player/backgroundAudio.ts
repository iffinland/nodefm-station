import type { Track } from '../../../types/domain';
import type { LiveState } from '../timeline';
import type { UpcomingTrackWithMetadata } from '../hooks/useRadioTimeline';
import {
  controlQdnBackgroundAudio,
  getQdnBackgroundAudioStatus,
  setQdnBackgroundAudioQueue,
  supportsQdnBackgroundAudio,
  type QdnBackgroundAudioItem,
  type QdnBackgroundAudioStatus,
} from '../../../qortium/qdn';

type UpcomingWithTrack = UpcomingTrackWithMetadata & { track: Track };

let supported: Promise<boolean> | null = null;

export function isQdnBackgroundAudioSupported(): Promise<boolean> {
  supported ??= supportsQdnBackgroundAudio().catch(() => false);
  return supported;
}

export function buildLiveBackgroundAudioQueue(
  live: LiveState,
  currentTrack: Track,
  upcoming: readonly UpcomingWithTrack[],
): QdnBackgroundAudioItem[] {
  const entries = [
    { expectedStartUtcMs: live.trackStartUtcMs, track: currentTrack },
    ...upcoming
      .filter((item) => item.expectedStartUtcMs > live.trackStartUtcMs)
      .map((item) => ({ expectedStartUtcMs: item.expectedStartUtcMs, track: item.track })),
  ].slice(0, 256);

  return entries.flatMap((entry, index) => {
    const nextStart = entries[index + 1]?.expectedStartUtcMs;
    const timelineWindowMs =
      nextStart === undefined ? entry.track.durationMs : nextStart - entry.expectedStartUtcMs;
    const endPositionMs = Math.min(entry.track.durationMs, timelineWindowMs);
    if (!Number.isFinite(endPositionMs) || endPositionMs <= 0) return [];
    return [
      {
        artist: entry.track.artist,
        durationMs: entry.track.durationMs,
        endPositionMs: Math.round(endPositionMs),
        expectedStartUtcMs: Math.round(entry.expectedStartUtcMs),
        mediaId: `${entry.track.trackId}:${Math.round(entry.expectedStartUtcMs)}`,
        resource: entry.track.audio,
        title: entry.track.title,
      },
    ];
  });
}

export async function startLiveBackgroundAudio(
  live: LiveState,
  currentTrack: Track,
  upcoming: readonly UpcomingWithTrack[],
): Promise<QdnBackgroundAudioStatus> {
  const queue = buildLiveBackgroundAudioQueue(live, currentTrack, upcoming);
  if (queue.length === 0) throw new Error('The live background audio queue is empty.');
  return setQdnBackgroundAudioQueue(queue, live.offsetMs);
}

export { controlQdnBackgroundAudio, getQdnBackgroundAudioStatus };
