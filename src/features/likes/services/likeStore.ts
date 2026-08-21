/* ============================================================
 * NodeFM Station — Like Store
 *
 * QDN-backed public Like record store. Unlike the account-scoped
 * owner stores, Likes are public user actions discovered across
 * publishers using mode=ALL and reduced to per-track aggregates.
 * ============================================================ */

import { fetchQdnResourceData, publishResource, searchQdnResources } from '../../../qortium/qdn';
import { resolveNameWalletAddress } from '../../../qortium/identity';
import type { TrackLikeAggregate, TrackLikeRecord } from './likeService';
import {
  LIKE_IDENTIFIER_PREFIX,
  LIKE_QDN_SERVICE,
  buildTrackLikeEnvelope,
  buildTrackLikeIdentifier,
  classifyInvalidTrackLikeEnvelope,
  deserializeTrackLikeEnvelopeFromQdn,
  isTrackLikeIdentifierForPair,
  normalizeName,
  normalizeWalletAddress,
  reduceTrackLikeRecords,
  serializeTrackLikeEnvelopeForQdn,
  type LikeDiagnostic,
  type LikeIdentityValidator,
  type LikeState,
} from './likeService';

type LikeListener = () => void;

let likeRecords: TrackLikeRecord[] = [];
let likeLoaded = false;
let likeLoading = false;
let likeError: string | null = null;
let likeDiagnostics: LikeDiagnostic[] = [];
let likeIncomplete = false;
let likeEpoch = 0;
let likeLoadPromise: Promise<void> | null = null;

const walletByName = new Map<string, string | null>();
const listeners = new Set<LikeListener>();

function notify() {
  listeners.forEach((listener) => listener());
}

function isMissingResourceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /does not exist|not found|not published|unavailable|empty payload/i.test(error.message)
  );
}

function identityValidator(): LikeIdentityValidator {
  return {
    validatePublisher: (metadata, claimedPublisherName) =>
      normalizeName(metadata.publisherName) === normalizeName(claimedPublisherName)
        ? { ok: true }
        : {
            ok: false,
            code: 'IDENTITY_UNVERIFIED',
            detail: 'Like publisher name does not match the QDN resource publisher.',
          },
    validateWalletBinding: (publisherName, walletAddress) => {
      const resolvedAddress = walletByName.get(normalizeName(publisherName));
      return resolvedAddress === normalizeWalletAddress(walletAddress)
        ? { ok: true }
        : {
            ok: false,
            code: 'IDENTITY_UNVERIFIED',
            detail: 'Like wallet address does not match the verified Qortium name owner.',
          };
    },
  };
}

