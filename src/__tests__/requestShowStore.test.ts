/* ============================================================
 * NodeFM Station — Request Show Store QDN Tests
 *
 * Covers occurrence discovery, canonical reuse, identifier
 * uniqueness, and remote-failure safety.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  fetchQdnResourceData: vi.fn(),
  publishMultipleResources: vi.fn(),
  publishResource: vi.fn(),
  searchQdnResources: vi.fn(),
}));

import {
  fetchQdnResourceData,
  publishMultipleResources,
  publishResource,
  searchQdnResources,
} from '../qortium/qdn';
import type {
  DynamicProgramDefinition,
  DynamicProgramOccurrence,
  ScheduleEvent,
  Track,
} from '../types/domain';
import { generateRequestShowOccurrence } from '../features/dynamic-programs/request-show/requestShowService';
import { getRequestShowOccurrenceQdnIdentifier } from '../features/dynamic-programs/request-show/requestShowService';
import {
  getRequestShowOccurrences,
  loadRequestShowOccurrencesForPublisher,
  materializeRequestShowOccurrenceBatchAction,
  materializeRequestShowOccurrenceAction,
  publishRequestShowOccurrenceAction,
  resetRequestShowStore,
} from '../features/dynamic-programs/request-show/requestShowStore';

const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedPublish = vi.mocked(publishResource);
const mockedBatchPublish = vi.mocked(publishMultipleResources);
const mockedSearch = vi.mocked(searchQdnResources);

const OWNER_NAME = 'Owner';

function track(trackId: string, durationMs: number): Track {
  return {
    schemaVersion: 1,
    trackId,
    ownerAddress: 'owner',
    title: trackId,
    audio: { service: 'AUDIO', name: OWNER_NAME, identifier: `audio-${trackId}` },
    durationMs,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function definition(): DynamicProgramDefinition {
  return {
    schemaVersion: 1,
    programDefinitionId: 'request-show-1',
    type: 'request-show',
    title: 'Request Show',
    targetDurationMs: 30 * 60_000,
    ranking: { strategy: 'most-liked' },
    fallback: {
      enabled: true,
      source: 'station-library',
      strategy: 'deterministic-random',
    },
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function event(): ScheduleEvent {
  return {
    schemaVersion: 1,
    eventId: 'event-1',
    title: 'Request Show',
    startUtc: '2026-01-02T18:00:00.000Z',
    endUtc: '2026-01-02T18:30:00.000Z',
    source: { type: 'dynamic-program', programDefinitionId: 'request-show-1' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function occurrence(): DynamicProgramOccurrence {
  const result = generateRequestShowOccurrence(
    event(),
    definition(),
    [track('L1', 60_000), track('F1', 120_000)],
    [{ trackId: 'L1', likeCount: 1, likerAddresses: ['Q-alice'] }],
    '2026-01-01T00:00:00.000Z',
  );

  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.occurrence;
}

describe('Request Show occurrence store', () => {
  beforeEach(() => {
    resetRequestShowStore();
    mockedFetch.mockReset();
    mockedPublish.mockReset();
    mockedBatchPublish.mockReset();
    mockedSearch.mockReset();
    mockedPublish.mockResolvedValue({ accepted: true } as never);
  });

  it('discovers occurrences with mode=ALL and reconstructs the exact lineup', async () => {
    const occurrencePayload = occurrence();
    const resource = {
      service: 'JSON',
      name: OWNER_NAME,
      identifier: getRequestShowOccurrenceQdnIdentifier(occurrencePayload.scheduleEventId),
    };

    mockedSearch.mockResolvedValue([resource]);
    mockedFetch.mockResolvedValue(occurrencePayload);

    const loaded = await loadRequestShowOccurrencesForPublisher(OWNER_NAME);

    expect(mockedSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'ALL',
        prefix: true,
      }),
    );
    expect(loaded).toEqual([occurrencePayload]);
  });

  it('publishes each occurrence under a unique deterministic identifier', async () => {
    const payload = occurrence();

    await publishRequestShowOccurrenceAction(payload, OWNER_NAME);

    expect(mockedPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'JSON',
        name: OWNER_NAME,
        identifier: getRequestShowOccurrenceQdnIdentifier(payload.scheduleEventId),
      }),
    );
  });

  it('reuses an existing canonical occurrence instead of regenerating', async () => {
    const payload = occurrence();
    await publishRequestShowOccurrenceAction(payload, OWNER_NAME);

    const reused = await materializeRequestShowOccurrenceAction(
      event(),
      definition(),
      [track('other', 60_000)],
      [],
      '2026-01-01T00:00:01.000Z',
      OWNER_NAME,
    );

    expect(reused).toEqual(payload);
    expect(mockedPublish).toHaveBeenCalledTimes(1);
  });

  it('regenerates an edited event when reuse is explicitly disabled', async () => {
    const payload = occurrence();
    await publishRequestShowOccurrenceAction(payload, OWNER_NAME);

    const regenerated = await materializeRequestShowOccurrenceAction(
      event(),
      definition(),
      [track('other', 60_000)],
      [],
      '2026-01-01T00:00:01.000Z',
      OWNER_NAME,
      { reuseExisting: false },
    );

    expect(regenerated.occurrenceId).toBe(payload.occurrenceId);
    expect(regenerated.tracks).not.toEqual(payload.tracks);
    expect(mockedPublish).toHaveBeenCalledTimes(2);
  });

  it('does not turn a failed occurrence publish into local state', async () => {
    mockedPublish.mockRejectedValue(new Error('Publish failed'));

    await expect(publishRequestShowOccurrenceAction(occurrence(), OWNER_NAME)).rejects.toThrow(
      /publish request show occurrence/i,
    );
    expect(getRequestShowOccurrences()).toEqual([]);
  });

  it('materializes recurring Request Show lineups in one coordinated batch', async () => {
    mockedBatchPublish.mockImplementation(async (resources) => {
      const items = resources;
      return {
        accepted: true,
        action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
        published: items.map((resource) => ({
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
    });

    const events = [
      {
        ...event(),
        eventId: 'event-1',
        startUtc: '2026-01-02T18:00:00.000Z',
        endUtc: '2026-01-02T18:30:00.000Z',
      },
      {
        ...event(),
        eventId: 'event-2',
        startUtc: '2026-01-03T18:00:00.000Z',
        endUtc: '2026-01-03T18:30:00.000Z',
      },
    ];

    const result = await materializeRequestShowOccurrenceBatchAction(
      events,
      definition(),
      [track('L1', 60_000), track('F1', 120_000)],
      [{ trackId: 'L1', likeCount: 1, likerAddresses: ['Q-alice'] }],
      '2026-01-01T00:00:00.000Z',
      OWNER_NAME,
    );

    expect(mockedBatchPublish).toHaveBeenCalledTimes(1);
    const resources = mockedBatchPublish.mock.calls[0]?.[0] ?? [];
    expect(resources).toHaveLength(2);
    expect(result.status).toBe('all-published');
    expect(getRequestShowOccurrences()).toHaveLength(2);
  });

  it('reports partial Request Show occurrence publication failures', async () => {
    mockedBatchPublish.mockResolvedValue({
      accepted: true,
      action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
      published: [
        {
          result: {},
          resource: {
            identifier: getRequestShowOccurrenceQdnIdentifier('event-1'),
            name: OWNER_NAME,
            service: 'JSON',
          },
          transactionSignature: 'signature',
        },
      ],
      failures: [
        {
          error: 'publish failed',
          resource: {
            identifier: getRequestShowOccurrenceQdnIdentifier('event-2'),
            name: OWNER_NAME,
            service: 'JSON',
          },
        },
      ],
    } as never);

    const events = [
      {
        ...event(),
        eventId: 'event-1',
        startUtc: '2026-01-02T18:00:00.000Z',
        endUtc: '2026-01-02T18:30:00.000Z',
      },
      {
        ...event(),
        eventId: 'event-2',
        startUtc: '2026-01-03T18:00:00.000Z',
        endUtc: '2026-01-03T18:30:00.000Z',
      },
    ];

    const result = await materializeRequestShowOccurrenceBatchAction(
      events,
      definition(),
      [track('L1', 60_000), track('F1', 120_000)],
      [{ trackId: 'L1', likeCount: 1, likerAddresses: ['Q-alice'] }],
      '2026-01-01T00:00:00.000Z',
      OWNER_NAME,
    );

    expect(result.status).toBe('partial');
    expect(result.publishedOccurrences).toHaveLength(1);
    expect(result.failedScheduleEventIds).toEqual(['event-2']);
    expect(getRequestShowOccurrences()).toHaveLength(1);
  });
});
