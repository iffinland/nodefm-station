/* ============================================================
 * NodeFM Station — Auth Context & Hook
 *
 * Auth context and consumer hook.
 * Separated from AuthProvider to satisfy react-refresh
 * single-component-export rule.
 * ============================================================ */

import { createContext, useContext } from 'react';
import type { AuthState } from '../../qortium/auth';

export type AuthContextValue = {
  auth: AuthState;
  /**
   * The authenticated account's registered Qortium name (primary name), if
   * any. This is the acting listener/owner identity, not the canonical
   * NodeFM station publisher. Station-owned writes derive their publisher
   * from the Station config instead.
   */
  ownerName: string | null;
  refresh: () => void;
};

export const AuthContext = createContext<AuthContextValue>({
  auth: { status: 'loading' },
  ownerName: null,
  refresh: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
