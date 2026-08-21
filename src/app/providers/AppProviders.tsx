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
import { MetadataIntelligenceProvider } from '../../features/metadata-intelligence';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AudioProvider>
      <AuthProvider>
        <StationProvider>
          <TaxonomyProvider>
            <MetadataIntelligenceProvider>
              <LiveRadioPlayerProvider>{children}</LiveRadioPlayerProvider>
            </MetadataIntelligenceProvider>
          </TaxonomyProvider>
        </StationProvider>
      </AuthProvider>
    </AudioProvider>
  );
}
