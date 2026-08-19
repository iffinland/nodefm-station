/* ============================================================
 * NodeFM Station — useScheduler Hook
 *
 * React subscription to the account-scoped schedule store.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import type { ScheduleEvent, ScheduleRecurrence } from '../../../types/domain';
import { useAuth } from '../../../app/providers/authContext';
import { getNowUtcMs } from '../../radio/timeline';
import {
  createScheduleEventAction,
  createScheduleRecurrenceAction,
  deleteScheduleEventAction,
  deleteScheduleRecurrenceAction,
  getScheduleError,
  getScheduleEvents,
  getScheduleLoadAction,
  getScheduleLoaded,
  getScheduleLoading,
  getScheduleRecurrenceById,
  getScheduleRecurrences,
  getScheduleEventById,
  loadScheduleStore,
  resetScheduleStore,
  subscribeToScheduleStore,
  updateScheduleEventAction,
  updateScheduleRecurrenceAction,
} from '../services/scheduleStore';
import type {
  CreateScheduleEventInput,
  CreateScheduleRecurrenceInput,
  EditScheduleEventInput,
  EditScheduleRecurrenceInput,
} from '../services/scheduleService';

export type UseSchedulerResult = {
  events: ScheduleEvent[];
  recurrences: ScheduleRecurrence[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  getEvent: (eventId: string) => ScheduleEvent | undefined;
  getRecurrence: (recurrenceId: string) => ScheduleRecurrence | undefined;
  createEvent: (input: CreateScheduleEventInput) => Promise<ScheduleEvent>;
  updateEvent: (eventId: string, input: EditScheduleEventInput) => Promise<ScheduleEvent>;
  deleteEvent: (eventId: string) => Promise<void>;
  createRecurrence: (
    input: Omit<CreateScheduleRecurrenceInput, 'ownerAddress'>,
  ) => Promise<ScheduleRecurrence>;
  updateRecurrence: (
    recurrenceId: string,
    input: EditScheduleRecurrenceInput,
  ) => Promise<ScheduleRecurrence>;
  deleteRecurrence: (recurrenceId: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export function useScheduler(): UseSchedulerResult {
  const { auth, ownerName } = useAuth();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

  const [events, setEvents] = useState<ScheduleEvent[]>(getScheduleEvents());
  const [recurrences, setRecurrences] = useState<ScheduleRecurrence[]>(getScheduleRecurrences());
  const [loaded, setLoaded] = useState(getScheduleLoaded());
  const [loading, setLoading] = useState(getScheduleLoading());
  const [error, setError] = useState<string | null>(getScheduleError());

  useEffect(() => {
    const unsubscribe = subscribeToScheduleStore(() => {
      setEvents(getScheduleEvents());
      setRecurrences(getScheduleRecurrences());
      setLoaded(getScheduleLoaded());
      setLoading(getScheduleLoading());
      setError(getScheduleError());
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const action = getScheduleLoadAction(ownerName, ownerAddress);

    if (action === 'clear') {
      resetScheduleStore();
      setEvents([]);
      setRecurrences([]);
      setLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }

    if (action === 'reuse') {
      setEvents(getScheduleEvents());
      setRecurrences(getScheduleRecurrences());
      setLoaded(getScheduleLoaded());
      setLoading(getScheduleLoading());
      setError(getScheduleError());
      return;
    }

    if (ownerName && ownerAddress) {
      resetScheduleStore();
      setEvents([]);
      setRecurrences([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      void loadScheduleStore(ownerName, ownerAddress);
    }
  }, [ownerAddress, ownerName]);

  const refresh = useCallback(async () => {
    if (!ownerAddress || !ownerName) {
      return;
    }

    resetScheduleStore();
    setEvents([]);
    setRecurrences([]);
    setLoaded(false);
    setLoading(true);
    setError(null);
    await loadScheduleStore(ownerName, ownerAddress);
  }, [ownerAddress, ownerName]);

  const throwIfNoName = useCallback(() => {
    if (!ownerName || !ownerAddress) {
      throw new Error('A registered Qortium name is required.');
    }
  }, [ownerAddress, ownerName]);

  return {
    events,
    recurrences,
    loaded,
    loading,
    error,
    getEvent: getScheduleEventById,
    getRecurrence: getScheduleRecurrenceById,
    createEvent: async (input) => {
      throwIfNoName();
      return createScheduleEventAction(input, ownerName!);
    },
    updateEvent: async (eventId, input) => {
      throwIfNoName();
      return updateScheduleEventAction(eventId, input, ownerName!);
    },
    deleteEvent: async (eventId) => {
      throwIfNoName();
      return deleteScheduleEventAction(eventId, ownerName!);
    },
    createRecurrence: async (input) => {
      throwIfNoName();
      return createScheduleRecurrenceAction(
        { ...input, ownerAddress: ownerAddress! },
        ownerName!,
        getNowUtcMs(),
      );
    },
    updateRecurrence: async (recurrenceId, input) => {
      throwIfNoName();
      return updateScheduleRecurrenceAction(recurrenceId, input, ownerName!, getNowUtcMs());
    },
    deleteRecurrence: async (recurrenceId) => {
      throwIfNoName();
      return deleteScheduleRecurrenceAction(recurrenceId, ownerName!, getNowUtcMs());
    },
    refresh,
  };
}
