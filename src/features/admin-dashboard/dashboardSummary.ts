/* ============================================================
 * NodeFM Station — Admin Dashboard Summary
 *
 * Pure helpers for turning account-scoped store state into
 * honest dashboard counts. The dashboard never invents a count
 * from incomplete or unavailable data.
 * ============================================================ */

import type { Playlist } from '../../types/domain';
import type { ListenerSubmissionReview } from '../listener-submissions/services/submissionStore';

export type DashboardCountStatus = 'loading' | 'error' | 'ready' | 'incomplete';

export type DashboardCountResolution = {
  status: DashboardCountStatus;
  value: number | null;
  hint: string;
};

type CountSource = {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  incomplete: boolean;
  count: number;
};

export function resolveDashboardCount(
  source: CountSource,
  readyHint: string,
): DashboardCountResolution {
  if (!source.loaded && source.loading) {
    return { status: 'loading', value: null, hint: 'Loading…' };
  }

  if (!source.loaded && source.error) {
    return { status: 'error', value: null, hint: 'Unable to load' };
  }

  if (source.loaded && source.incomplete) {
    return { status: 'incomplete', value: source.count, hint: 'Partial count' };
  }

  if (source.loaded) {
    return { status: 'ready', value: source.count, hint: readyHint };
  }

  return { status: 'loading', value: null, hint: 'Loading…' };
}

export function getPublishedPlaylistCount(playlists: readonly Playlist[]): number {
  return playlists.filter((playlist) => Boolean(playlist.latestVersionId)).length;
}

export function getPendingSubmissionCount(reviews: readonly ListenerSubmissionReview[]): number {
  return reviews.filter((review) => review.status === 'PENDING').length;
}
