/* ============================================================
 * NodeFM Station — Resolve Track Playback
 *
 * Turns Track metadata into playable audio/cover URLs through
 * the QDN resource layer. This is deliberately outside the pure
 * timeline engine.
 * ============================================================ */

import type { Track } from '../../../types/domain';
import type { QdnResourceRef } from '../../../types/domain';
import { ensureQdnResourceReady, getQdnResourceUrl } from '../../../qortium/qdn';

export type ResolvedTrackPlayback = {
  audioUrl: string;
  coverUrl?: string;
};

export async function resolveTrackPlayback(track: Track): Promise<ResolvedTrackPlayback> {
  await ensureQdnResourceReady(track.audio);
  const audioUrl = await getQdnResourceUrl(track.audio);

  return { audioUrl };
}

export async function resolveQdnCoverUrl(cover: QdnResourceRef): Promise<string | undefined> {
  try {
    try {
      await ensureQdnResourceReady(cover);
    } catch {
      // Match the proven reference behavior: readiness polling is a
      // best-effort optimization, not a hard requirement for URL retrieval.
    }

    const coverUrl = await getQdnResourceUrl(cover);
    return coverUrl;
  } catch {
    return undefined;
  }
}

export async function resolveTrackCoverUrl(track: Track): Promise<string | undefined> {
  if (!track.cover) {
    return undefined;
  }

  return resolveQdnCoverUrl(track.cover);
}
