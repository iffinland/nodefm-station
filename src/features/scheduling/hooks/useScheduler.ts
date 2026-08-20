/* ============================================================
 * NodeFM Station — useScheduler Hook
 *
 * React subscription to the account-scoped schedule store.
 * ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import type { ScheduleEvent, ScheduleRecurrence } from '../../../types/domain';
import { useStationIdentity } from '../../station';
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
  retryScheduleRecurrenceEventsAction,
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
import type { ScheduleRecurrenceApplyResult } from '../services/scheduleStore';
import type { ScheduleRecurrenceDeleteResult } from '../services/scheduleStore';

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
  retryRecurrenceEvents: (recurrenceId: string) => Promise<ScheduleRecurrenceApplyResult>;
  deleteRecurrence: (recurrenceId: string) => Promise<ScheduleRecurrenceDeleteResult>;
  refresh: () => Promise<void>;
};

export function useScheduler(): UseSchedulerResult {
  const { ownerAddress, publisherName } = useStationIdentity();

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
    const action = getScheduleLoadAction(publisherName, ownerAddress);

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

    if (publisherName && ownerAddress) {
      resetScheduleStore();
      setEvents([]);
      setRecurrences([]);
      setLoaded(false);
      setLoading(true);
      setError(null);
      void loadScheduleStore(publisherName, ownerAddress);
    }
  }, [ownerAddress, publisherName]);

  const refresh = useCallback(async () => {
    if (!ownerAddress || !publisherName) {
      return;
    }

    resetScheduleStore();
    setEvents([]);
    setRecurrences([]);
    setLoaded(false);
    setLoading(true);
    setError(null);
    await loadScheduleStore(publisherName, ownerAddress);
  }, [ownerAddress, publisherName]);

  const throwIfNoName = useCallback(() => {
    if (!publisherName || !ownerAddress) {
      throw new Error('A registered Qortium name is required.');
    }
  }, [ownerAddress, publisherName]);

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
      return createScheduleEventAction(input, publisherName!);
    },
    updateEvent: async (eventId, input) => {
      throwIfNoName();
      return updateScheduleEventAction(eventId, input, publisherName!);
    },
    deleteEvent: async (eventId) => {
      throwIfNoName();
      return deleteScheduleEventAction(eventId, publisherName!);
    },
    createRecurrence: async (input) => {
      throwIfNoName();
      return createScheduleRecurrenceAction(
        { ...input, ownerAddress: ownerAddress! },
        publisherName!,
        getNowUtcMs(),
      );
    },
    updateRecurrence: async (recurrenceId, input) => {
      throwIfNoName();
      return updateScheduleRecurrenceAction(recurrenceId, input, publisherName!, getNowUtcMs());
    },
    retryRecurrenceEvents: async (recurrenceId) => {
      throwIfNoName();
      return retryScheduleRecurrenceEventsAction(recurrenceId, publisherName!, getNowUtcMs());
    },
    deleteRecurrence: async (recurrenceId) => {
      throwIfNoName();
      return deleteScheduleRecurrenceAction(recurrenceId, publisherName!, getNowUtcMs());
    },
    refresh,
  };
}
