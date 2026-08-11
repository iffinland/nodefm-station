/* ============================================================
 * NodeFM Station — Auth Provider
 *
 * React context for authentication state.
 * Wraps Qortium bridge auth and provides user identity
 * plus owner/admin authorization checks.
 * ============================================================ */

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  resolveAuth,
  refreshAuth,
  listenForAccountChanges,
  isStationOwner,
  type AuthState,
} from '../../qortium/auth';
import { AuthContext } from './authContext';

// ── Provider ──────────────────────────────────────────────────────

export function AuthProvider({
  children,
  stationOwnerAddress,
}: {
  children: ReactNode;
  /** Station owner address from station config — required for owner check */
  stationOwnerAddress?: string | null;
}) {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  const refresh = useCallback(() => {
    refreshAuth();
    setAuth({ status: 'loading' });
    resolveAuth().then(setAuth);
  }, []);

  useEffect(() => {
    resolveAuth().then(setAuth);

    const unlisten = listenForAccountChanges(() => {
      refreshAuth();
      resolveAuth().then(setAuth);
    });

    return unlisten;
  }, []);

  const userAddress = auth.status === 'authenticated' ? auth.address : null;

  const isOwner = isStationOwner(userAddress, stationOwnerAddress ?? null);

  return <AuthContext.Provider value={{ auth, isOwner, refresh }}>{children}</AuthContext.Provider>;
}
