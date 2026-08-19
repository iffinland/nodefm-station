/* ============================================================
 * NodeFM Station — Notice Store
 *
 * QDN-backed station notice store. Notices are public and scoped
 * to the station publisher name. Discovery uses mode=ALL and
 * reconstructs distinct identifiers. A missing resource is never
 * silently collapsed into a valid empty state.
 * ============================================================ */

import {
  deleteQdnResource,
  fetchQdnResourceData,
  publishResource,
  searchQdnResources,
} from '../../../qortium/qdn';
import type { StationNotice } from '../../../types/domain';
import {
  NOTICE_IDENTIFIER_PREFIX,
  NOTICE_QDN_SERVICE,
  classifyInvalidNoticePayload,
  deserializeNoticeFromQdn,
  getNoticeQdnIdentifier,
  serializeNoticeForQdn,
  type NoticeDiagnostic,
  type NoticeRecord,
} from './noticeService';

type NoticeListener = () => void;

let notices: NoticeRecord[] = [];
let noticeDiagnostics: NoticeDiagnostic[] = [];
let noticeLoaded = false;
let noticeLoading = false;
let noticeError: string | null = null;
let noticeIncomplete = false;
let noticeScope: string | null = null;
let noticeEpoch = 0;
let noticeLoadPromise: Promise<void> | null = null;

const listeners = new Set<NoticeListener>();

function notify() {
  listeners.forEach((listener) => listener());
}

function metadataFromResult(result: {
  name?: string;
  service?: string;
  identifier?: string;
  created?: number;
  updated?: number;
}): NoticeRecord['metadata'] | null {
  if (
    typeof result.name !== 'string' ||
    !result.name.trim() ||
    typeof result.service !== 'string' ||
    !result.service.trim() ||
    typeof result.identifier !== 'string' ||
    !result.identifier.trim() ||
    typeof result.created !== 'number' ||
    !Number.isSafeInteger(result.created)
  ) {
    return null;
  }

  return {
    service: result.service.trim(),
    publisherName: result.name.trim(),
    identifier: result.identifier.trim(),
    created: result.created,
    updated:
      typeof result.updated === 'number' && Number.isSafeInteger(result.updated)
        ? result.updated
        : null,
  };
}

function isMissingResourceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /does not exist|not found|not published|unavailable|empty payload/i.test(error.message)
  );
}

