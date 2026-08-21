/* ============================================================
 * NodeFM Station — Add Existing QDN Audio Service
 *
 * Pure track-input construction for the Add QDN flow. The audio
 * resource is always preserved as an external QDN reference; only
 * optional station-owned cover metadata is added when a cover was
 * successfully published.
 * ============================================================ */

import type { QdnResourceRef, Track } from '../../../types/domain';
import type { CreateTrackInput } from '../../tracks/services/trackService';

export type AddQdnTrackInput = {
  title: string;
  artist?: string;
  album?: string;
  releaseDate?: string;
  description?: string;
  audio: QdnResourceRef;
  durationMs: number;
  genres?: string[];
  tags?: string[];
  cover?: QdnResourceRef;
  ownerAddress: string;
};

export function buildAddQdnTrackInput(input: AddQdnTrackInput): CreateTrackInput {
  return {
    title: input.title.trim() || input.audio.name || 'Untitled',
    artist: input.artist?.trim() || undefined,
    album: input.album?.trim() || undefined,
    releaseDate: input.releaseDate?.trim() || undefined,
    description: input.description?.trim() || undefined,
    audio: {
      service: input.audio.service,
      name: input.audio.name,
      identifier: input.audio.identifier || 'default',
    },
    durationMs: input.durationMs,
    genres: input.genres,
    tags: input.tags,
    cover: input.cover,
    source: 'qdn-existing',
    ownerAddress: input.ownerAddress,
  };
}

export function hasExternalAudioReference(track: Track, source: QdnResourceRef): boolean {
  return (
    track.source === 'qdn-existing' &&
    track.audio.service === source.service &&
    track.audio.name === source.name &&
    (track.audio.identifier ?? 'default') === (source.identifier ?? 'default')
  );
}
