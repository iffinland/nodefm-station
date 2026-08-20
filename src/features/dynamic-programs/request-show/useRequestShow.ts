/* ============================================================
 * NodeFM Station — useRequestShow Hook
 *
 * React subscription to the account-scoped Request Show store.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import type { DynamicProgramDefinition, DynamicProgramOccurrence } from '../../../types/domain';
import { useStationIdentity } from '../../station';
import {
  createRequestShowDefinitionAction,
  getRequestShowDefinitions,
  getRequestShowError,
  getRequestShowLoadAction,
  getRequestShowLoaded,
  getRequestShowLoading,
  getRequestShowOccurrences,
  loadRequestShowStore,
  resetRequestShowStore,
  subscribeToRequestShowStore,
  updateRequestShowDefinitionAction,
} from './requestShowStore';
import type { CreateDynamicProgramDefinitionInput } from './requestShowService';

export type UseRequestShowResult = {
  definitions: DynamicProgramDefinition[];
  occurrences: DynamicProgramOccurrence[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  createDefinition: (
    input: CreateDynamicProgramDefinitionInput,
  ) => Promise<DynamicProgramDefinition>;
  updateDefinition: (
    programDefinitionId: string,
    input: CreateDynamicProgramDefinitionInput,
  ) => Promise<DynamicProgramDefinition>;
  refresh: () => Promise<void>;
};

export function useRequestShow(): UseRequestShowResult {
  const { ownerAddress, publisherName } = useStationIdentity();

  const [definitions, setDefinitions] = useState(getRequestShowDefinitions());
  const [occurrences, setOccurrences] = useState(getRequestShowOccurrences());
  const [loaded, setLoaded] = useState(getRequestShowLoaded());
  const [loading, setLoading] = useState(getRequestShowLoading());
  const [error, setError] = useState<string | null>(getRequestShowError());

  useEffect(() => {
    const unsubscribe = subscribeToRequestShowStore(() => {
      setDefinitions(getRequestShowDefinitions());
      setOccurrences(getRequestShowOccurrences());
      setLoaded(getRequestShowLoaded());
      setLoading(getRequestShowLoading());
      setError(getRequestShowError());
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const action = getRequestShowLoadAction(publisherName, ownerAddress);

    if (action === 'clear') {
      resetRequestShowStore();
      setDefinitions([]);
      setOccurrences([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }

    if (action === 'reuse') {
      setDefinitions(getRequestShowDefinitions());
      setOccurrences(getRequestShowOccurrences());
      setLoaded(getRequestShowLoaded());
      setLoading(getRequestShowLoading());
      setError(getRequestShowError());
      return;
    }

    if (publisherName && ownerAddress) {
      resetRequestShowStore();
      setDefinitions([]);
      setOccurrences([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      void loadRequestShowStore(publisherName, ownerAddress);
    }
  }, [ownerAddress, publisherName]);

  const refresh = useCallback(async () => {
    if (!publisherName || !ownerAddress) {
      return;
    }

    resetRequestShowStore();
    setDefinitions([]);
    setOccurrences([]);
    setLoaded(false);
    setLoading(true);
    setError(null);
    await loadRequestShowStore(publisherName, ownerAddress);
  }, [ownerAddress, publisherName]);

  const throwIfNoName = useCallback(() => {
    if (!publisherName) {
      throw new Error('A registered Qortium name is required.');
    }
  }, [publisherName]);

  return {
    definitions,
    occurrences,
    loaded,
    loading,
    error,
    createDefinition: async (input) => {
      throwIfNoName();
      return createRequestShowDefinitionAction(input, publisherName!);
    },
    updateDefinition: async (programDefinitionId, input) => {
      throwIfNoName();
      return updateRequestShowDefinitionAction(programDefinitionId, input, publisherName!);
    },
    refresh,
  };
}
