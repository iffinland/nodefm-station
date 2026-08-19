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

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AudioProvider>
      <AuthProvider>
        <StationProvider>
          <LiveRadioPlayerProvider>{children}</LiveRadioPlayerProvider>
        </StationProvider>
      </AuthProvider>
    </AudioProvider>
  );
}
