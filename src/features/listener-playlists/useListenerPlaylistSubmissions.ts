/* ============================================================
 * NodeFM Station — useListenerPlaylistSubmissions Hook
 *
 * Admin review state for listener playlist submissions. The
 * store is scoped to the station publisher/owner and never
 * grants listener authority.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../app/providers/authContext';
import { useStationIdentity } from '../station';
import {
  acceptListenerPlaylistSubmission,
  getListenerPlaylistSubmissionError,
  getListenerPlaylistSubmissionIncomplete,
  getListenerPlaylistSubmissionLoaded,
  getListenerPlaylistSubmissionLoading,
  getListenerPlaylistSubmissionReviews,
  loadListenerPlaylistSubmissions,
  rejectListenerPlaylistSubmission,
  resetListenerPlaylistSubmissionStore,
  subscribeToListenerPlaylistSubmissionStore,
  type ListenerPlaylistSubmissionReview,
} from './services/listenerPlaylistSubmissionStore';

export type UseListenerPlaylistSubmissionsResult = {
  reviews: ListenerPlaylistSubmissionReview[];
  loaded: boolean;
  loading: boolean;
  incomplete: boolean;
  error: string | null;
  accept: (
    review: ListenerPlaylistSubmissionReview,
  ) => ReturnType<typeof acceptListenerPlaylistSubmission>;
  reject: (
    review: ListenerPlaylistSubmissionReview,
    reason?: string,
  ) => ReturnType<typeof rejectListenerPlaylistSubmission>;
  refresh: () => Promise<void>;
};

export function useListenerPlaylistSubmissions(): UseListenerPlaylistSubmissionsResult {
  const { auth } = useAuth();
  const { ownerAddress, publisherName } = useStationIdentity();
  const actorAddress = auth.status === 'authenticated' ? auth.address : null;

  const [reviews, setReviews] = useState<ListenerPlaylistSubmissionReview[]>(
    getListenerPlaylistSubmissionReviews(),
  );
  const [loaded, setLoaded] = useState(getListenerPlaylistSubmissionLoaded());
  const [loading, setLoading] = useState(getListenerPlaylistSubmissionLoading());
  const [incomplete, setIncomplete] = useState(getListenerPlaylistSubmissionIncomplete());
  const [error, setError] = useState<string | null>(getListenerPlaylistSubmissionError());

  useEffect(() => {
    const unsubscribe = subscribeToListenerPlaylistSubmissionStore(() => {
      setReviews(getListenerPlaylistSubmissionReviews());
      setLoaded(getListenerPlaylistSubmissionLoaded());
      setLoading(getListenerPlaylistSubmissionLoading());
      setIncomplete(getListenerPlaylistSubmissionIncomplete());
      setError(getListenerPlaylistSubmissionError());
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!ownerAddress || !publisherName) {
      resetListenerPlaylistSubmissionStore();
      setReviews([]);
      setLoaded(false);
      setLoading(false);
      setIncomplete(false);
      setError(null);
      return;
    }

    loadListenerPlaylistSubmissions(publisherName, ownerAddress);
  }, [ownerAddress, publisherName]);

  const refresh = useCallback(async () => {
    if (!ownerAddress || !publisherName) return;
    await loadListenerPlaylistSubmissions(publisherName, ownerAddress, true);
  }, [ownerAddress, publisherName]);

  const accept = useCallback(
    (review: ListenerPlaylistSubmissionReview) => {
      if (!ownerAddress || !publisherName) {
        return Promise.reject(new Error('A station publisher and owner account are required.'));
      }

      return acceptListenerPlaylistSubmission(review, publisherName, actorAddress, ownerAddress);
    },
    [actorAddress, ownerAddress, publisherName],
  );

  const reject = useCallback(
    (review: ListenerPlaylistSubmissionReview, reason?: string) => {
      if (!ownerAddress || !publisherName) {
        return Promise.reject(new Error('A station publisher and owner account are required.'));
      }

      return rejectListenerPlaylistSubmission(
        review,
        publisherName,
        actorAddress,
        ownerAddress,
        reason,
      );
    },
    [actorAddress, ownerAddress, publisherName],
  );

  return { reviews, loaded, loading, incomplete, error, accept, reject, refresh };
}
