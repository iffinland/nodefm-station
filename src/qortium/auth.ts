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
let authResolveEpoch = 0;

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

  const epoch = authResolveEpoch;

  authResolvePromise = resolveAuthInternal()
    .then((state) => {
      if (epoch === authResolveEpoch) {
        cachedAuthState = state;
      }

      return state;
    })
    .finally(() => {
      if (epoch === authResolveEpoch) {
        authResolvePromise = null;
      }
    });

  return authResolvePromise;
}

/** Error messages from Home that mean "no account selected" rather than a failure. */
const NO_ACCOUNT_MESSAGES = ['No account is selected for this tab.', 'No account is selected'];

function isNoAccountError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return NO_ACCOUNT_MESSAGES.some((msg) => error.message.includes(msg));
}

async function resolveAuthInternal(): Promise<AuthState> {
  try {
    const account = (await getSelectedAccount()) as
      | {
          address?: string;
          name?: string;
        }
      | null
      | undefined;

    if (!account || !account.address) {
      return { status: 'unauthenticated' };
    }

    return {
      status: 'authenticated',
      address: account.address,
      name: account.name,
    };
  } catch (error) {
    // Map "no selected account" to unauthenticated instead of error.
    // This is a normal state when the user hasn't selected an account in Home.
    if (isNoAccountError(error)) {
      return { status: 'unauthenticated' };
    }

    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to resolve authentication.',
    };
  }
}

/** Force re-fetch of auth state. */
export function refreshAuth(): void {
  authResolveEpoch += 1;
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
//
// Home sends `qortium:selected-account-changed` via postMessage when
// the selected account changes or the wallet lock state changes.
// The event is a signal only — no account data is included.
// Apps must re-call GET_SELECTED_ACCOUNT after receiving it.

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
