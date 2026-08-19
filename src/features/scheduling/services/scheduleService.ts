/* ============================================================
 * NodeFM Station — Schedule Domain Service
 *
 * Pure domain validation, creation, editing, QDN identity, and
 * serialization for concrete ScheduleEvent and admin-side
 * ScheduleRecurrence records.
 * ============================================================ */

import type {
  ScheduleEvent,
  ScheduleEventSource,
  ScheduleRecurrence,
  ScheduleRecurrenceFrequency,
} from '../../../types/domain';
import { generateId } from '../../../utils/id';
import { isValidDurationMs } from '../../../utils/duration';
import { isRecord } from '../../../utils/record';
import { isNonEmptyTrimmedString } from '../../../utils/validation';
import { isValidIanaTimeZone, parseLocalDateInput, parseLocalTimeInput } from './timezone';

export const SCHEDULE_QDN_SERVICE = 'JSON';
export const SCHEDULE_EVENT_IDENTIFIER_PREFIX = 'nodefm-schedule-';
export const SCHEDULE_RECURRENCE_IDENTIFIER_PREFIX = 'nodefm-schedule-recurrence-';

export function getScheduleEventQdnIdentifier(eventId: string): string {
  return `${SCHEDULE_EVENT_IDENTIFIER_PREFIX}${eventId}`;
}

export function getScheduleRecurrenceQdnIdentifier(recurrenceId: string): string {
  return `${SCHEDULE_RECURRENCE_IDENTIFIER_PREFIX}${recurrenceId}`;
}

// ── UTC timestamp helpers ──────────────────────────────────────────

export function isValidUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.trim()) &&
    Number.isFinite(Date.parse(value))
  );
}

export function parseUtcTimestampMs(value: unknown): number | null {
  return isValidUtcTimestamp(value) ? Date.parse(value as string) : null;
}

// ── Source validation ──────────────────────────────────────────────

export function isScheduleEventSource(value: unknown): value is ScheduleEventSource {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as ScheduleEventSource;

  if (candidate.type === 'playlist') {
    return (
      isNonEmptyTrimmedString(candidate.playlistId) &&
      isNonEmptyTrimmedString(candidate.playlistVersionId)
    );
  }

  if (candidate.type === 'dynamic-program') {
    return isNonEmptyTrimmedString(candidate.programDefinitionId);
  }

  return false;
}

// ── Schedule event validation ──────────────────────────────────────

export type ScheduleEventValidation = { ok: true } | { ok: false; errors: string[] };

