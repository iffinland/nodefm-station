/* ============================================================
 * NodeFM Station — App Providers
 *
 * Composite provider wrapping all global context providers.
 * Order: Audio → Auth → Router
 * ============================================================ */

import { type ReactNode } from 'react';
import { AudioProvider } from '../../audio/AudioProvider';
import { AuthProvider } from './AuthProvider';
import { StationProvider } from '../../features/station/StationProvider';
import { LiveRadioPlayerProvider } from '../../features/radio/player';
import { TaxonomyProvider } from '../../features/taxonomy';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AudioProvider>
      <AuthProvider>
        <StationProvider>
          <TaxonomyProvider>
            <LiveRadioPlayerProvider>{children}</LiveRadioPlayerProvider>
          </TaxonomyProvider>
        </StationProvider>
      </AuthProvider>
    </AudioProvider>
  );
}
