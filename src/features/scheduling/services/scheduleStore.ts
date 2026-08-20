/* ============================================================
 * NodeFM Station — Schedule Store
 *
 * Account-scoped QDN persistence for concrete ScheduleEvent
 * resources and admin ScheduleRecurrence resources.
 *
 * Concrete events are the canonical runtime schedule. Recurrence
 * records are authoring intent that is compiled into concrete
 * events before publication.
 * ============================================================ */

import type { ScheduleEvent, ScheduleRecurrence } from '../../../types/domain';
import {
  deleteQdnResource,
  fetchQdnResourceData,
  publishMultipleResources,
  publishResource,
  searchQdnResources,
} from '../../../qortium/qdn';
import {
  SCHEDULE_EVENT_IDENTIFIER_PREFIX,
  SCHEDULE_QDN_SERVICE,
  SCHEDULE_RECURRENCE_IDENTIFIER_PREFIX,
  assertValidScheduleEvent,
  createScheduleEvent,
  createScheduleRecurrence,
  deserializeScheduleEventFromQdn,
  deserializeScheduleRecurrenceFromQdn,
  editScheduleEvent,
  editScheduleRecurrence,
  findScheduleConflicts,
  getScheduleEventQdnIdentifier,
  getScheduleRecurrenceQdnIdentifier,
  serializeScheduleEventForQdn,
  serializeScheduleRecurrenceForQdn,
  validateScheduleRecurrence,
  validateScheduleSet,
  type CreateScheduleEventInput,
  type CreateScheduleRecurrenceInput,
  type EditScheduleEventInput,
  type EditScheduleRecurrenceInput,
  type ScheduleConflict,
} from './scheduleService';
import { compileScheduleRecurrence } from './recurrenceCompiler';
import { parseUtcTimestampMs } from './scheduleService';

type ScheduleListener = () => void;

let scheduleEvents: ScheduleEvent[] = [];
let scheduleRecurrences: ScheduleRecurrence[] = [];
let scheduleLoaded = false;
let scheduleLoading = false;
let scheduleError: string | null = null;
let scheduleEpoch = 0;
let scheduleActiveScope: string | null = null;

const listeners = new Set<ScheduleListener>();

function notify() {
  listeners.forEach((listener) => listener());
}

function scopeKey(ownerName: string, ownerAddress: string): string {
  return `${ownerAddress}\u0000${ownerName}`;
}

function isMissingResourceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /does not exist|not found|not published|unavailable|empty payload/i.test(error.message)
  );
}

async function persistScheduleEvent(event: ScheduleEvent, ownerName: string): Promise<void> {
  assertValidScheduleEvent(event);
  const json = serializeScheduleEventForQdn(event);
  const data64 = btoa(unescape(encodeURIComponent(json)));

  await publishResource({
    service: SCHEDULE_QDN_SERVICE,
    name: ownerName,
    identifier: getScheduleEventQdnIdentifier(event.eventId),
    data64,
    title: event.title,
  });
}

async function persistScheduleRecurrence(
  recurrence: ScheduleRecurrence,
  ownerName: string,
): Promise<void> {
  const validation = validateScheduleRecurrence(recurrence);
  if (!validation.ok) {
    throw new Error(validation.errors[0]);
  }

  const json = serializeScheduleRecurrenceForQdn(recurrence);
  const data64 = btoa(unescape(encodeURIComponent(json)));

  await publishResource({
    service: SCHEDULE_QDN_SERVICE,
    name: ownerName,
    identifier: getScheduleRecurrenceQdnIdentifier(recurrence.recurrenceId),
    data64,
    title: recurrence.title,
  });
}

async function persistScheduleDelete(identifier: string, ownerName: string): Promise<void> {
  const result = (await deleteQdnResource({
    service: SCHEDULE_QDN_SERVICE,
    name: ownerName,
    identifier,
  })) as { accepted?: boolean };

  if (result?.accepted !== true) {
    throw new Error('QDN delete was not accepted.');
  }
}

