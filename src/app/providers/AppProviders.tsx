/* ============================================================
 * NodeFM Station — App Providers
 *
 * Composite provider wrapping all global context providers.
 * Order: Audio → Auth → Router
 * ============================================================ */

import { type ReactNode } from 'react';
import { AudioProvider } from '../../audio/AudioProvider';
import { AuthProvider } from './AuthProvider';

type AppProvidersProps = {
  children: ReactNode;
  stationOwnerAddress?: string | null;
};

export function AppProviders({ children, stationOwnerAddress }: AppProvidersProps) {
  return (
    <AudioProvider>
      <AuthProvider stationOwnerAddress={stationOwnerAddress}>{children}</AuthProvider>
    </AudioProvider>
  );
}
