/* ============================================================
 * NodeFM Station — Scheduler Delete Integrity Regression Tests
 *
 * Exercises the production recurrence deletion operation as a
 * recoverable multi-step QDN cleanup rather than a single atomic
 * parent-then-children delete.
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  publishResource: vi.fn(),
  publishMultipleResources: vi.fn(),
  searchQdnResources: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  deleteQdnResource: vi.fn(),
}));

import {
  deleteQdnResource,
  fetchQdnResourceData,
  publishMultipleResources,
  publishResource,
  searchQdnResources,
} from '../qortium/qdn';
import type { MultiplePublishResult, PublishMultipleResource } from '../qortium/qdn';
import {
  ScheduleEventMaterializationError,
  ScheduleRecurrenceDeletePartialError,
  createDynamicScheduleEventAction,
  createScheduleRecurrenceAction,
  deleteScheduleRecurrenceAction,
  getScheduleEvents,
  getScheduleRecurrences,
  loadScheduleStore,
  resetScheduleStore,
} from '../features/scheduling/services/scheduleStore';
import {
  getScheduleEventQdnIdentifier,
  getScheduleRecurrenceQdnIdentifier,
} from '../features/scheduling/services/scheduleService';

const OWNER_NAME = 'Owner';
const OWNER_ADDRESS = 'Q-owner';

const mockedPublish = vi.mocked(publishResource);
const mockedBatchPublish = vi.mocked(publishMultipleResources);
const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedDelete = vi.mocked(deleteQdnResource);

function batchPublishedResponse(
  resources: readonly PublishMultipleResource[],
): MultiplePublishResult {
  return {
    accepted: true,
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    published: resources.map((resource) => ({
      result: {},
      resource: {
        identifier: resource.identifier ?? null,
        name: resource.name,
        service: resource.service,
      },
      transactionSignature: 'signature',
    })),
    failures: [],
  };
}

async function createThreeEventRecurrence() {
  const recurrence = await createScheduleRecurrenceAction(
    {
      ownerAddress: OWNER_ADDRESS,
      title: 'Daily Show',
      source: {
        type: 'playlist',
        playlistId: 'playlist-1',
        playlistVersionId: 'version-1',
      },
      timezone: 'Europe/Helsinki',
      frequency: 'daily',
      localStartTime: '20:00',
      durationMs: 30 * 60_000,
      activeFromLocalDate: '2026-01-15',
      activeUntilLocalDate: '2026-01-17',
    },
    OWNER_NAME,
    Date.parse('2026-01-15T12:00:00.000Z'),
  );

  const futureEventIds = getScheduleEvents()
    .filter((event) => event.recurrenceId === recurrence.recurrenceId)
    .map((event) => event.eventId);

  expect(futureEventIds).toHaveLength(3);

  return { recurrence, futureEventIds };
}

function recurrenceResource(recurrenceId: string) {
  return {
    service: 'JSON',
    name: OWNER_NAME,
    identifier: getScheduleRecurrenceQdnIdentifier(recurrenceId),
  };
}

function eventResource(eventId: string) {
  return {
    service: 'JSON',
    name: OWNER_NAME,
    identifier: getScheduleEventQdnIdentifier(eventId),
  };
}

function eventPayload(eventId: string, recurrenceId: string) {
  return {
    schemaVersion: 1,
    eventId,
    startUtc: '2026-01-16T18:00:00.000Z',
    endUtc: '2026-01-16T18:30:00.000Z',
    source: {
      type: 'playlist' as const,
      playlistId: 'playlist-1',
      playlistVersionId: 'version-1',
    },
    recurrenceId,
    recurrenceInstanceKey: `${recurrenceId}-instance`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('recurrence deletion integrity', () => {
  beforeEach(() => {
    resetScheduleStore();
    mockedPublish.mockReset();
    mockedBatchPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedDelete.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
    mockedBatchPublish.mockImplementation(async (resources) => batchPublishedResponse(resources));
    mockedDelete.mockResolvedValue({ accepted: true });
  });

  it.each([0, 1, 2])(
    'keeps the recurrence parent recoverable when child deletion %i fails',
    async (failingIndex) => {
      const { recurrence, futureEventIds } = await createThreeEventRecurrence();
      const failingEventId = futureEventIds[failingIndex];

      mockedDelete.mockReset();
      mockedDelete.mockImplementation(async (ref) => {
        if (ref.identifier === getScheduleEventQdnIdentifier(failingEventId)) {
          throw new Error('delete canceled');
        }

        return { accepted: true };
      });

      let caught: ScheduleRecurrenceDeletePartialError | null = null;
      try {
        await deleteScheduleRecurrenceAction(
          recurrence.recurrenceId,
          OWNER_NAME,
          Date.parse('2026-01-15T12:00:00.000Z'),
        );
      } catch (error) {
        caught = error as ScheduleRecurrenceDeletePartialError;
      }

      expect(caught).toBeInstanceOf(ScheduleRecurrenceDeletePartialError);
      expect(caught?.result.status).toBe('partial');
      expect(caught?.result.remainingEventIds).toEqual([failingEventId]);
      expect(caught?.result.deletedEventIds).toHaveLength(2);

      expect(getScheduleRecurrences()).toHaveLength(1);
      expect(getScheduleEvents().map((event) => event.eventId)).toEqual([failingEventId]);

      const deletedIdentifiers = mockedDelete.mock.calls.map(([ref]) => ref.identifier);
      expect(deletedIdentifiers).not.toContain(
        getScheduleRecurrenceQdnIdentifier(recurrence.recurrenceId),
      );
    },
  );

  it('treats a rejected child delete as partial failure and never deletes the parent', async () => {
    const { recurrence, futureEventIds } = await createThreeEventRecurrence();
    const failingEventId = futureEventIds[1];

    mockedDelete.mockReset();
    mockedDelete.mockImplementation(async (ref) => {
      if (ref.identifier === getScheduleEventQdnIdentifier(failingEventId)) {
        return { accepted: false };
      }

      return { accepted: true };
    });

    await expect(
      deleteScheduleRecurrenceAction(
        recurrence.recurrenceId,
        OWNER_NAME,
        Date.parse('2026-01-15T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ScheduleRecurrenceDeletePartialError);

    expect(getScheduleRecurrences()).toHaveLength(1);
    expect(getScheduleEvents().map((event) => event.eventId)).toEqual([failingEventId]);
  });

  it('reconstructs the surviving children after reload and completes cleanup idempotently', async () => {
    const { recurrence, futureEventIds } = await createThreeEventRecurrence();
    const failingEventId = futureEventIds[1];

    mockedDelete.mockReset();
    mockedDelete.mockImplementation(async (ref) => {
      if (ref.identifier === getScheduleEventQdnIdentifier(failingEventId)) {
        throw new Error('delete canceled');
      }

      return { accepted: true };
    });

    await expect(
      deleteScheduleRecurrenceAction(
        recurrence.recurrenceId,
        OWNER_NAME,
        Date.parse('2026-01-15T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ScheduleRecurrenceDeletePartialError);

    const recurrenceRecord = getScheduleRecurrences()[0];
    resetScheduleStore();

    mockedSearch.mockResolvedValue([
      recurrenceResource(recurrence.recurrenceId),
      eventResource(failingEventId),
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === getScheduleRecurrenceQdnIdentifier(recurrence.recurrenceId)) {
        return recurrenceRecord;
      }

      return eventPayload(failingEventId, recurrence.recurrenceId);
    });

    await loadScheduleStore(OWNER_NAME, OWNER_ADDRESS);

    expect(getScheduleRecurrences()).toHaveLength(1);
    expect(getScheduleEvents().map((event) => event.eventId)).toEqual([failingEventId]);

    mockedDelete.mockReset();
    mockedDelete.mockResolvedValue({ accepted: true });

    const result = await deleteScheduleRecurrenceAction(
      recurrence.recurrenceId,
      OWNER_NAME,
      Date.parse('2026-01-15T12:00:00.000Z'),
    );

    expect(result.status).toBe('deleted');
    expect(getScheduleRecurrences()).toHaveLength(0);
    expect(getScheduleEvents()).toHaveLength(0);

    const retryIdentifiers = mockedDelete.mock.calls.map(([ref]) => ref.identifier);
    expect(retryIdentifiers).toContain(getScheduleEventQdnIdentifier(failingEventId));
    expect(retryIdentifiers).not.toContain(getScheduleEventQdnIdentifier(futureEventIds[0]));
    expect(retryIdentifiers).not.toContain(getScheduleEventQdnIdentifier(futureEventIds[2]));
  });
});

describe('Request Show single-event materialization recovery', () => {
  beforeEach(() => {
    resetScheduleStore();
    mockedPublish.mockReset();
    mockedBatchPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedDelete.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
  });

  it('does not attempt a destructive rollback delete when occurrence publication fails', async () => {
    await expect(
      createDynamicScheduleEventAction(
        {
          title: 'Request Show',
          startUtc: '2026-01-15T18:00:00.000Z',
          endUtc: '2026-01-15T18:30:00.000Z',
          source: {
            type: 'dynamic-program',
            programDefinitionId: 'request-show-definition',
          },
        },
        OWNER_NAME,
        async () => {
          throw new Error('occurrence publish failed');
        },
      ),
    ).rejects.toBeInstanceOf(ScheduleEventMaterializationError);

    expect(mockedDelete).not.toHaveBeenCalled();
    expect(getScheduleEvents()).toHaveLength(1);
    expect(getScheduleEvents()[0].source.type).toBe('dynamic-program');
  });
});