// ── Coordinated multi-resource event publication ─────────────────

export type ScheduleBatchFailure = {
  eventId: string;
  identifier: string;
  error: string;
};

export type ScheduleEventBatchResult = {
  status: 'all-published' | 'partial' | 'failed';
  publishedEvents: ScheduleEvent[];
  failedEvents: ScheduleEvent[];
  failures: ScheduleBatchFailure[];
};

export type ScheduleRecurrenceApplyResult = {
  recurrence: ScheduleRecurrence;
  created: number;
  updated: number;
  deleted: number;
  deleteFailures: Array<{
    eventId: string;
    identifier: string;
    error: string;
  }>;
  batch: ScheduleEventBatchResult;
  reconciledEvents: ScheduleEvent[];
};

export class ScheduleBatchPartialError extends Error {
  readonly result: ScheduleRecurrenceApplyResult;

  constructor(result: ScheduleRecurrenceApplyResult) {
    const failedCount = result.batch.failedEvents.length;
    const deleteFailureCount = result.deleteFailures.length;
    super(
      failedCount > 0
        ? result.batch.status === 'failed'
          ? `Recurring program event publication failed: ${failedCount} event(s) failed. Retry to publish the missing events.`
          : `Recurring program was partially published: ${failedCount} event(s) failed. Review and retry only the missing events.`
        : deleteFailureCount > 0
          ? `Recurring program event publication succeeded, but ${deleteFailureCount} obsolete event deletion(s) failed. Retry to complete reconciliation.`
          : 'Recurring program event publication failed.',
    );
    this.name = 'ScheduleBatchPartialError';
    this.result = result;
  }
}

export type ScheduleDeleteFailure = {
  eventId: string;
  identifier: string;
  error: string;
};

export type ScheduleRecurrenceDeleteResult = {
  recurrenceId: string;
  status: 'deleted' | 'partial';
  deletedEventIds: string[];
  remainingEventIds: string[];
  failures: ScheduleDeleteFailure[];
  recurrenceDeleteError?: string;
};

export class ScheduleRecurrenceDeletePartialError extends Error {
  readonly result: ScheduleRecurrenceDeleteResult;

  constructor(result: ScheduleRecurrenceDeleteResult) {
    const remaining = result.remainingEventIds;
    const failed = result.failures.length;
    const detail = result.recurrenceDeleteError
      ? `Recurring program cleanup partially completed, but the recurrence intent could not be deleted${
          remaining.length > 0 ? `; remaining events: ${remaining.join(', ')}` : ''
        }.`
      : `Recurring program cleanup is incomplete: ${failed} event deletion(s) failed${
          remaining.length > 0 ? `; remaining events: ${remaining.join(', ')}` : ''
        }. Retry to continue cleanup.`;

    super(detail);
    this.name = 'ScheduleRecurrenceDeletePartialError';
    this.result = result;
  }
}

export class ScheduleEventMaterializationError extends Error {
  readonly event: ScheduleEvent;
  readonly cause: unknown;

  constructor(event: ScheduleEvent, cause: unknown) {
    super(
      `Schedule event was published, but Request Show occurrence publication failed: ${
        cause instanceof Error ? cause.message : 'Unknown error'
      }. The event remains visible as ${event.eventId} and can be retried without creating a duplicate.`,
    );
    this.name = 'ScheduleEventMaterializationError';
    this.event = event;
    this.cause = cause;
  }
}

function scheduleEventPublishResource(event: ScheduleEvent, ownerName: string) {
  assertValidScheduleEvent(event);
  const data64 = btoa(unescape(encodeURIComponent(serializeScheduleEventForQdn(event))));

  return {
    service: SCHEDULE_QDN_SERVICE,
    name: ownerName,
    identifier: getScheduleEventQdnIdentifier(event.eventId),
    data64,
    title: event.title,
  };
}

