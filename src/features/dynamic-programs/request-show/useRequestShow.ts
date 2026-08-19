/* ============================================================
 * NodeFM Station — useRequestShow Hook
 *
 * React subscription to the account-scoped Request Show store.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import type { DynamicProgramDefinition, DynamicProgramOccurrence } from '../../../types/domain';
import { useAuth } from '../../../app/providers/authContext';
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
  const { auth, ownerName } = useAuth();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

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
    const action = getRequestShowLoadAction(ownerName, ownerAddress);

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

    if (ownerName && ownerAddress) {
      resetRequestShowStore();
      setDefinitions([]);
      setOccurrences([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      void loadRequestShowStore(ownerName, ownerAddress);
    }
  }, [ownerAddress, ownerName]);

  const refresh = useCallback(async () => {
    if (!ownerName || !ownerAddress) {
      return;
    }

    resetRequestShowStore();
    setDefinitions([]);
    setOccurrences([]);
    setLoaded(false);
    setLoading(true);
    setError(null);
    await loadRequestShowStore(ownerName, ownerAddress);
  }, [ownerAddress, ownerName]);

  const throwIfNoName = useCallback(() => {
    if (!ownerName) {
      throw new Error('A registered Qortium name is required.');
    }
  }, [ownerName]);

  return {
    definitions,
    occurrences,
    loaded,
    loading,
    error,
    createDefinition: async (input) => {
      throwIfNoName();
      return createRequestShowDefinitionAction(input, ownerName!);
    },
    updateDefinition: async (programDefinitionId, input) => {
      throwIfNoName();
      return updateRequestShowDefinitionAction(programDefinitionId, input, ownerName!);
    },
    refresh,
  };
}