export function validateScheduleEvent(event: ScheduleEvent): ScheduleEventValidation {
  const errors: string[] = [];

  if (!isNonEmptyTrimmedString(event.eventId)) {
    errors.push('eventId must be a non-empty string.');
  }

  const start = parseUtcTimestampMs(event.startUtc);
  const end = parseUtcTimestampMs(event.endUtc);

  if (start === null) {
    errors.push('startUtc must be a valid UTC timestamp.');
  }

  if (end === null) {
    errors.push('endUtc must be a valid UTC timestamp.');
  }

  if (start !== null && end !== null && start >= end) {
    errors.push('startUtc must be earlier than endUtc.');
  }

  if (!isScheduleEventSource(event.source)) {
    errors.push('source must reference an immutable playlist version or a dynamic program.');
  }

  if (event.recurrenceId !== undefined && !isNonEmptyTrimmedString(event.recurrenceId)) {
    errors.push('recurrenceId, when present, must be a non-empty string.');
  }

  if (
    event.recurrenceInstanceKey !== undefined &&
    !isNonEmptyTrimmedString(event.recurrenceInstanceKey)
  ) {
    errors.push('recurrenceInstanceKey, when present, must be a non-empty string.');
  }

  if (!isValidUtcTimestamp(event.createdAt) || !isValidUtcTimestamp(event.updatedAt)) {
    errors.push('createdAt and updatedAt must be valid UTC timestamps.');
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function assertValidScheduleEvent(event: ScheduleEvent): void {
  const result = validateScheduleEvent(event);
  if (!result.ok) {
    throw new Error(result.errors[0]);
  }
}

export function isScheduleEventRecord(value: unknown): value is ScheduleEvent {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as ScheduleEvent;
  return validateScheduleEvent(candidate).ok;
}

// ── Schedule event creation/editing ────────────────────────────────

export type CreateScheduleEventInput = {
  title?: string;
  startUtc: string;
  endUtc: string;
  source: ScheduleEventSource;
  recurrenceId?: string;
  recurrenceInstanceKey?: string;
};

export type EditScheduleEventInput = Partial<
  Pick<
    ScheduleEvent,
    'title' | 'startUtc' | 'endUtc' | 'source' | 'recurrenceId' | 'recurrenceInstanceKey'
  >
>;

export function createScheduleEvent(input: CreateScheduleEventInput): ScheduleEvent {
  const now = new Date().toISOString();
  const event: ScheduleEvent = {
    schemaVersion: 1,
    eventId: generateId(),
    title: input.title,
    startUtc: input.startUtc,
    endUtc: input.endUtc,
    source: input.source,
    recurrenceId: input.recurrenceId,
    recurrenceInstanceKey: input.recurrenceInstanceKey,
    createdAt: now,
    updatedAt: now,
  };

  assertValidScheduleEvent(event);
  return event;
}

export function editScheduleEvent(
  event: ScheduleEvent,
  input: EditScheduleEventInput,
): ScheduleEvent {
  const next: ScheduleEvent = {
    ...event,
    ...input,
    title: input.title !== undefined ? input.title : event.title,
    updatedAt: new Date().toISOString(),
  };

  assertValidScheduleEvent(next);
  return next;
}

// ── Conflict detection ─────────────────────────────────────────────

export function utcIntervalsOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  const aStart = parseUtcTimestampMs(startA);
  const aEnd = parseUtcTimestampMs(endA);
  const bStart = parseUtcTimestampMs(startB);
  const bEnd = parseUtcTimestampMs(endB);

  if (aStart === null || aEnd === null || bStart === null || bEnd === null) {
    return false;
  }

  return aStart < bEnd && bStart < aEnd;
}

export type ScheduleConflict = {
  eventId: string;
  startUtc: string;
  endUtc: string;
};

export function findScheduleConflicts(
  candidate: Pick<ScheduleEvent, 'eventId' | 'startUtc' | 'endUtc'>,
  events: readonly Pick<ScheduleEvent, 'eventId' | 'startUtc' | 'endUtc'>[],
  options: { ignoreEventId?: string } = {},
): ScheduleConflict[] {
  return events
    .filter(
      (event) => event.eventId !== candidate.eventId && event.eventId !== options.ignoreEventId,
    )
    .filter((event) =>
      utcIntervalsOverlap(candidate.startUtc, candidate.endUtc, event.startUtc, event.endUtc),
    )
    .map((event) => ({
      eventId: event.eventId,
      startUtc: event.startUtc,
      endUtc: event.endUtc,
    }));
}

export type ScheduleSetValidation = {
  malformed: Array<{ eventId: string; errors: string[] }>;
  conflicts: Array<{ first: ScheduleEvent; second: ScheduleEvent }>;
};

export function validateScheduleSet(events: readonly ScheduleEvent[]): ScheduleSetValidation {
  const malformed: ScheduleSetValidation['malformed'] = [];
  const conflicts: ScheduleSetValidation['conflicts'] = [];

  for (const event of events) {
    const result = validateScheduleEvent(event);
    if (!result.ok) {
      malformed.push({ eventId: event.eventId ?? '<unknown>', errors: result.errors });
    }
  }

  const sorted = [...events].sort((left, right) => {
    const startDelta =
      (parseUtcTimestampMs(left.startUtc) ?? 0) - (parseUtcTimestampMs(right.startUtc) ?? 0);
    if (startDelta !== 0) return startDelta;
    return (parseUtcTimestampMs(left.endUtc) ?? 0) - (parseUtcTimestampMs(right.endUtc) ?? 0);
  });

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (utcIntervalsOverlap(previous.startUtc, previous.endUtc, current.startUtc, current.endUtc)) {
      conflicts.push({ first: previous, second: current });
    }
  }

  return { malformed, conflicts };
}

// ── Serialization ──────────────────────────────────────────────────

export function serializeScheduleEventForQdn(event: ScheduleEvent): string {
  return JSON.stringify(event);
}

export function deserializeScheduleEventFromQdn(value: unknown): ScheduleEvent | null {
  if (!isScheduleEventRecord(value)) {
    return null;
  }

  return value as ScheduleEvent;
}

export function serializeScheduleRecurrenceForQdn(recurrence: ScheduleRecurrence): string {
  return JSON.stringify(recurrence);
}

export function deserializeScheduleRecurrenceFromQdn(value: unknown): ScheduleRecurrence | null {
  if (!isScheduleRecurrenceRecord(value)) {
    return null;
  }

  return value as ScheduleRecurrence;
}

// ── Recurrence validation ──────────────────────────────────────────

export type CreateScheduleRecurrenceInput = {
  title: string;
  source: ScheduleEventSource;
  timezone: string;
  frequency: ScheduleRecurrenceFrequency;
  localStartTime: string;
  durationMs: number;
  daysOfWeek?: number[];
  activeFromLocalDate: string;
  activeUntilLocalDate?: string;
  ownerAddress: string;
};

