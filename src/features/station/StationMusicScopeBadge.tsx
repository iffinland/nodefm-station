/* ============================================================
 * NodeFM Station — Station Music Scope Badge
 *
 * Concise listener-facing station identity label. Missing metadata
 * intentionally renders nothing, so legacy Station resources do not
 * falsely claim a programming scope.
 * ============================================================ */

import type { StationMusicScope } from '../../types/domain';

const MUSIC_SCOPE_PRESENTATION: Record<StationMusicScope, { icon: string; label: string }> = {
  INTERNATIONAL: { icon: '🌍', label: 'International Music' },
  REGIONAL: { icon: '📍', label: 'Regional Music' },
  MIXED: { icon: '🎧', label: 'Mixed Music' },
};

export function StationMusicScopeBadge({ musicScope }: { musicScope?: StationMusicScope }) {
  if (!musicScope) {
    return null;
  }

  const presentation = MUSIC_SCOPE_PRESENTATION[musicScope];

  return (
    <span className="station-music-scope" aria-label={presentation.label}>
      <span aria-hidden="true">{presentation.icon}</span>
      {presentation.label}
    </span>
  );
}
