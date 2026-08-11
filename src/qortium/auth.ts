/* ============================================================
 * NodeFM Station — Qortium Auth
 *
 * Authentication and identity resolution.
 * All auth state flows through this module.
 * ============================================================ */

import { getSelectedAccount, sendBridgeRequest } from './bridge';

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | {
      status: 'authenticated';
      address: string;
      name?: string;
    }
  | { status: 'error'; message: string };

let cachedAuthState: AuthState = { status: 'loading' };
let authResolvePromise: Promise<AuthState> | null = null;

/**
 * Resolve the current authenticated user from Qortium Home.
 * Result is memoized — call `refreshAuth()` to force a re-fetch.
 */
export async function resolveAuth(): Promise<AuthState> {
  if (cachedAuthState.status === 'authenticated') {
    return cachedAuthState;
  }

  if (authResolvePromise) {
    return authResolvePromise;
  }

  authResolvePromise = resolveAuthInternal();

  try {
    cachedAuthState = await authResolvePromise;
    return cachedAuthState;
  } finally {
    authResolvePromise = null;
  }
}

async function resolveAuthInternal(): Promise<AuthState> {
  try {
    const account = (await getSelectedAccount()) as
      { address?: string; name?: string } | null | undefined;

    if (!account || !account.address) {
      return { status: 'unauthenticated' };
    }

    return {
      status: 'authenticated',
      address: account.address,
      name: account.name,
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to resolve authentication.',
    };
  }
}

/** Force re-fetch of auth state. */
export function refreshAuth(): void {
  cachedAuthState = { status: 'loading' };
  authResolvePromise = null;
}

/**
 * Check whether the given address matches the station owner.
 * Phase 1: simple address comparison against a hardcoded owner address
 * or one provided from station config.
 */
export function isStationOwner(userAddress: string | null, ownerAddress: string | null): boolean {
  if (!userAddress || !ownerAddress) return false;
  return userAddress === ownerAddress;
}

// ── Account Change Listener ─────────────────────────────────────────

export function listenForAccountChanges(onChange: () => void): () => void {
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string };

    if (data?.type === 'qortium:selected-account-changed') {
      refreshAuth();
      onChange();
    }
  };

  window.addEventListener('message', handler);

  return () => window.removeEventListener('message', handler);
}

// ── Publish QDN Resource ────────────────────────────────────────────

export type PublishResourceInput = {
  service: string;
  identifier: string;
  name?: string;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  data64: string;
  filename?: string;
};

export function publishQdnResource(input: PublishResourceInput): Promise<unknown> {
  return sendBridgeRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    ...input,
  });
}
