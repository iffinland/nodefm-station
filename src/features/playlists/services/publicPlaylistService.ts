/* ============================================================
 * NodeFM Station — Public Playlist Discovery
 *
 * Read-only public station playlist browser for the current
 * phase. It intentionally does not implement playlist playback;
 * that remains a later roadmap phase.
 * ============================================================ */

import { fetchQdnResourceData, searchQdnResources } from '../../../qortium/qdn';
import type { Playlist } from '../../../types/domain';
import { deserializePlaylistFromQdn } from './playlistService';

const PLAYLIST_SERVICE = 'PLAYLIST';
const PLAYLIST_IDENTIFIER_PREFIX = 'nodefm-playlist-';

export type PublicPlaylist = Playlist & {
  publisherName: string;
  qdnIdentifier: string;
};

function isPublicPlaylist(value: Playlist): boolean {
  return value.visibility === 'public';
}

export async function loadPublicPlaylists(publisherName?: string): Promise<PublicPlaylist[]> {
  if (!publisherName) {
    return [];
  }

  const results = await searchQdnResources({
    service: PLAYLIST_SERVICE,
    name: publisherName,
    query: PLAYLIST_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 500,
    includeMetadata: true,
  });

  const uniqueRefs = new Map<string, { name: string; identifier: string }>();

  for (const result of results) {
    if (!result.name || !result.identifier?.startsWith(PLAYLIST_IDENTIFIER_PREFIX)) {
      continue;
    }

    uniqueRefs.set(`${result.name}\u0000${result.identifier}`, {
      name: result.name,
      identifier: result.identifier,
    });
  }

  const playlists: PublicPlaylist[] = [];

  for (const ref of uniqueRefs.values()) {
    try {
      const payload = await fetchQdnResourceData({
        service: PLAYLIST_SERVICE,
        name: ref.name,
        identifier: ref.identifier,
      });
      const playlist = deserializePlaylistFromQdn(payload);

      if (playlist && isPublicPlaylist(playlist)) {
        playlists.push({
          ...playlist,
          publisherName: ref.name,
          qdnIdentifier: ref.identifier,
        });
      }
    } catch {
      // Public browsing is best-effort; skip unavailable resources.
    }
  }

  return playlists.sort((left, right) => left.title.localeCompare(right.title));
}
