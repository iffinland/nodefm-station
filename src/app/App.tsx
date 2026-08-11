/* ============================================================
 * NodeFM Station — App Root
 *
 * Wraps providers + router.
 * The station owner address is resolved from station config.
 * In Phase 1, it's null until config is published (Phase 3).
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
