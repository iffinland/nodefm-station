/* ============================================================
 * NodeFM Station — Schedule Store QDN/Persistence Tests
 *
 * Exercises production schedule store publication, discovery,
 * reconstruction, conflict rejection, remote-failure safety, and
 * account isolation.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  publishResource: vi.fn(),
  searchQdnResources: vi.fn(),
  fetchQdnResourceData: vi.fn(),
  deleteQdnResource: vi.fn(),
}));

import {
  deleteQdnResource,
  fetchQdnResourceData,
  publishResource,
  searchQdnResources,
} from '../qortium/qdn';
import {
  createScheduleEventAction,
  createScheduleRecurrenceAction,
  deleteScheduleEventAction,
  getScheduleEvents,
  getScheduleLoadAction,
  getScheduleLoaded,
  getScheduleRecurrences,
  loadScheduleStore,
  resetScheduleStore,
  updateScheduleEventAction,
  updateScheduleRecurrenceAction,
} from '../features/scheduling/services/scheduleStore';
import {
  getScheduleEventQdnIdentifier,
  getScheduleRecurrenceQdnIdentifier,
} from '../features/scheduling/services/scheduleService';
import type { ScheduleEvent } from '../types/domain';

const OWNER_NAME = 'Owner';
const OWNER_ADDRESS = 'Q-owner';

const mockedPublish = vi.mocked(publishResource);
const mockedSearch = vi.mocked(searchQdnResources);
const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedDelete = vi.mocked(deleteQdnResource);

function eventPayload(eventId: string, startUtc: string, endUtc: string): ScheduleEvent {
  return {
    schemaVersion: 1,
    eventId,
    title: `Program ${eventId}`,
    startUtc,
    endUtc,
    source: {
      type: 'playlist',
      playlistId: 'playlist-1',
      playlistVersionId: 'version-1',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function eventResource(eventId: string) {
  return {
    service: 'JSON',
    name: OWNER_NAME,
    identifier: getScheduleEventQdnIdentifier(eventId),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('schedule publication identity', () => {
  beforeEach(() => {
    resetScheduleStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedDelete.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
  });

  it('publishes N events with N distinct schedule identifiers', async () => {
    for (let index = 0; index < 3; index += 1) {
      await createScheduleEventAction(
        {
          title: `Program ${index}`,
          startUtc: `2026-01-0${index + 1}T18:00:00.000Z`,
          endUtc: `2026-01-0${index + 1}T20:00:00.000Z`,
          source: {
            type: 'playlist',
            playlistId: 'playlist-1',
            playlistVersionId: 'version-1',
          },
        },
        OWNER_NAME,
      );
    }

    const identifiers = mockedPublish.mock.calls.map(([call]) => {
      return (call as unknown as { identifier?: string }).identifier;
    });

    expect(new Set(identifiers).size).toBe(3);
    expect(identifiers).toEqual(
      getScheduleEvents().map((event) => getScheduleEventQdnIdentifier(event.eventId)),
    );
  });

  it('does not turn a failed publish into local schedule state', async () => {
    mockedPublish.mockRejectedValue(new Error('Publish failed'));

    await expect(
      createScheduleEventAction(
        {
          startUtc: '2026-01-15T18:00:00.000Z',
          endUtc: '2026-01-15T20:00:00.000Z',
          source: {
            type: 'playlist',
            playlistId: 'playlist-1',
            playlistVersionId: 'version-1',
          },
        },
        OWNER_NAME,
      ),
    ).rejects.toThrow(/publish schedule event/i);

    expect(getScheduleEvents()).toEqual([]);
  });

  it('rejects conflicts before publishing', async () => {
    const first = await createScheduleEventAction(
      {
        startUtc: '2026-01-15T18:00:00.000Z',
        endUtc: '2026-01-15T20:00:00.000Z',
        source: {
          type: 'playlist',
          playlistId: 'playlist-1',
          playlistVersionId: 'version-1',
        },
      },
      OWNER_NAME,
    );

    mockedPublish.mockClear();
    await expect(
      createScheduleEventAction(
        {
          startUtc: '2026-01-15T19:00:00.000Z',
          endUtc: '2026-01-15T21:00:00.000Z',
          source: {
            type: 'playlist',
            playlistId: 'playlist-1',
            playlistVersionId: 'version-1',
          },
        },
        OWNER_NAME,
      ),
    ).rejects.toThrow(/conflict/i);

    expect(mockedPublish).not.toHaveBeenCalled();
    expect(getScheduleEvents().map((event) => event.eventId)).toEqual([first.eventId]);
  });
});

describe('schedule reconstruction', () => {
  beforeEach(() => {
    resetScheduleStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedDelete.mockReset();
  });

  it('uses mode=ALL and reconstructs every discovered distinct event', async () => {
    const first = eventPayload('e-1', '2026-01-15T18:00:00.000Z', '2026-01-15T19:00:00.000Z');
    const second = eventPayload('e-2', '2026-01-15T19:00:00.000Z', '2026-01-15T20:00:00.000Z');

    mockedSearch.mockResolvedValue([
      eventResource('e-1'),
      eventResource('e-1'),
      eventResource('e-2'),
    ]);
    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === getScheduleEventQdnIdentifier('e-1')) return first;
      if (ref.identifier === getScheduleEventQdnIdentifier('e-2')) return second;
      throw new Error(`Unexpected fetch: ${ref.identifier}`);
    });

    await loadScheduleStore(OWNER_NAME, OWNER_ADDRESS);

    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'ALL',
        prefix: true,
      }),
    );
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(getScheduleEvents().map((event) => event.eventId)).toEqual(['e-1', 'e-2']);
  });

  it('rejects malformed schedule resources instead of silently omitting them', async () => {
    mockedSearch.mockResolvedValue([eventResource('e-1')]);
    mockedFetch.mockResolvedValue({
      eventId: 'e-1',
      startUtc: 'not-a-date',
      endUtc: '2026-01-15T19:00:00.000Z',
      source: {
        type: 'playlist',
        playlistId: 'playlist-1',
        playlistVersionId: 'version-1',
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await loadScheduleStore(OWNER_NAME, OWNER_ADDRESS);
    expect(getScheduleLoaded()).toBe(false);
    expect(getScheduleEvents()).toEqual([]);
  });

  it('skips tombstoned resources as deleted records', async () => {
    mockedSearch.mockResolvedValue([eventResource('e-1')]);
    mockedFetch.mockRejectedValue(
      new Error('QDN resource does not exist: JSON/Owner/nodefm-schedule-e-1'),
    );

    await loadScheduleStore(OWNER_NAME, OWNER_ADDRESS);
    expect(getScheduleLoaded()).toBe(true);
    expect(getScheduleEvents()).toEqual([]);
  });
});

describe('schedule edit/delete safety', () => {
  beforeEach(() => {
    resetScheduleStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedDelete.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
  });

  it('updates only after remote publish succeeds', async () => {
    const event = await createScheduleEventAction(
      {
        title: 'Before',
        startUtc: '2026-01-15T18:00:00.000Z',
        endUtc: '2026-01-15T20:00:00.000Z',
        source: {
          type: 'playlist',
          playlistId: 'playlist-1',
          playlistVersionId: 'version-1',
        },
      },
      OWNER_NAME,
    );

    mockedPublish.mockRejectedValue(new Error('Update failed'));

    await expect(
      updateScheduleEventAction(event.eventId, { title: 'After' }, OWNER_NAME),
    ).rejects.toThrow(/update schedule event/i);

    expect(getScheduleEvents()[0].title).toBe('Before');
  });

  it('deletes only after an accepted QDN delete', async () => {
    const event = await createScheduleEventAction(
      {
        startUtc: '2026-01-15T18:00:00.000Z',
        endUtc: '2026-01-15T20:00:00.000Z',
        source: {
          type: 'playlist',
          playlistId: 'playlist-1',
          playlistVersionId: 'version-1',
        },
      },
      OWNER_NAME,
    );

    mockedDelete.mockResolvedValue({ accepted: false });

    await expect(deleteScheduleEventAction(event.eventId, OWNER_NAME)).rejects.toThrow(/delete/i);
    expect(getScheduleEvents()).toHaveLength(1);
  });
});

describe('schedule account isolation', () => {
  beforeEach(() => {
    resetScheduleStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedDelete.mockReset();
  });

  it('does not expose account A schedules to account B', async () => {
    mockedSearch.mockImplementation(async (params) => {
      if (params.name === 'A') return [eventResource('a-1')];
      if (params.name === 'B') return [eventResource('b-1')];
      return [];
    });

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.name === 'A' && ref.identifier === getScheduleEventQdnIdentifier('a-1')) {
        return eventPayload('a-1', '2026-01-15T18:00:00.000Z', '2026-01-15T19:00:00.000Z');
      }

      if (ref.name === 'B' && ref.identifier === getScheduleEventQdnIdentifier('b-1')) {
        return eventPayload('b-1', '2026-01-15T20:00:00.000Z', '2026-01-15T21:00:00.000Z');
      }

      throw new Error(`Unexpected fetch: ${ref.name}/${ref.identifier}`);
    });

    await loadScheduleStore('A', 'addrA');
    expect(getScheduleEvents().map((event) => event.eventId)).toEqual(['a-1']);

    resetScheduleStore();
    await loadScheduleStore('B', 'addrB');
    expect(getScheduleEvents().map((event) => event.eventId)).toEqual(['b-1']);
  });

  it('ignores a stale account A response after switching to B', async () => {
    const aFetch = deferred<unknown>();

    mockedSearch.mockImplementation(async (params) => {
      if (params.name === 'A') return [eventResource('a-1')];
      if (params.name === 'B') return [eventResource('b-1')];
      return [];
    });

    mockedFetch.mockImplementation((ref) => {
      if (ref.name === 'A' && ref.identifier === getScheduleEventQdnIdentifier('a-1')) {
        return aFetch.promise;
      }

      if (ref.name === 'B' && ref.identifier === getScheduleEventQdnIdentifier('b-1')) {
        return Promise.resolve(
          eventPayload('b-1', '2026-01-15T20:00:00.000Z', '2026-01-15T21:00:00.000Z'),
        );
      }

      return Promise.reject(new Error(`Unexpected fetch: ${ref.name}/${ref.identifier}`));
    });

    const aLoad = loadScheduleStore('A', 'addrA');
    resetScheduleStore();
    await loadScheduleStore('B', 'addrB');

    aFetch.resolve(eventPayload('a-1', '2026-01-15T18:00:00.000Z', '2026-01-15T19:00:00.000Z'));
    await aLoad;

    expect(getScheduleEvents().map((event) => event.eventId)).toEqual(['b-1']);
  });

  it('reuses same-account loaded state and clears without identity', () => {
    expect(getScheduleLoadAction(null, null)).toBe('clear');
    expect(getScheduleLoadAction('A', 'addrA')).toBe('load');
  });
});

describe('recurrence resource namespace', () => {
  it('keeps event and recurrence identifiers separate', () => {
    expect(getScheduleEventQdnIdentifier('abc')).toBe('nodefm-schedule-abc');
    expect(getScheduleRecurrenceQdnIdentifier('abc')).toBe('nodefm-schedule-recurrence-abc');
  });

  it('getScheduleRecurrences is empty after reset', () => {
    resetScheduleStore();
    expect(getScheduleRecurrences()).toEqual([]);
  });
});

describe('recurrence store publication/reconciliation', () => {
  beforeEach(() => {
    resetScheduleStore();
    mockedPublish.mockReset();
    mockedSearch.mockReset();
    mockedFetch.mockReset();
    mockedDelete.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
  });

  it('publishes the recurrence intent and its concrete generated event', async () => {
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
        activeUntilLocalDate: '2026-01-15',
      },
      OWNER_NAME,
      Date.parse('2026-01-15T12:00:00.000Z'),
    );

    expect(getScheduleRecurrences()).toHaveLength(1);
    expect(getScheduleEvents()).toHaveLength(1);

    const publishedIdentifiers = mockedPublish.mock.calls.map(
      ([call]) => (call as unknown as { identifier?: string }).identifier,
    );

    expect(publishedIdentifiers).toContain(
      getScheduleRecurrenceQdnIdentifier(recurrence.recurrenceId),
    );
    expect(publishedIdentifiers.some((id) => id?.startsWith('nodefm-schedule-'))).toBe(true);
  });

  it('does not duplicate unchanged concrete events on recompilation', async () => {
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
        activeUntilLocalDate: '2026-01-15',
      },
      OWNER_NAME,
      Date.parse('2026-01-15T12:00:00.000Z'),
    );

    const initialEventCount = getScheduleEvents().length;
    mockedPublish.mockClear();

    await updateScheduleRecurrenceAction(
      recurrence.recurrenceId,
      {
        title: 'Daily Show',
      },
      OWNER_NAME,
      Date.parse('2026-01-15T12:00:00.000Z'),
    );

    expect(getScheduleEvents()).toHaveLength(initialEventCount);
    const eventPublishes = mockedPublish.mock.calls.filter(
      ([call]) =>
        (call as unknown as { identifier?: string }).identifier?.startsWith('nodefm-schedule-') &&
        !(call as unknown as { identifier?: string }).identifier?.startsWith(
          'nodefm-schedule-recurrence-',
        ),
    );
    expect(eventPublishes).toHaveLength(0);
  });

  it('does not update local recurrence state when remote publication fails', async () => {
    mockedPublish.mockRejectedValue(new Error('Publish failed'));

    await expect(
      createScheduleRecurrenceAction(
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
          activeUntilLocalDate: '2026-01-15',
        },
        OWNER_NAME,
        Date.parse('2026-01-15T12:00:00.000Z'),
      ),
    ).rejects.toThrow(/publish failed/i);

    expect(getScheduleRecurrences()).toEqual([]);
    expect(getScheduleEvents()).toEqual([]);
  });
});