async function publishScheduleEventBatch(
  events: readonly ScheduleEvent[],
  ownerName: string,
): Promise<ScheduleEventBatchResult> {
  if (events.length === 0) {
    return { status: 'all-published', publishedEvents: [], failedEvents: [], failures: [] };
  }

  const resources = events.map((event) => scheduleEventPublishResource(event, ownerName));
  let response: Awaited<ReturnType<typeof publishMultipleResources>>;
  try {
    response = await publishMultipleResources(resources);
  } catch (error) {
    return {
      status: 'failed',
      publishedEvents: [],
      failedEvents: [...events],
      failures: events.map((event) => ({
        eventId: event.eventId,
        identifier: getScheduleEventQdnIdentifier(event.eventId),
        error: error instanceof Error ? error.message : 'QDN batch publication failed.',
      })),
    };
  }

  if (!response.accepted) {
    return {
      status: 'failed',
      publishedEvents: [],
      failedEvents: [...events],
      failures: events.map((event) => ({
        eventId: event.eventId,
        identifier: getScheduleEventQdnIdentifier(event.eventId),
        error: 'QDN batch publication was not accepted.',
      })),
    };
  }

  const publishedByIdentifier = new Set(
    response.published.map((entry) => entry.resource.identifier ?? ''),
  );
  const failureByIdentifier = new Map(
    response.failures.map((entry) => [entry.resource.identifier ?? '', entry.error]),
  );
  const publishedEvents: ScheduleEvent[] = [];
  const failedEvents: ScheduleEvent[] = [];
  const failures: ScheduleBatchFailure[] = [];

  for (const event of events) {
    const identifier = getScheduleEventQdnIdentifier(event.eventId);
    const published = publishedByIdentifier.has(identifier);
    const failure = failureByIdentifier.get(identifier);

    if (published && !failure) {
      publishedEvents.push(event);
    } else {
      failedEvents.push(event);
      failures.push({
        eventId: event.eventId,
        identifier,
        error: failure ?? 'QDN batch publication returned no result for this resource.',
      });
    }
  }

  if (publishedEvents.length === events.length) {
    return { status: 'all-published', publishedEvents, failedEvents, failures };
  }

  if (publishedEvents.length === 0) {
    return { status: 'failed', publishedEvents, failedEvents, failures };
  }

  return { status: 'partial', publishedEvents, failedEvents, failures };
}

// ── Subscriptions and getters ──────────────────────────────────────

