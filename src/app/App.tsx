/* ============================================================
 * NodeFM Station — App Root
 *
 * Wraps providers + router.
 *
 * Phase 2: stationOwnerAddress is null (no Station config yet).
 * AuthProvider applies the Phase 2 bootstrap: the authenticated
 * Qortium selected account becomes the temporary owner.
 *
 * Phase 3: when Station config is published with a real
 * ownerAddress, pass it here and the bootstrap is replaced.
 * ============================================================ */

import { AppProviders } from './providers/AppProviders';
import { AppRouter } from './AppRouter';

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
