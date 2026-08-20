/* ============================================================
 * NodeFM Station — useListenerSubmissions Hook
 *
 * React state bridge for the listener submission store. Admin-only:
 * the store is scoped to the canonical station publisher/owner.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../app/providers/authContext';
import { useStationIdentity } from '../station';
import type { ListenerTrackSubmission } from '../../types/domain';
import type {
  ListenerSubmissionReview,
  SubmissionPublishInput,
  SubmissionPublishResult,
} from './services/submissionStore';
import type { SubmissionDiagnostic } from './services/submissionService';
import {
  acceptSubmission,
  getSubmissionDiagnostics,
  getSubmissionError,
  getSubmissionIncomplete,
  getSubmissionLoaded,
  getSubmissionLoading,
  getSubmissionReviews,
  loadListenerSubmissions,
  publishListenerSubmission,
  publishSubmissionMetadata,
  refreshListenerSubmissions,
  rejectSubmission,
  resetListenerSubmissionStore,
  subscribeToSubmissionStore,
} from './services/submissionStore';

export type UseListenerSubmissionsResult = {
  reviews: ListenerSubmissionReview[];
  diagnostics: SubmissionDiagnostic[];
  loaded: boolean;
  loading: boolean;
  incomplete: boolean;
  error: string | null;
  publish: (input: SubmissionPublishInput) => Promise<SubmissionPublishResult>;
  publishMetadata: (
    submission: ListenerTrackSubmission,
    submitterName: string,
  ) => Promise<{ accepted: true }>;
  accept: (review: ListenerSubmissionReview) => ReturnType<typeof acceptSubmission>;
  reject: (
    review: ListenerSubmissionReview,
    reason?: string,
  ) => ReturnType<typeof rejectSubmission>;
  refresh: () => Promise<void>;
};

export function useListenerSubmissions(): UseListenerSubmissionsResult {
  const { auth } = useAuth();
  const { ownerAddress, publisherName } = useStationIdentity();
  const actorAddress = auth.status === 'authenticated' ? auth.address : null;

  const [reviews, setReviews] = useState<ListenerSubmissionReview[]>(getSubmissionReviews());
  const [diagnostics, setDiagnostics] = useState<SubmissionDiagnostic[]>(
    getSubmissionDiagnostics(),
  );
  const [loaded, setLoaded] = useState(getSubmissionLoaded());
  const [loading, setLoading] = useState(getSubmissionLoading());
  const [incomplete, setIncomplete] = useState(getSubmissionIncomplete());
  const [error, setError] = useState<string | null>(getSubmissionError());

  useEffect(() => {
    const unsubscribe = subscribeToSubmissionStore(() => {
      setReviews(getSubmissionReviews());
      setDiagnostics(getSubmissionDiagnostics());
      setLoaded(getSubmissionLoaded());
      setLoading(getSubmissionLoading());
      setIncomplete(getSubmissionIncomplete());
      setError(getSubmissionError());
    });

    return unsubscribe;
  }, []);

  const refresh = useCallback(async () => {
    if (!ownerAddress || !publisherName) {
      return;
    }

    await refreshListenerSubmissions(publisherName, ownerAddress);
  }, [ownerAddress, publisherName]);

  useEffect(() => {
    if (!ownerAddress || !publisherName) {
      resetListenerSubmissionStore();
      setReviews([]);
      setDiagnostics([]);
      setLoaded(false);
      setLoading(false);
      setIncomplete(false);
      setError(null);
      return;
    }

    loadListenerSubmissions(publisherName, ownerAddress);
  }, [ownerAddress, publisherName]);

  const publish = useCallback(
    (input: SubmissionPublishInput) => publishListenerSubmission(input),
    [],
  );

  const publishMetadata = useCallback(
    (submission: ListenerTrackSubmission, submitterName: string) =>
      publishSubmissionMetadata(submission, submitterName),
    [],
  );

  const accept = useCallback(
    (review: ListenerSubmissionReview) => {
      if (!ownerAddress || !publisherName) {
        return Promise.reject(new Error('A registered Qortium name is required.'));
      }

      return acceptSubmission(review, publisherName, actorAddress, ownerAddress);
    },
    [actorAddress, ownerAddress, publisherName],
  );

  const reject = useCallback(
    (review: ListenerSubmissionReview, reason?: string) => {
      if (!ownerAddress || !publisherName) {
        return Promise.reject(new Error('A registered Qortium name is required.'));
      }

      return rejectSubmission(review, publisherName, actorAddress, ownerAddress, reason);
    },
    [actorAddress, ownerAddress, publisherName],
  );

  return {
    reviews,
    diagnostics,
    loaded,
    loading,
    incomplete,
    error,
    publish,
    publishMetadata,
    accept,
    reject,
    refresh,
  };
}