export function subscribeToScheduleStore(listener: ScheduleListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getScheduleEvents(): ScheduleEvent[] {
  return [...scheduleEvents].sort((left, right) => {
    const startDelta =
      (parseUtcTimestampMs(left.startUtc) ?? 0) - (parseUtcTimestampMs(right.startUtc) ?? 0);
    if (startDelta !== 0) return startDelta;
    return (parseUtcTimestampMs(left.endUtc) ?? 0) - (parseUtcTimestampMs(right.endUtc) ?? 0);
  });
}

export function getScheduleRecurrences(): ScheduleRecurrence[] {
  return [...scheduleRecurrences].sort((left, right) => left.title.localeCompare(right.title));
}

export function getScheduleEventById(eventId: string): ScheduleEvent | undefined {
  return scheduleEvents.find((event) => event.eventId === eventId);
}

export function getScheduleRecurrenceById(recurrenceId: string): ScheduleRecurrence | undefined {
  return scheduleRecurrences.find((recurrence) => recurrence.recurrenceId === recurrenceId);
}

export function getScheduleLoaded(): boolean {
  return scheduleLoaded;
}

export function getScheduleLoading(): boolean {
  return scheduleLoading;
}

export function getScheduleError(): string | null {
  return scheduleError;
}

export function getScheduleActiveScope(): string | null {
  return scheduleActiveScope;
}

export function isScheduleCurrentScope(ownerName: string, ownerAddress: string): boolean {
  return scheduleActiveScope === scopeKey(ownerName, ownerAddress);
}

export type ScheduleLoadAction = 'clear' | 'reuse' | 'load';

export function getScheduleLoadAction(
  ownerName: string | null,
  ownerAddress: string | null,
): ScheduleLoadAction {
  if (!ownerName || !ownerAddress) {
    return 'clear';
  }

  if (isScheduleCurrentScope(ownerName, ownerAddress) && (scheduleLoaded || scheduleLoading)) {
    return 'reuse';
  }

  return 'load';
}

// ── Discovery / fetch helpers ──────────────────────────────────────

async function discoverScheduleIdentifiers(ownerName: string) {
  const results = await searchQdnResources({
    service: SCHEDULE_QDN_SERVICE,
    name: ownerName,
    query: SCHEDULE_EVENT_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 1000,
    includeMetadata: true,
  });

  const seen = new Set<string>();
  const identifiers: string[] = [];

  for (const result of results) {
    if (
      !result.identifier ||
      (!result.identifier.startsWith(SCHEDULE_EVENT_IDENTIFIER_PREFIX) &&
        !result.identifier.startsWith(SCHEDULE_RECURRENCE_IDENTIFIER_PREFIX))
    ) {
      continue;
    }

    if (seen.has(result.identifier)) {
      continue;
    }

    seen.add(result.identifier);
    identifiers.push(result.identifier);
  }

  return identifiers;
}

async function fetchScheduleRecord(ownerName: string, identifier: string): Promise<unknown> {
  try {
    return await fetchQdnResourceData({
      service: SCHEDULE_QDN_SERVICE,
      name: ownerName,
      identifier,
    });
  } catch (error) {
    if (isMissingResourceError(error)) {
      return { nodefmTombstone: true, identifier };
    }

    throw error;
  }
}

// ── Load / reset ───────────────────────────────────────────────────

export async function loadScheduleStore(ownerName: string, ownerAddress: string): Promise<void> {
  if (scheduleLoaded || scheduleLoading) {
    return;
  }

  const targetScope = scopeKey(ownerName, ownerAddress);
  const epoch = scheduleEpoch;

  scheduleActiveScope = targetScope;
  scheduleLoading = true;
  scheduleError = null;
  notify();

  try {
    const identifiers = await discoverScheduleIdentifiers(ownerName);
    const loadedEvents: ScheduleEvent[] = [];
    const loadedRecurrences: ScheduleRecurrence[] = [];

    for (const identifier of identifiers) {
      const payload = await fetchScheduleRecord(ownerName, identifier);

      if (
        payload &&
        typeof payload === 'object' &&
        (payload as { nodefmTombstone?: boolean }).nodefmTombstone === true
      ) {
        continue;
      }

      if (identifier.startsWith(SCHEDULE_RECURRENCE_IDENTIFIER_PREFIX)) {
        const recurrence = deserializeScheduleRecurrenceFromQdn(payload);
        if (!recurrence) {
          throw new Error(`Malformed schedule recurrence resource: ${identifier}`);
        }

        if (recurrence.ownerAddress === ownerAddress) {
          loadedRecurrences.push(recurrence);
        }
        continue;
      }

      const event = deserializeScheduleEventFromQdn(payload);
      if (!event) {
        throw new Error(`Malformed schedule event resource: ${identifier}`);
      }

      loadedEvents.push(event);
    }

    if (epoch !== scheduleEpoch || scheduleActiveScope !== targetScope) {
      return;
    }

    scheduleEvents = loadedEvents;
    scheduleRecurrences = loadedRecurrences;
    scheduleLoaded = true;
  } catch (error) {
    if (epoch !== scheduleEpoch || scheduleActiveScope !== targetScope) {
      return;
    }

    scheduleError = error instanceof Error ? error.message : 'Failed to load schedule.';
  } finally {
    if (epoch === scheduleEpoch) {
      scheduleLoading = false;
      notify();
    }
  }
}

export async function loadScheduleEventsForPublisher(
  publisherName: string,
): Promise<ScheduleEvent[]> {
  const results = await searchQdnResources({
    service: SCHEDULE_QDN_SERVICE,
    name: publisherName,
    query: SCHEDULE_EVENT_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 1000,
    includeMetadata: true,
  });

  const seen = new Set<string>();
  const events: ScheduleEvent[] = [];

  for (const result of results) {
    if (
      !result.identifier ||
      !result.identifier.startsWith(SCHEDULE_EVENT_IDENTIFIER_PREFIX) ||
      result.identifier.startsWith(SCHEDULE_RECURRENCE_IDENTIFIER_PREFIX)
    ) {
      continue;
    }

    if (seen.has(result.identifier)) {
      continue;
    }

    seen.add(result.identifier);
    const payload = await fetchQdnResourceData({
      service: SCHEDULE_QDN_SERVICE,
      name: publisherName,
      identifier: result.identifier,
    });
    const event = deserializeScheduleEventFromQdn(payload);

    if (!event) {
      throw new Error(`Malformed schedule event resource: ${result.identifier}`);
    }

    events.push(event);
  }

  return events;
}

export function resetScheduleStore(): void {
  scheduleEvents = [];
  scheduleRecurrences = [];
  scheduleLoaded = false;
  scheduleLoading = false;
  scheduleError = null;
  scheduleActiveScope = null;
  scheduleEpoch += 1;
  notify();
}

// ── Single event CRUD ──────────────────────────────────────────────

function assertNoConflicts(candidate: ScheduleEvent, ignoreEventId?: string): ScheduleConflict[] {
  const conflicts = findScheduleConflicts(candidate, scheduleEvents, { ignoreEventId });
  if (conflicts.length > 0) {
    return conflicts;
  }

  return [];
}

export class ScheduleConflictError extends Error {
  readonly conflicts: ScheduleConflict[];

  constructor(conflicts: ScheduleConflict[]) {
    super(
      `Schedule conflicts with ${conflicts.length} existing event(s): ${conflicts
        .map((conflict) => conflict.eventId)
        .join(', ')}.`,
    );
    this.name = 'ScheduleConflictError';
    this.conflicts = conflicts;
  }
}

export async function createScheduleEventAction(
  input: CreateScheduleEventInput,
  ownerName: string,
): Promise<ScheduleEvent> {
  const event = createScheduleEvent(input);
  const conflicts = assertNoConflicts(event);

  if (conflicts.length > 0) {
    throw new ScheduleConflictError(conflicts);
  }

  try {
    await persistScheduleEvent(event, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to publish schedule event: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  scheduleEvents = [...scheduleEvents, event];
  notify();
  return event;
}

/**
 * Create a concrete dynamic-program ScheduleEvent and then materialize its
 * canonical Request Show occurrence.
 *
 * This deliberately does NOT attempt a best-effort rollback delete if
 * occurrence materialization fails. A rollback delete is also a separate
 * QDN write and can itself fail, leaving an invisible published event with no
 * durable recovery path. Instead the event remains in local/remote schedule
 * state and the caller receives `ScheduleEventMaterializationError` with the
 * surviving event ID so it can retry materialization explicitly.
 */
export async function createDynamicScheduleEventAction(
  input: CreateScheduleEventInput,
  ownerName: string,
  materializeOccurrence: (event: ScheduleEvent) => Promise<unknown>,
): Promise<ScheduleEvent> {
  const event = await createScheduleEventAction(input, ownerName);

  try {
    await materializeOccurrence(event);
  } catch (cause) {
    throw new ScheduleEventMaterializationError(event, cause);
  }

  return event;
}

export async function updateScheduleEventAction(
  eventId: string,
  input: EditScheduleEventInput,
  ownerName: string,
): Promise<ScheduleEvent> {
  const index = scheduleEvents.findIndex((event) => event.eventId === eventId);
  if (index === -1) {
    throw new Error(`Schedule event not found: ${eventId}`);
  }

  const updated = editScheduleEvent(scheduleEvents[index], input);
  const conflicts = assertNoConflicts(updated, eventId);

  if (conflicts.length > 0) {
    throw new ScheduleConflictError(conflicts);
  }

  try {
    await persistScheduleEvent(updated, ownerName);
  } catch (error) {
    throw new Error(
      `Failed to update schedule event: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  scheduleEvents = [...scheduleEvents.slice(0, index), updated, ...scheduleEvents.slice(index + 1)];
  notify();
  return updated;
}

export async function deleteScheduleEventAction(eventId: string, ownerName: string): Promise<void> {
  const index = scheduleEvents.findIndex((event) => event.eventId === eventId);
  if (index === -1) {
    throw new Error(`Schedule event not found: ${eventId}`);
  }

  try {
    await persistScheduleDelete(getScheduleEventQdnIdentifier(eventId), ownerName);
  } catch (error) {
    throw new Error(
      `Failed to delete schedule event: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  scheduleEvents = scheduleEvents.filter((event) => event.eventId !== eventId);
  notify();
}

// ── Recurrence authoring + reconciliation ──────────────────────────

function targetEventsConflict(
  targetEvents: ScheduleEvent[],
  recurrenceId: string,
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const nonRecurringEvents = scheduleEvents.filter((event) => event.recurrenceId !== recurrenceId);

  for (const target of targetEvents) {
    conflicts.push(...findScheduleConflicts(target, nonRecurringEvents));
  }

  return conflicts;
}

function futureEventsForRecurrence(recurrenceId: string, nowUtcMs: number): ScheduleEvent[] {
  return scheduleEvents.filter((event) => {
    if (event.recurrenceId !== recurrenceId) {
      return false;
    }

    const start = parseUtcTimestampMs(event.startUtc);
    return start !== null && start >= nowUtcMs;
  });
}

function assertRecurrenceReconcileSafe(
  recurrence: ScheduleRecurrence,
  nowUtcMs: number,
): ScheduleEvent[] {
  const compileResult = compileScheduleRecurrence(recurrence, nowUtcMs);

  if (!compileResult.ok) {
    throw new Error(compileResult.errors.join(' '));
  }

  const targetEvents = compileResult.events;
  const targetValidation = validateScheduleSet(targetEvents);

  if (targetValidation.malformed.length > 0 || targetValidation.conflicts.length > 0) {
    throw new Error('Recurrence compiler produced an invalid schedule batch.');
  }

  const conflicts = targetEventsConflict(targetEvents, recurrence.recurrenceId);
  if (conflicts.length > 0) {
    throw new ScheduleConflictError(conflicts);
  }

  return targetEvents;
}

function replaceFutureRecurrenceEvents(
  recurrenceId: string,
  nowUtcMs: number,
  targetEvents: ScheduleEvent[],
): void {
  const otherEvents = scheduleEvents.filter((event) => {
    if (event.recurrenceId !== recurrenceId) {
      return true;
    }

    const start = parseUtcTimestampMs(event.startUtc);
    return start === null || start < nowUtcMs;
  });

  scheduleEvents = [...otherEvents, ...targetEvents];
}

async function reconcileRecurrenceEvents(
  recurrence: ScheduleRecurrence,
  ownerName: string,
  nowUtcMs: number,
): Promise<ScheduleRecurrenceApplyResult> {
  const compileResult = compileScheduleRecurrence(recurrence, nowUtcMs);

  if (!compileResult.ok) {
    throw new Error(compileResult.errors.join(' '));
  }

  const targetEvents = compileResult.events;
  const targetValidation = validateScheduleSet(targetEvents);

  if (targetValidation.malformed.length > 0 || targetValidation.conflicts.length > 0) {
    throw new Error('Recurrence compiler produced an invalid schedule batch.');
  }

  const conflicts = targetEventsConflict(targetEvents, recurrence.recurrenceId);
  if (conflicts.length > 0) {
    throw new ScheduleConflictError(conflicts);
  }

  const existingFuture = futureEventsForRecurrence(recurrence.recurrenceId, nowUtcMs);
  const existingById = new Map(existingFuture.map((event) => [event.eventId, event]));

  const eventsToPublish: ScheduleEvent[] = [];
  for (const target of targetEvents) {
    const existing = existingById.get(target.eventId);

    if (!existing) {
      eventsToPublish.push(target);
      continue;
    }

    if (JSON.stringify(existing) !== JSON.stringify(target)) {
      eventsToPublish.push(target);
    }
  }

  const batch = await publishScheduleEventBatch(eventsToPublish, ownerName);
  const publishedIds = new Set(batch.publishedEvents.map((event) => event.eventId));
  const targetIds = new Set(targetEvents.map((event) => event.eventId));

  const nextFuture: ScheduleEvent[] = [];
  for (const target of targetEvents) {
    const existing = existingById.get(target.eventId);

    if (batch.status === 'all-published' || publishedIds.has(target.eventId)) {
      nextFuture.push(target);
      continue;
    }

    if (existing) {
      nextFuture.push(existing);
    }
  }

  let deleted = 0;
  const deleteFailures: ScheduleRecurrenceApplyResult['deleteFailures'] = [];
  if (batch.status === 'all-published') {
    for (const existing of existingFuture) {
      if (!targetIds.has(existing.eventId)) {
        const identifier = getScheduleEventQdnIdentifier(existing.eventId);
        try {
          await persistScheduleDelete(identifier, ownerName);
          deleted += 1;
        } catch (error) {
          nextFuture.push(existing);
          deleteFailures.push({
            eventId: existing.eventId,
            identifier,
            error: error instanceof Error ? error.message : 'QDN delete was not accepted.',
          });
        }
      }
    }
  }

  const created = batch.publishedEvents.filter((event) => !existingById.has(event.eventId)).length;
  const updated = batch.publishedEvents.filter((event) => existingById.has(event.eventId)).length;

  return {
    recurrence,
    created,
    updated,
    deleted,
    deleteFailures,
    batch,
    reconciledEvents: nextFuture,
  };
}

export async function createScheduleRecurrenceAction(
  input: CreateScheduleRecurrenceInput,
  ownerName: string,
  nowUtcMs: number,
): Promise<ScheduleRecurrence> {
  const recurrence = createScheduleRecurrence(input);
  assertRecurrenceReconcileSafe(recurrence, nowUtcMs);
  await persistScheduleRecurrence(recurrence, ownerName);
  const result = await reconcileRecurrenceEvents(recurrence, ownerName, nowUtcMs);

  scheduleRecurrences = [...scheduleRecurrences, recurrence];
  replaceFutureRecurrenceEvents(recurrence.recurrenceId, nowUtcMs, result.reconciledEvents);
  notify();

  if (result.batch.status !== 'all-published' || result.deleteFailures.length > 0) {
    throw new ScheduleBatchPartialError(result);
  }

  return recurrence;
}

export async function updateScheduleRecurrenceAction(
  recurrenceId: string,
  input: EditScheduleRecurrenceInput,
  ownerName: string,
  nowUtcMs: number,
): Promise<ScheduleRecurrence> {
  const index = scheduleRecurrences.findIndex(
    (recurrence) => recurrence.recurrenceId === recurrenceId,
  );
  if (index === -1) {
    throw new Error(`Schedule recurrence not found: ${recurrenceId}`);
  }

  const updated = editScheduleRecurrence(scheduleRecurrences[index], input);
  assertRecurrenceReconcileSafe(updated, nowUtcMs);
  await persistScheduleRecurrence(updated, ownerName);
  const result = await reconcileRecurrenceEvents(updated, ownerName, nowUtcMs);

  scheduleRecurrences = [
    ...scheduleRecurrences.slice(0, index),
    updated,
    ...scheduleRecurrences.slice(index + 1),
  ];
  replaceFutureRecurrenceEvents(updated.recurrenceId, nowUtcMs, result.reconciledEvents);
  notify();

  if (result.batch.status !== 'all-published' || result.deleteFailures.length > 0) {
    throw new ScheduleBatchPartialError(result);
  }

  return updated;
}

/**
 * Retry only missing/failed concrete occurrences for an already-published
 * recurrence intent. Deterministic occurrence identifiers are unchanged by
 * retry, so already-published events are never sent again.
 */
export async function retryScheduleRecurrenceEventsAction(
  recurrenceId: string,
  ownerName: string,
  nowUtcMs: number,
): Promise<ScheduleRecurrenceApplyResult> {
  const recurrence = scheduleRecurrences.find((item) => item.recurrenceId === recurrenceId);
  if (!recurrence) {
    throw new Error(`Schedule recurrence not found: ${recurrenceId}`);
  }

  assertRecurrenceReconcileSafe(recurrence, nowUtcMs);
  const result = await reconcileRecurrenceEvents(recurrence, ownerName, nowUtcMs);
  replaceFutureRecurrenceEvents(recurrence.recurrenceId, nowUtcMs, result.reconciledEvents);
  notify();
  return result;
}

export async function deleteScheduleRecurrenceAction(
  recurrenceId: string,
  ownerName: string,
  nowUtcMs: number,
): Promise<ScheduleRecurrenceDeleteResult> {
  const recurrence = scheduleRecurrences.find((item) => item.recurrenceId === recurrenceId);
  if (!recurrence) {
    throw new Error(`Schedule recurrence not found: ${recurrenceId}`);
  }

  const futureEvents = futureEventsForRecurrence(recurrenceId, nowUtcMs);
  const deletedEventIds: string[] = [];
  const failures: ScheduleDeleteFailure[] = [];

  // Delete every child concrete occurrence before deleting the recurrence
  // intent. This makes any partial failure recoverable: the recurrence parent
  // still exists in QDN, so reload/reconstruction can discover the surviving
  // children and retry cleanup without re-deleting already-successful ones.
  for (const event of futureEvents) {
    const identifier = getScheduleEventQdnIdentifier(event.eventId);
    try {
      await persistScheduleDelete(identifier, ownerName);
      deletedEventIds.push(event.eventId);
    } catch (error) {
      failures.push({
        eventId: event.eventId,
        identifier,
        error: error instanceof Error ? error.message : 'QDN delete was not accepted.',
      });
    }
  }

  const deletedIds = new Set(deletedEventIds);
  const remainingEventIds = futureEvents
    .filter((event) => !deletedIds.has(event.eventId))
    .map((event) => event.eventId);

  if (failures.length > 0) {
    scheduleEvents = scheduleEvents.filter((event) => !deletedIds.has(event.eventId));
    notify();

    const result: ScheduleRecurrenceDeleteResult = {
      recurrenceId,
      status: 'partial',
      deletedEventIds,
      remainingEventIds,
      failures,
    };

    throw new ScheduleRecurrenceDeletePartialError(result);
  }

  try {
    await persistScheduleDelete(getScheduleRecurrenceQdnIdentifier(recurrenceId), ownerName);
  } catch (error) {
    scheduleEvents = scheduleEvents.filter((event) => !deletedIds.has(event.eventId));
    notify();

    const result: ScheduleRecurrenceDeleteResult = {
      recurrenceId,
      status: 'partial',
      deletedEventIds,
      remainingEventIds,
      failures,
      recurrenceDeleteError:
        error instanceof Error ? error.message : 'QDN recurrence delete was not accepted.',
    };

    throw new ScheduleRecurrenceDeletePartialError(result);
  }

  scheduleRecurrences = scheduleRecurrences.filter((item) => item.recurrenceId !== recurrenceId);
  scheduleEvents = scheduleEvents.filter((event) => !deletedIds.has(event.eventId));
  notify();

  return {
    recurrenceId,
    status: 'deleted',
    deletedEventIds,
    remainingEventIds: [],
    failures: [],
  };
}
