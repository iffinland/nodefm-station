/* ============================================================
 * NodeFM Station — Station Config Domain Service
 *
 * Pure validation/serialization/creation helpers for the
 * published Station resource. The actual QDN bridge remains
 * isolated in the store below.
 * ============================================================ */

import type { Station } from '../../../types/domain';
import { generateId } from '../../../utils/id';
import { isRecord } from '../../../utils/record';
import { isNonEmptyTrimmedString } from '../../../utils/validation';

export const STATION_QDN_SERVICE = 'JSON';
export const STATION_QDN_IDENTIFIER = 'nodefm-station-config';

export type CreateStationInput = {
  name: string;
  description?: string;
  ownerAddress: string;
  ownerName: string;
  timezone: string;
  defaultRotationPlaylistId: string;
  defaultRotationPlaylistVersionId: string;
  stationEpochUtc: string;
  messagingEnabled: boolean;
  tipsEnabled: boolean;
};

export type EditStationInput = Partial<
  Pick<
    Station,
    | 'name'
    | 'description'
    | 'timezone'
    | 'defaultRotationPlaylistId'
    | 'defaultRotationPlaylistVersionId'
    | 'stationEpochUtc'
    | 'messagingEnabled'
    | 'tipsEnabled'
  >
>;

export type StationSaveInput =
  Omit<CreateStationInput, 'ownerAddress' | 'ownerName'> | EditStationInput;

export function getStationQdnIdentifier(): string {
  return STATION_QDN_IDENTIFIER;
}

export function isValidUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.trim()) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isStationConfigRecord(value: unknown): value is Station {
  if (!isRecord(value)) {
    return false;
  }

  const candidate = value as unknown as Station;

  return (
    typeof candidate.stationId === 'string' &&
    candidate.stationId.trim() !== '' &&
    isNonEmptyTrimmedString(candidate.name) &&
    isNonEmptyTrimmedString(candidate.ownerAddress) &&
    isNonEmptyTrimmedString(candidate.timezone) &&
    isNonEmptyTrimmedString(candidate.defaultRotationPlaylistId) &&
    isNonEmptyTrimmedString(candidate.defaultRotationPlaylistVersionId) &&
    isValidUtcTimestamp(candidate.stationEpochUtc) &&
    typeof candidate.messagingEnabled === 'boolean' &&
    typeof candidate.tipsEnabled === 'boolean' &&
    (candidate.ownerName === undefined || typeof candidate.ownerName === 'string') &&
    (candidate.description === undefined || typeof candidate.description === 'string')
  );
}

export function createStation(input: CreateStationInput): Station {
  if (!isNonEmptyTrimmedString(input.name)) {
    throw new Error('Station name must be a non-empty string.');
  }

  if (!isNonEmptyTrimmedString(input.ownerAddress)) {
    throw new Error('Station owner address is required.');
  }

  if (!isNonEmptyTrimmedString(input.ownerName)) {
    throw new Error('Station publisher name is required.');
  }

  if (!isNonEmptyTrimmedString(input.timezone)) {
    throw new Error('Station timezone is required.');
  }

  if (!isNonEmptyTrimmedString(input.defaultRotationPlaylistId)) {
    throw new Error('Default rotation playlist is required.');
  }

  if (!isNonEmptyTrimmedString(input.defaultRotationPlaylistVersionId)) {
    throw new Error('Default rotation playlist version is required.');
  }

  if (!isValidUtcTimestamp(input.stationEpochUtc)) {
    throw new Error('Station epoch must be a valid UTC timestamp.');
  }

  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    stationId: generateId(),
    name: input.name.trim(),
    description: input.description,
    ownerName: input.ownerName.trim(),
    ownerAddress: input.ownerAddress,
    timezone: input.timezone.trim(),
    defaultRotationPlaylistId: input.defaultRotationPlaylistId.trim(),
    defaultRotationPlaylistVersionId: input.defaultRotationPlaylistVersionId.trim(),
    stationEpochUtc: input.stationEpochUtc,
    messagingEnabled: input.messagingEnabled,
    tipsEnabled: input.tipsEnabled,
    createdAt: now,
    updatedAt: now,
  };
}

export function editStation(station: Station, input: EditStationInput): Station {
  if (input.name !== undefined && !isNonEmptyTrimmedString(input.name)) {
    throw new Error('Station name must be a non-empty string.');
  }

  if (input.timezone !== undefined && !isNonEmptyTrimmedString(input.timezone)) {
    throw new Error('Station timezone is required.');
  }

  if (
    input.defaultRotationPlaylistId !== undefined &&
    !isNonEmptyTrimmedString(input.defaultRotationPlaylistId)
  ) {
    throw new Error('Default rotation playlist is required.');
  }

  if (
    input.defaultRotationPlaylistVersionId !== undefined &&
    !isNonEmptyTrimmedString(input.defaultRotationPlaylistVersionId)
  ) {
    throw new Error('Default rotation playlist version is required.');
  }

  if (input.stationEpochUtc !== undefined && !isValidUtcTimestamp(input.stationEpochUtc)) {
    throw new Error('Station epoch must be a valid UTC timestamp.');
  }

  return {
    ...station,
    ...input,
    name: input.name !== undefined ? input.name.trim() : station.name,
    timezone: input.timezone !== undefined ? input.timezone.trim() : station.timezone,
    defaultRotationPlaylistId:
      input.defaultRotationPlaylistId !== undefined
        ? input.defaultRotationPlaylistId.trim()
        : station.defaultRotationPlaylistId,
    defaultRotationPlaylistVersionId:
      input.defaultRotationPlaylistVersionId !== undefined
        ? input.defaultRotationPlaylistVersionId.trim()
        : station.defaultRotationPlaylistVersionId,
    updatedAt: new Date().toISOString(),
  };
}

export function serializeStationForQdn(station: Station): string {
  return JSON.stringify(station);
}

export function deserializeStationFromQdn(value: unknown): Station | null {
  if (!isRecord(value)) {
    return null;
  }

  const parsed = value as unknown as Station;

  if (!isStationConfigRecord(parsed)) {
    return null;
  }

  return parsed;
}
