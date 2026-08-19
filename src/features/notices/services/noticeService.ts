/* ============================================================
 * NodeFM Station — Station Notice Domain Service
 *
 * Pure validation, serialization, QDN identity, and active-window
 * helpers for station notices.
 *
 * A notice is a mutable owner-managed QDN JSON resource:
 *   service: JSON
 *   name: station publisher's registered Qortium name
 *   identifier: nodefm-notice-<noticeId>
 * ============================================================ */

import type { StationNotice } from '../../../types/domain';
import { generateId } from '../../../utils/id';
import { isRecord } from '../../../utils/record';
import { isNonEmptyTrimmedString } from '../../../utils/validation';

export const NOTICE_QDN_SERVICE = 'JSON';
export const NOTICE_IDENTIFIER_PREFIX = 'nodefm-notice-';

export type NoticeResourceMetadata = {
  service: string;
  publisherName: string;
  identifier: string;
  created: number;
  updated: number | null;
};

export type NoticeRecord = {
  metadata: NoticeResourceMetadata;
  notice: StationNotice;
};

export type NoticeDiagnosticCode =
  | 'INVALID_METADATA'
  | 'MALFORMED_RESOURCE'
  | 'PUBLISHER_MISMATCH'
  | 'IDENTIFIER_MISMATCH'
  | 'RESOURCE_UNAVAILABLE';

export type NoticeDiagnostic = {
  code: NoticeDiagnosticCode;
  identifier: string;
  detail: string;
};

export type CreateNoticeInput = {
  title?: string;
  message: string;
  activeFromUtc?: string;
  activeUntilUtc?: string;
};

export type EditNoticeInput = Partial<CreateNoticeInput>;

export function getNoticeQdnIdentifier(noticeId: string): string {
  if (!isNonEmptyTrimmedString(noticeId)) {
    throw new Error('Notice ID is required to build a QDN identifier.');
  }

  return `${NOTICE_IDENTIFIER_PREFIX}${noticeId.trim()}`;
}

export function isNoticeQdnIdentifier(value: string): boolean {
  return value.startsWith(NOTICE_IDENTIFIER_PREFIX);
}

export function isValidUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.trim()) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateActiveWindow(input: EditNoticeInput): void {
  if (input.activeFromUtc !== undefined && !isValidUtcTimestamp(input.activeFromUtc)) {
    throw new Error('Notice start time must be a valid UTC timestamp.');
  }

  if (input.activeUntilUtc !== undefined && !isValidUtcTimestamp(input.activeUntilUtc)) {
    throw new Error('Notice end time must be a valid UTC timestamp.');
  }

  if (
    input.activeFromUtc !== undefined &&
    input.activeUntilUtc !== undefined &&
    Date.parse(input.activeFromUtc) >= Date.parse(input.activeUntilUtc)
  ) {
    throw new Error('Notice end time must be later than its start time.');
  }
}

export function createNotice(input: CreateNoticeInput): StationNotice {
  if (!isNonEmptyTrimmedString(input.message)) {
    throw new Error('Notice message is required.');
  }

  if (input.title !== undefined && !isNonEmptyTrimmedString(input.title)) {
    throw new Error('Notice title must be a non-empty string.');
  }

  validateActiveWindow(input);

  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    noticeId: generateId(),
    title: input.title?.trim(),
    message: input.message.trim(),
    activeFromUtc: input.activeFromUtc,
    activeUntilUtc: input.activeUntilUtc,
    createdAt: now,
    updatedAt: now,
  };
}

export function editNotice(notice: StationNotice, input: EditNoticeInput): StationNotice {
  if (input.message !== undefined && !isNonEmptyTrimmedString(input.message)) {
    throw new Error('Notice message is required.');
  }

  if (input.title !== undefined && !isNonEmptyTrimmedString(input.title)) {
    throw new Error('Notice title must be a non-empty string.');
  }

  validateActiveWindow(input);

  return {
    ...notice,
    ...input,
    title: input.title !== undefined ? input.title.trim() : notice.title,
    message: input.message !== undefined ? input.message.trim() : notice.message,
    updatedAt: new Date().toISOString(),
  };
}

export function isStationNoticeRecord(value: unknown): value is StationNotice {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as StationNotice;

  return (
    typeof candidate.noticeId === 'string' &&
    candidate.noticeId.trim() !== '' &&
    isNonEmptyTrimmedString(candidate.message) &&
    (candidate.title === undefined || typeof candidate.title === 'string') &&
    (candidate.activeFromUtc === undefined || isValidUtcTimestamp(candidate.activeFromUtc)) &&
    (candidate.activeUntilUtc === undefined || isValidUtcTimestamp(candidate.activeUntilUtc)) &&
    typeof candidate.schemaVersion === 'number'
  );
}

export function serializeNoticeForQdn(notice: StationNotice): string {
  return JSON.stringify(notice);
}

export function deserializeNoticeFromQdn(value: unknown): StationNotice | null {
  return isStationNoticeRecord(value) ? value : null;
}

export function classifyInvalidNoticePayload(value: unknown): NoticeDiagnosticCode {
  return isRecord(value) ? 'MALFORMED_RESOURCE' : 'MALFORMED_RESOURCE';
}

/**
 * Return only notices active at `nowUtcMs`.
 */
export function getActiveNotices(
  notices: readonly StationNotice[],
  nowUtcMs: number,
): StationNotice[] {
  if (!Number.isFinite(nowUtcMs)) {
    return [];
  }

  return notices.filter((notice) => {
    const afterStart =
      notice.activeFromUtc === undefined || Date.parse(notice.activeFromUtc) <= nowUtcMs;
    const beforeEnd =
      notice.activeUntilUtc === undefined || Date.parse(notice.activeUntilUtc) > nowUtcMs;

    return afterStart && beforeEnd;
  });
}

export function toLocalDateTimeInputValue(utcIso: string): string {
  if (!isValidUtcTimestamp(utcIso)) {
    return '';
  }

  const date = new Date(utcIso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function utcFromLocalDateTimeInput(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Notice time is not a valid local date/time.');
  }

  return date.toISOString();
}
