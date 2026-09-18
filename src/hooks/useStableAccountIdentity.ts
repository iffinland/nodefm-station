/* ============================================================
 * NodeFM Station — Stable Account Identity
 *
 * Home reports a wallet lock-state change through the same
 * `qortium:selected-account-changed` signal as a real account change,
 * and the auth provider answers every signal with a transient
 * `loading` state.
 *
 * That transient is not an identity change. Consumers that reset
 * authored state (drafts, in-flight publish UI) on identity change must
 * therefore key that reset off the last *resolved* account identity, not
 * off the momentary absence of one. This hook holds the last resolved
 * identity until auth resolves to a different account, or to no account
 * at all.
 * ============================================================ */

import { useEffect, useState } from 'react';
import type { AuthState } from '../qortium/auth';

export type StableAccountIdentity = {
  address: string;
  name: string;
};

function resolveIdentity(auth: AuthState): StableAccountIdentity | null {
  if (auth.status !== 'authenticated') {
    return null;
  }

  return { address: auth.address, name: auth.name ?? '' };
}

export function useStableAccountIdentity(auth: AuthState): StableAccountIdentity | null {
  const [identity, setIdentity] = useState<StableAccountIdentity | null>(() =>
    resolveIdentity(auth),
  );

  useEffect(() => {
    // A lock-state-only refresh resolves to the held identity again.
    if (auth.status === 'loading') return;

    const next = resolveIdentity(auth);

    setIdentity((current) => {
      if (!next) return null;
      if (current && current.address === next.address && current.name === next.name) {
        return current;
      }

      return next;
    });
  }, [auth]);

  return identity;
}
