/* ============================================================
 * NodeFM Station — Station Config Store
 *
 * QDN-backed singleton Station resource store. The station is
 * discovered by a stable NodeFM identifier and is used by both
 * public listeners and the owner/admin surfaces.
 * ============================================================ */

import type { Station } from '../../../types/domain';
import { fetchQdnResourceData, publishResource, searchQdnResources } from '../../../qortium/qdn';
import { NODEFM_APP_NAME } from '../../../qortium/navigation';
import {
  STATION_QDN_IDENTIFIER,
  STATION_QDN_SERVICE,
  deserializeStationFromQdn,
  serializeStationForQdn,
} from './stationService';

type StationListener = () => void;

let station: Station | null = null;
let stationLoaded = false;
let stationLoading = false;
let stationError: string | null = null;
let stationPublisherName: string | null = null;
let stationLoadKey: string | null = null;
let stationEpoch = 0;

const listeners = new Set<StationListener>();

function notify() {
  listeners.forEach((listener) => listener());
}

function stationLoadKeyFor(preferredName: string | null): string {
  return preferredName ?? '<global>';
}

// ── Public state accessors ─────────────────────────────────────────

export function subscribeToStationStore(listener: StationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getStation(): Station | null {
  return station;
}

export function getStationLoaded(): boolean {
  return stationLoaded;
}

export function getStationLoading(): boolean {
  return stationLoading;
}

export function getStationError(): string | null {
  return stationError;
}

export function getStationPublisherName(): string | null {
  return stationPublisherName;
}

export type StationLoadAction = 'reuse' | 'load';

export function getStationLoadAction(preferredName: string | null): StationLoadAction {
  const nextKey = stationLoadKeyFor(preferredName);

  if (!preferredName && stationLoadKey === '<global>' && (stationLoaded || stationLoading)) {
    return 'reuse';
  }

  if (preferredName && stationLoadKey === nextKey && (stationLoaded || stationLoading)) {
    return 'reuse';
  }

  return preferredName ? 'load' : stationLoadKey ? 'load' : 'load';
}

// ── QDN load/publish ───────────────────────────────────────────────

async function loadFromReference(name: string): Promise<Station | null> {
  const payload = await fetchQdnResourceData({
    service: STATION_QDN_SERVICE,
    name,
    identifier: STATION_QDN_IDENTIFIER,
  });

  const parsed = deserializeStationFromQdn(payload);

  if (!parsed) {
    throw new Error('Invalid NodeFM station configuration payload.');
  }

  return parsed;
}

export async function loadStationConfig(preferredName: string | null = null): Promise<void> {
  if (stationLoaded || stationLoading) {
    return;
  }

  const targetKey = stationLoadKeyFor(preferredName);
  const epoch = stationEpoch;

  stationLoadKey = targetKey;
  stationLoading = true;
  stationError = null;
  notify();

  try {
    let resolvedStation: Station | null = null;
    let resolvedPublisherName: string | null = null;

    // Fast path: if the selected account has a registered Qortium name,
    // try the canonical station identifier under that name first.
    if (preferredName) {
      try {
        const payload = await fetchQdnResourceData({
          service: STATION_QDN_SERVICE,
          name: preferredName,
          identifier: STATION_QDN_IDENTIFIER,
        });
        const parsed = deserializeStationFromQdn(payload);

        if (!parsed) {
          throw new Error('Invalid NodeFM station configuration payload.');
        }

        resolvedStation = parsed;
        resolvedPublisherName = preferredName;
      } catch (error) {
        if (error instanceof Error && /Invalid NodeFM station configuration/i.test(error.message)) {
          throw error;
        }

        // Fall through to global discovery; this is a normal bootstrap
        // case for a listener whose selected account differs from the
        // station publisher.
      }
    }

    if (!resolvedStation) {
      const results = await searchQdnResources({
        service: STATION_QDN_SERVICE,
        query: STATION_QDN_IDENTIFIER,
        prefix: true,
        mode: 'ALL',
        limit: 20,
        includeMetadata: true,
      });

      const uniqueMatches = new Map<string, (typeof results)[number]>();

      for (const result of results) {
        if (
          result.identifier !== STATION_QDN_IDENTIFIER ||
          !result.name ||
          result.name !== NODEFM_APP_NAME
        ) {
          continue;
        }

        uniqueMatches.set(`${result.name}\u0000${result.identifier}`, result);
      }

      const matches = [...uniqueMatches.values()];

      if (matches.length > 1) {
        throw new Error(
          `Ambiguous station configuration: ${matches.length} NodeFM station resources were found.`,
        );
      }

      if (matches.length === 1) {
        const match = matches[0];
        resolvedStation = await loadFromReference(match.name);
        resolvedPublisherName = match.name;
      }
    }

    if (epoch !== stationEpoch || stationLoadKey !== targetKey) {
      return;
    }

    station = resolvedStation;
    stationPublisherName = resolvedStation?.publisherName?.trim() || resolvedPublisherName || null;
    stationLoaded = true;
  } catch (error) {
    if (epoch !== stationEpoch || stationLoadKey !== targetKey) {
      return;
    }

    stationError = error instanceof Error ? error.message : 'Failed to load station configuration.';
  } finally {
    if (epoch === stationEpoch) {
      stationLoading = false;
      notify();
    }
  }
}

export async function saveStationConfig(
  nextStation: Station,
  publisherName: string,
): Promise<Station> {
  const json = serializeStationForQdn(nextStation);
  const data64 = btoa(unescape(encodeURIComponent(json)));

  await publishResource({
    service: STATION_QDN_SERVICE,
    name: publisherName,
    identifier: STATION_QDN_IDENTIFIER,
    data64,
    title: nextStation.name,
    description: nextStation.description,
  });

  station = nextStation;
  stationPublisherName = publisherName;
  stationLoaded = true;
  stationError = null;
  notify();
  return nextStation;
}

export function resetStationStore(): void {
  station = null;
  stationLoaded = false;
  stationLoading = false;
  stationError = null;
  stationPublisherName = null;
  stationLoadKey = null;
  stationEpoch += 1;
  notify();
}