export function subscribeToLikeStore(listener: LikeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLikeRecords(): TrackLikeRecord[] {
  return [...likeRecords];
}

export function getLikeLoaded(): boolean {
  return likeLoaded;
}

export function getLikeLoading(): boolean {
  return likeLoading;
}

export function getLikeError(): string | null {
  return likeError;
}

export function getLikeIncomplete(): boolean {
  return likeIncomplete;
}

export function getLikeDiagnostics(): LikeDiagnostic[] {
  return [...likeDiagnostics];
}

export function getTrackLikeAggregate(
  trackId: string,
  records: TrackLikeRecord[] = likeRecords,
): TrackLikeAggregate {
  return reduceTrackLikeRecords(trackId, records, identityValidator());
}

export function isTrackLikedByUser(
  trackId: string,
  userAddress: string | null,
  records: TrackLikeRecord[] = likeRecords,
): boolean {
  if (!userAddress) {
    return false;
  }

  const aggregate = getTrackLikeAggregate(trackId, records);
  return aggregate.actors[normalizeWalletAddress(userAddress)]?.state === 'active';
}

function resourceMetadata(result: {
  name?: string;
  service?: string;
  identifier?: string;
  created?: number;
  updated?: number;
}): {
  service: string;
  publisherName: string;
  identifier: string;
  created: number;
  updated: number | null;
} | null {
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

async function loadLikeRecordsInternal(): Promise<void> {
  likeIncomplete = false;

  const results = await searchQdnResources({
    service: LIKE_QDN_SERVICE,
    query: LIKE_IDENTIFIER_PREFIX,
    prefix: true,
    mode: 'ALL',
    limit: 1000,
    includeMetadata: true,
  });

  const loaded: TrackLikeRecord[] = [];
  const diagnostics: LikeDiagnostic[] = [];
  const seenIdentifiers = new Set<string>();

  for (const result of results) {
    const metadata = resourceMetadata(result);
    const identifier = typeof result.identifier === 'string' ? result.identifier : '<unknown>';

    if (!metadata) {
      diagnostics.push({
        code: 'INVALID_METADATA',
        identifier,
        detail: 'Like discovery result is missing trusted QDN metadata.',
      });
      continue;
    }

    if (!metadata.identifier.startsWith(LIKE_IDENTIFIER_PREFIX)) {
      continue;
    }

    if (seenIdentifiers.has(metadata.identifier)) {
      continue;
    }

    seenIdentifiers.add(metadata.identifier);

    let payload: unknown;
    try {
      payload = await fetchQdnResourceData({
        service: LIKE_QDN_SERVICE,
        name: metadata.publisherName,
        identifier: metadata.identifier,
      });
    } catch (error) {
      if (isMissingResourceError(error)) {
        continue;
      }

      diagnostics.push({
        code: 'MALFORMED_ENVELOPE',
        identifier,
        detail: `Like resource is unavailable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      });
      likeIncomplete = true;
      continue;
    }

    const envelope = deserializeTrackLikeEnvelopeFromQdn(payload);
    if (!envelope) {
      diagnostics.push({
        code: classifyInvalidTrackLikeEnvelope(payload),
        identifier,
        detail: 'invalid Like envelope',
      });
      continue;
    }

    if (
      envelope.recordId !== metadata.identifier ||
      !isTrackLikeIdentifierForPair(
        metadata.identifier,
        envelope.body.targetId,
        envelope.body.walletAddress,
      )
    ) {
      diagnostics.push({
        code: 'IDENTIFIER_MISMATCH',
        identifier,
        detail: 'Like resource identifier does not match the target/actor pair.',
      });
      continue;
    }

    const normalizedName = normalizeName(metadata.publisherName);
    if (!walletByName.has(normalizedName)) {
      try {
        walletByName.set(normalizedName, await resolveNameWalletAddress(metadata.publisherName));
      } catch {
        walletByName.set(normalizedName, null);
      }
    }

    loaded.push({ metadata, envelope });
  }

  likeRecords = loaded;
  likeDiagnostics = diagnostics;
  likeIncomplete =
    likeIncomplete ||
    diagnostics.some((diagnostic) => diagnostic.detail.startsWith('Like resource is unavailable'));
  likeLoaded = true;
}

export async function loadLikeRecords(force = false): Promise<void> {
  if (likeLoaded && !force) {
    return;
  }

  if (likeLoading && !force) {
    if (likeLoadPromise) {
      return likeLoadPromise;
    }

    return;
  }

  if (force && likeLoadPromise) {
    likeEpoch += 1;
    likeLoaded = false;
    likeRecords = [];
    likeDiagnostics = [];
    likeError = null;
    likeIncomplete = false;
    likeLoading = false;
    likeLoadPromise = null;
  }

  const epoch = likeEpoch;
  likeLoading = true;
  likeError = null;
  notify();

  likeLoadPromise = loadLikeRecordsInternal()
    .then(() => {
      if (epoch === likeEpoch) {
        likeLoaded = true;
      }
    })
    .catch((error) => {
      if (epoch === likeEpoch) {
        likeError = error instanceof Error ? error.message : 'Failed to load Like records.';
      }
    })
    .finally(() => {
      if (epoch === likeEpoch) {
        likeLoading = false;
        likeLoadPromise = null;
        notify();
      }
    });

  return likeLoadPromise;
}

export async function refreshLikeRecords(): Promise<void> {
  await loadLikeRecords(true);
}

export async function setTrackLike(
  trackId: string,
  state: LikeState,
  publisherName: string,
  userAddress: string,
): Promise<void> {
  if (!publisherName.trim()) {
    throw new Error('A registered Qortium name is required to publish a Like.');
  }

  if (!userAddress.trim()) {
    throw new Error('An authenticated account is required to publish a Like.');
  }

  const identifier = buildTrackLikeIdentifier(trackId, userAddress);
  const envelope = buildTrackLikeEnvelope(
    {
      operation: 'like',
      targetType: 'track',
      targetId: trackId,
      state,
      publisherName: publisherName.trim(),
      walletAddress: userAddress.trim(),
    },
    identifier,
  );
  const data64 = btoa(unescape(encodeURIComponent(serializeTrackLikeEnvelopeForQdn(envelope))));

  await publishResource({
    service: LIKE_QDN_SERVICE,
    name: publisherName.trim(),
    identifier,
    data64,
    title: state === 'active' ? 'Track Like' : 'Track Unlike',
  });

  await refreshLikeRecords();
}

export function resetLikeStore(): void {
  likeEpoch += 1;
  likeRecords = [];
  likeLoaded = false;
  likeLoading = false;
  likeError = null;
  likeDiagnostics = [];
  likeIncomplete = false;
  likeLoadPromise = null;
  walletByName.clear();
  notify();
}
