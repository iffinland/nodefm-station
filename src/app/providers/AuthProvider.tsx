/* ============================================================
 * NodeFM Station — Auth Provider
 *
 * React context for authentication state.
 * Wraps Qortium bridge auth and provides user identity
 * plus owner/admin authorization checks.
 *
 * ── Phase 2 Temporary Owner Bootstrap ──
 *
 * Before Phase 3 Station config exists, there is no canonical
 * `ownerAddress`.  During this window the authenticated Qortium
 * selected account is treated as the bootstrap station owner so
 * that Phase 2 admin functionality (library, playlists, upload)
 * can be exercised.
 *
 * Once Phase 3 publishes a Station config resource with a real
 * `ownerAddress`, that value becomes authoritative and the
 * bootstrap fallback is automatically replaced because
 * `stationOwnerAddress` will no longer be null.
 *
 * This is NOT a hardcoded wallet address — it uses the live
 * Qortium selected account.  The bootstrap is clearly gated on
 * `stationOwnerAddress === null` and is separate from the
 * authoritative Phase 3 path.
 * ============================================================ */

import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
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
  const authEpochRef = useRef(0);

  const loadAuth = useCallback(() => {
    const epoch = authEpochRef.current + 1;
    authEpochRef.current = epoch;

    refreshAuth();
    setAuth({ status: 'loading' });
    resolveAuth().then((state) => {
      if (authEpochRef.current === epoch) {
        setAuth(state);
      }
    });
  }, []);

  useEffect(() => {
    loadAuth();

    const unlisten = listenForAccountChanges(loadAuth);

    return unlisten;
  }, [loadAuth]);

  const userAddress = auth.status === 'authenticated' ? auth.address : null;
  const ownerName = auth.status === 'authenticated' ? (auth.name ?? null) : null;

  // ── Phase 2 bootstrap: when no station config exists yet, treat the
  //     authenticated user as the bootstrap owner.  Once Phase 3 Station
  //     config provides a real ownerAddress, this fallback is bypassed.
  const effectiveOwnerAddress = stationOwnerAddress ?? userAddress;

  const isOwner = isStationOwner(userAddress, effectiveOwnerAddress);

  return (
    <AuthContext.Provider value={{ auth, isOwner, ownerName, refresh: loadAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