async function loadNoticeRecordsInternal(publisherName: string): Promise<void> {
  noticeIncomplete = false;

  const results = await searchQdnResources({
    service: NOTICE_QDN_SERVICE,
    name: publisherName,
    query: NOTICE_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 500,
    includeMetadata: true,
  });

  const loaded: NoticeRecord[] = [];
  const diagnostics: NoticeDiagnostic[] = [];
  const seenIdentifiers = new Set<string>();

  for (const result of results) {
    const identifier = typeof result.identifier === 'string' ? result.identifier : '<unknown>';

    if (!identifier.startsWith(NOTICE_IDENTIFIER_PREFIX)) {
      continue;
    }

    const metadata = metadataFromResult(result);

    if (!metadata) {
      diagnostics.push({
        code: 'INVALID_METADATA',
        identifier,
        detail: 'Notice discovery result is missing trusted QDN metadata.',
      });
      noticeIncomplete = true;
      continue;
    }

    if (metadata.publisherName !== publisherName) {
      diagnostics.push({
        code: 'PUBLISHER_MISMATCH',
        identifier,
        detail: 'Notice resource publisher does not match the station publisher name.',
      });
      continue;
    }

    if (seenIdentifiers.has(metadata.identifier)) {
      continue;
    }

    seenIdentifiers.add(metadata.identifier);

    let payload: unknown;

    try {
      payload = await fetchQdnResourceData({
        service: NOTICE_QDN_SERVICE,
        name: metadata.publisherName,
        identifier: metadata.identifier,
      });
    } catch (error) {
      if (isMissingResourceError(error)) {
        diagnostics.push({
          code: 'RESOURCE_UNAVAILABLE',
          identifier,
          detail: `Notice resource is unavailable: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        });
        noticeIncomplete = true;
        continue;
      }

      throw error;
    }

    const notice = deserializeNoticeFromQdn(payload);

    if (!notice) {
      diagnostics.push({
        code: classifyInvalidNoticePayload(payload),
        identifier,
        detail: 'invalid station notice resource',
      });
      noticeIncomplete = true;
      continue;
    }

    if (getNoticeQdnIdentifier(notice.noticeId) !== metadata.identifier) {
      diagnostics.push({
        code: 'IDENTIFIER_MISMATCH',
        identifier,
        detail: 'Notice resource identifier does not match the notice ID.',
      });
      noticeIncomplete = true;
      continue;
    }

    loaded.push({ metadata, notice });
  }

  notices = loaded;
  noticeDiagnostics = diagnostics;
}

export function subscribeToNoticeStore(listener: NoticeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNoticeRecords(): NoticeRecord[] {
  return notices.map((record) => ({ ...record }));
}

export function getNoticeLoaded(): boolean {
  return noticeLoaded;
}

export function getNoticeLoading(): boolean {
  return noticeLoading;
}

export function getNoticeError(): string | null {
  return noticeError;
}

export function getNoticeIncomplete(): boolean {
  return noticeIncomplete;
}

export function getNoticeDiagnostics(): NoticeDiagnostic[] {
  return [...noticeDiagnostics];
}

export async function loadNotices(publisherName: string | null, force = false): Promise<void> {
  const scope = publisherName?.trim() ?? '<none>';

  if (noticeLoaded && !force && noticeScope === scope) {
    return;
  }

  if (noticeLoading && !force && noticeScope === scope) {
    if (noticeLoadPromise) {
      return noticeLoadPromise;
    }

    return;
  }

  if (force && noticeLoadPromise) {
    noticeEpoch += 1;
    noticeLoaded = false;
    noticeLoading = false;
    notices = [];
    noticeDiagnostics = [];
    noticeError = null;
    noticeIncomplete = false;
    noticeLoadPromise = null;
  }

  const epoch = noticeEpoch;
  noticeScope = scope;
  noticeLoading = true;
  noticeError = null;
  notify();

  if (!publisherName) {
    notices = [];
    noticeDiagnostics = [];
    noticeIncomplete = false;
    noticeLoaded = true;
    noticeLoading = false;
    notify();
    return;
  }

  noticeLoadPromise = loadNoticeRecordsInternal(publisherName)
    .then(() => {
      if (epoch === noticeEpoch) {
        noticeLoaded = true;
      }
    })
    .catch((error) => {
      if (epoch === noticeEpoch) {
        noticeError = error instanceof Error ? error.message : 'Failed to load station notices.';
      }
    })
    .finally(() => {
      if (epoch === noticeEpoch) {
        noticeLoading = false;
        noticeLoadPromise = null;
        notify();
      }
    });

  return noticeLoadPromise;
}

export async function refreshNotices(publisherName: string | null): Promise<void> {
  await loadNotices(publisherName, true);
}

function assertNoticeOwner(actorAddress: string | null, ownerAddress: string): void {
  if (!actorAddress || !ownerAddress || actorAddress !== ownerAddress) {
    throw new Error('Only the station owner can manage station notices.');
  }
}

export async function saveNotice(
  notice: StationNotice,
  publisherName: string,
  actorAddress: string | null,
  ownerAddress: string,
): Promise<StationNotice> {
  assertNoticeOwner(actorAddress, ownerAddress);

  if (!publisherName.trim()) {
    throw new Error('A registered Qortium name is required to publish a station notice.');
  }

  const identifier = getNoticeQdnIdentifier(notice.noticeId);
  const data64 = btoa(unescape(encodeURIComponent(serializeNoticeForQdn(notice))));

  await publishResource({
    service: NOTICE_QDN_SERVICE,
    name: publisherName.trim(),
    identifier,
    data64,
    title: notice.title ?? 'Station Notice',
    description: notice.message,
  });

  const metadata: NoticeRecord['metadata'] = {
    service: NOTICE_QDN_SERVICE,
    publisherName: publisherName.trim(),
    identifier,
    created: Date.now(),
    updated: Date.now(),
  };

  const record = { metadata, notice };
  const existingIndex = notices.findIndex((entry) => entry.notice.noticeId === notice.noticeId);

  if (existingIndex >= 0) {
    notices = notices.map((entry, index) => (index === existingIndex ? record : entry));
  } else {
    notices = [...notices, record];
  }

  noticeLoaded = true;
  noticeError = null;
  notify();

  return notice;
}

export async function deleteNotice(
  noticeId: string,
  publisherName: string,
  actorAddress: string | null,
  ownerAddress: string,
): Promise<void> {
  assertNoticeOwner(actorAddress, ownerAddress);

  if (!publisherName.trim()) {
    throw new Error('A registered Qortium name is required to delete a station notice.');
  }

  const identifier = getNoticeQdnIdentifier(noticeId);

  await deleteQdnResource({
    service: NOTICE_QDN_SERVICE,
    name: publisherName.trim(),
    identifier,
  });

  notices = notices.filter((entry) => entry.notice.noticeId !== noticeId);
  notify();
}

export function resetNoticeStore(): void {
  noticeEpoch += 1;
  notices = [];
  noticeDiagnostics = [];
  noticeLoaded = false;
  noticeLoading = false;
  noticeError = null;
  noticeIncomplete = false;
  noticeScope = null;
  noticeLoadPromise = null;
  notify();
}
