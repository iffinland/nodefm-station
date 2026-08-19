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

async function applyRecurrence(
  recurrence: ScheduleRecurrence,
  ownerName: string,
  nowUtcMs: number,
): Promise<{ created: number; updated: number; deleted: number }> {
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

  await persistScheduleRecurrence(recurrence, ownerName);

  const targetById = new Map(targetEvents.map((event) => [event.eventId, event]));
  const existingFuture = futureEventsForRecurrence(recurrence.recurrenceId, nowUtcMs);
  const existingById = new Map(existingFuture.map((event) => [event.eventId, event]));

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const target of targetEvents) {
    const existing = existingById.get(target.eventId);

    if (!existing) {
      await persistScheduleEvent(target, ownerName);
      created += 1;
      continue;
    }

    if (JSON.stringify(existing) !== JSON.stringify(target)) {
      await persistScheduleEvent(target, ownerName);
      updated += 1;
    }
  }

  for (const existing of existingFuture) {
    if (!targetById.has(existing.eventId)) {
      await persistScheduleDelete(getScheduleEventQdnIdentifier(existing.eventId), ownerName);
      deleted += 1;
    }
  }

  return { created, updated, deleted };
}

export async function createScheduleRecurrenceAction(
  input: CreateScheduleRecurrenceInput,
  ownerName: string,
  nowUtcMs: number,
): Promise<ScheduleRecurrence> {
  const recurrence = createScheduleRecurrence(input);
  await applyRecurrence(recurrence, ownerName, nowUtcMs);

  scheduleRecurrences = [...scheduleRecurrences, recurrence];
  const createdCompilation = compileScheduleRecurrence(recurrence, nowUtcMs);
  replaceFutureRecurrenceEvents(
    recurrence.recurrenceId,
    nowUtcMs,
    createdCompilation.ok ? createdCompilation.events : [],
  );
  notify();
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
  await applyRecurrence(updated, ownerName, nowUtcMs);

  scheduleRecurrences = [
    ...scheduleRecurrences.slice(0, index),
    updated,
    ...scheduleRecurrences.slice(index + 1),
  ];
  const compiled = compileScheduleRecurrence(updated, nowUtcMs);
  replaceFutureRecurrenceEvents(updated.recurrenceId, nowUtcMs, compiled.ok ? compiled.events : []);
  notify();
  return updated;
}

export async function deleteScheduleRecurrenceAction(
  recurrenceId: string,
  ownerName: string,
  nowUtcMs: number,
): Promise<void> {
  const recurrence = scheduleRecurrences.find((item) => item.recurrenceId === recurrenceId);
  if (!recurrence) {
    throw new Error(`Schedule recurrence not found: ${recurrenceId}`);
  }

  try {
    await persistScheduleDelete(getScheduleRecurrenceQdnIdentifier(recurrenceId), ownerName);
  } catch (error) {
    throw new Error(
      `Failed to delete recurrence: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  // Delete only future concrete occurrences generated from this intent.
  // Historical/past concrete events remain as already-played evidence.
  const futureEvents = futureEventsForRecurrence(recurrenceId, nowUtcMs);
  for (const event of futureEvents) {
    await persistScheduleDelete(getScheduleEventQdnIdentifier(event.eventId), ownerName);
  }

  scheduleRecurrences = scheduleRecurrences.filter((item) => item.recurrenceId !== recurrenceId);
  const futureIds = new Set(futureEvents.map((event) => event.eventId));
  scheduleEvents = scheduleEvents.filter((event) => !futureIds.has(event.eventId));
  notify();
}
