/* ============================================================
 * NodeFM Station — Qortium Identity Helpers
 *
 * Small, reusable account/name identity resolution built on the
 * verified GET_ACCOUNT_NAMES and GET_NAME_DATA bridge actions.
 * These helpers are deliberately separate from auth so domain
 * reducers can validate QDN publisher/name-wallet evidence.
 * ============================================================ */

import { sendBridgeRequest } from './bridge';

const ACCOUNT_NAMES_TTL_MS = 5 * 60_000;
const NAME_ADDRESS_TTL_MS = 5 * 60_000;

type CacheEntry<T> = {
  value: T;
  cachedAt: number;
};

const accountNamesCache = new Map<string, CacheEntry<string[]>>();
const accountNamesInflight = new Map<string, Promise<string[]>>();
const nameAddressCache = new Map<string, CacheEntry<string | null>>();
const nameAddressInflight = new Map<string, Promise<string | null>>();

function isFresh(cachedAt: number, ttlMs: number): boolean {
  return Date.now() - cachedAt < ttlMs;
}

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAccountNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (typeof entry === 'object' && entry !== null) {
        return (entry as { name?: unknown }).name;
      }

      return null;
    })
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => name.trim());
}

export async function getAccountNames(address: string): Promise<string[]> {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    return [];
  }

  const cached = accountNamesCache.get(normalizedAddress);
  if (cached && isFresh(cached.cachedAt, ACCOUNT_NAMES_TTL_MS)) {
    return cached.value;
  }

  const inflight = accountNamesInflight.get(normalizedAddress);
  if (inflight) {
    return inflight;
  }

  const requestPromise = sendBridgeRequest<unknown>({
    action: 'GET_ACCOUNT_NAMES',
    address: normalizedAddress,
  })
    .then((raw) => {
      const names = normalizeAccountNames(raw);
      accountNamesCache.set(normalizedAddress, {
        value: names,
        cachedAt: Date.now(),
      });
      return names;
    })
    .finally(() => {
      accountNamesInflight.delete(normalizedAddress);
    });

  accountNamesInflight.set(normalizedAddress, requestPromise);
  return requestPromise;
}

export async function resolveNameWalletAddress(name: string): Promise<string | null> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return null;
  }

  const cacheKey = normalizedName.toLowerCase();
  const cached = nameAddressCache.get(cacheKey);
  if (cached && isFresh(cached.cachedAt, NAME_ADDRESS_TTL_MS)) {
    return cached.value;
  }

  const inflight = nameAddressInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const requestPromise = sendBridgeRequest<unknown>({
    action: 'GET_NAME_DATA',
    name: normalizedName,
  })
    .then((response) => {
      if (!response || typeof response !== 'object') {
        nameAddressCache.set(cacheKey, { value: null, cachedAt: Date.now() });
        return null;
      }

      const record = response as Record<string, unknown>;
      const resolvedAddress =
        normalizeAddress(record.owner) ??
        normalizeAddress(record.ownerAddress) ??
        normalizeAddress(record.address);

      nameAddressCache.set(cacheKey, {
        value: resolvedAddress,
        cachedAt: Date.now(),
      });

      return resolvedAddress;
    })
    .finally(() => {
      nameAddressInflight.delete(cacheKey);
    });

  nameAddressInflight.set(cacheKey, requestPromise);
  return requestPromise;
}

export function clearIdentityCaches(): void {
  accountNamesCache.clear();
  accountNamesInflight.clear();
  nameAddressCache.clear();
  nameAddressInflight.clear();
}
