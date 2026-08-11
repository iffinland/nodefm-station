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
  /** True when the authenticated user is the station owner */
  isOwner: boolean;
  refresh: () => void;
};

export const AuthContext = createContext<AuthContextValue>({
  auth: { status: 'loading' },
  isOwner: false,
  refresh: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
