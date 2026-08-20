/* ============================================================
 * NodeFM Station — Station Identity Hook
 *
 * Centralizes the station owner's QDN publisher name and owner
 * address for owner-only write flows. The publisher name is the
 * canonical NodeFM APP name when no Station config exists yet
 * (fresh bootstrap), and the configured `station.publisherName`
 * once the config is available. It is never derived from the
 * selected account's primary name.
 * ============================================================ */

import { useAuth } from '../../app/providers/authContext';
import { NODEFM_APP_NAME } from '../../qortium/navigation';
import { useStation } from './stationContext';

export type StationIdentity = {
  ownerAddress: string | null;
  publisherName: string | null;
};

export function useStationIdentity(): StationIdentity {
  const { auth } = useAuth();
  const { station, publisherName: configuredPublisher } = useStation();
  const userAddress = auth.status === 'authenticated' ? auth.address : null;

  const ownerAddress = station?.ownerAddress?.trim() || userAddress;
  const publisherName =
    station?.publisherName?.trim() ||
    configuredPublisher?.trim() ||
    (userAddress ? NODEFM_APP_NAME : null);

  return { ownerAddress, publisherName };
}
