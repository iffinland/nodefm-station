/* ============================================================
 * NodeFM Station — Track Cover Image
 *
 * Resolves a track cover QDN reference asynchronously without
 * blocking audio playback. Falls back to the supplied placeholder
 * while resolving or when the cover cannot be loaded.
 * ============================================================ */

import { useEffect, useState, type ReactNode } from 'react';
import type { QdnResourceRef } from '../../../types/domain';
import { resolveQdnCoverUrl } from '../../radio/player/resolveTrackPlayback';

type TrackCoverProps = {
  cover?: QdnResourceRef;
  placeholder: ReactNode;
  alt?: string;
};

export function TrackCover({ cover, placeholder, alt = '' }: TrackCoverProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (!cover) {
      setCoverUrl(null);
      return;
    }

    resolveQdnCoverUrl(cover).then((url) => {
      if (!cancelled) {
        setCoverUrl(url ?? null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cover]);

  if (!coverUrl || failed) {
    return <>{placeholder}</>;
  }

  return (
    <img
      className="track-card__cover-image"
      src={coverUrl}
      alt={alt}
      onError={() => setFailed(true)}
    />
  );
}
