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
  // Station owner address will be resolved from station config in Phase 3.
  // For now, pass null — no one is owner until config exists.
  const stationOwnerAddress: string | null = null;

  return (
    <AppProviders stationOwnerAddress={stationOwnerAddress}>
      <AppRouter />
    </AppProviders>
  );
}