export type EditScheduleRecurrenceInput = Partial<
  Omit<CreateScheduleRecurrenceInput, 'ownerAddress'>
>;

function validateDaysOfWeek(
  frequency: ScheduleRecurrenceFrequency,
  daysOfWeek: number[] | undefined,
): string[] {
  const errors: string[] = [];

  if (frequency === 'daily') {
    if (daysOfWeek !== undefined && daysOfWeek.length > 0) {
      errors.push('daysOfWeek must be empty or omitted for daily recurrence.');
    }
    return errors;
  }

  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    errors.push('Weekly recurrence requires at least one selected weekday.');
    return errors;
  }

  if (daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    errors.push('daysOfWeek values must be integers from 0 (Sunday) to 6 (Saturday).');
  }

  if (new Set(daysOfWeek).size !== daysOfWeek.length) {
    errors.push('daysOfWeek must not contain duplicates.');
  }

  return errors;
}

export function validateScheduleRecurrence(
  recurrence: ScheduleRecurrence,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (!isNonEmptyTrimmedString(recurrence.recurrenceId)) {
    errors.push('recurrenceId must be a non-empty string.');
  }

  if (!isNonEmptyTrimmedString(recurrence.ownerAddress)) {
    errors.push('ownerAddress must be a non-empty string.');
  }

  if (!isNonEmptyTrimmedString(recurrence.title)) {
    errors.push('title must be a non-empty string.');
  }

  if (!isScheduleEventSource(recurrence.source)) {
    errors.push('source must reference an immutable playlist version or a dynamic program.');
  }

  if (!isValidIanaTimeZone(recurrence.timezone)) {
    errors.push('timezone must be a valid IANA timezone.');
  }

  if (recurrence.frequency !== 'daily' && recurrence.frequency !== 'weekly') {
    errors.push('frequency must be "daily" or "weekly".');
  } else {
    errors.push(...validateDaysOfWeek(recurrence.frequency, recurrence.daysOfWeek));
  }

  try {
    parseLocalTimeInput(recurrence.localStartTime);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid localStartTime.');
  }

  if (!isValidDurationMs(recurrence.durationMs)) {
    errors.push('durationMs must be a positive integer.');
  }

  try {
    parseLocalDateInput(recurrence.activeFromLocalDate);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid activeFromLocalDate.');
  }

  if (recurrence.activeUntilLocalDate !== undefined) {
    try {
      const from = parseLocalDateInput(recurrence.activeFromLocalDate);
      const until = parseLocalDateInput(recurrence.activeUntilLocalDate);
      if (
        Date.UTC(until.year, until.month - 1, until.day) <
        Date.UTC(from.year, from.month - 1, from.day)
      ) {
        errors.push('activeUntilLocalDate must not be before activeFromLocalDate.');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Invalid activeUntilLocalDate.');
    }
  }

  if (!isValidUtcTimestamp(recurrence.createdAt) || !isValidUtcTimestamp(recurrence.updatedAt)) {
    errors.push('createdAt and updatedAt must be valid UTC timestamps.');
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function isScheduleRecurrenceRecord(value: unknown): value is ScheduleRecurrence {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as ScheduleRecurrence;
  return validateScheduleRecurrence(candidate).ok;
}

export function createScheduleRecurrence(input: CreateScheduleRecurrenceInput): ScheduleRecurrence {
  const now = new Date().toISOString();
  const recurrence: ScheduleRecurrence = {
    schemaVersion: 1,
    recurrenceId: generateId(),
    ownerAddress: input.ownerAddress,
    title: input.title.trim(),
    source: input.source,
    timezone: input.timezone.trim(),
    frequency: input.frequency,
    localStartTime: input.localStartTime,
    durationMs: input.durationMs,
    daysOfWeek: input.daysOfWeek,
    activeFromLocalDate: input.activeFromLocalDate,
    activeUntilLocalDate: input.activeUntilLocalDate,
    createdAt: now,
    updatedAt: now,
  };

  const result = validateScheduleRecurrence(recurrence);
  if (!result.ok) {
    throw new Error(result.errors[0]);
  }

  return recurrence;
}

export function editScheduleRecurrence(
  recurrence: ScheduleRecurrence,
  input: EditScheduleRecurrenceInput,
): ScheduleRecurrence {
  const next: ScheduleRecurrence = {
    ...recurrence,
    ...input,
    title: input.title !== undefined ? input.title.trim() : recurrence.title,
    timezone: input.timezone !== undefined ? input.timezone.trim() : recurrence.timezone,
    updatedAt: new Date().toISOString(),
  };

  const result = validateScheduleRecurrence(next);
  if (!result.ok) {
    throw new Error(result.errors[0]);
  }

  return next;
}
