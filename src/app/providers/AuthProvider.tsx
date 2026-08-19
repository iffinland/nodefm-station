/* ============================================================
 * NodeFM Station — Auth Provider
 *
 * React context for authentication state.
 * Wraps Qortium bridge auth and provides user identity.
 * Station ownership/admin authorization lives in StationProvider.
 * ============================================================ */

import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import {
  resolveAuth,
  refreshAuth,
  listenForAccountChanges,
  type AuthState,
} from '../../qortium/auth';
import { AuthContext } from './authContext';

// ── Provider ──────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
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

  const ownerName = auth.status === 'authenticated' ? (auth.name ?? null) : null;

  return (
    <AuthContext.Provider value={{ auth, ownerName, refresh: loadAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
