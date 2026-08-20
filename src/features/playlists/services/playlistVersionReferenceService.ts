/* ============================================================
 * NodeFM Station — PlaylistVersion Reference Safety Service
 *
 * A PlaylistVersion is immutable schedule source material. Before an
 * admin can tombstone an old version, NodeFM must prove that no live
 * production structure still points at it.
 *
 * This service keeps that policy in production code rather than only
 * in the version-history UI.
 * ============================================================ */

import type {
  DynamicProgramOccurrence,
  Playlist,
  ScheduleEvent,
  ScheduleRecurrence,
  Station,
} from '../../../types/domain';
import { fetchQdnResourceData, searchQdnResources } from '../../../qortium/qdn';
import {
  deserializePlaylistFromQdn,
  getPlaylistQdnIdentifier,
  PLAYLIST_QDN_SERVICE,
} from './playlistService';
import {
  deserializeScheduleEventFromQdn,
  deserializeScheduleRecurrenceFromQdn,
  SCHEDULE_EVENT_IDENTIFIER_PREFIX,
  SCHEDULE_QDN_SERVICE,
} from '../../scheduling/services/scheduleService';
import {
  deserializeStationFromQdn,
  STATION_QDN_IDENTIFIER,
  STATION_QDN_SERVICE,
} from '../../station/services/stationService';
import {
  deserializeDynamicProgramOccurrenceFromQdn,
  REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX,
  REQUEST_SHOW_QDN_SERVICE,
} from '../../dynamic-programs/request-show/requestShowService';

export type PlaylistVersionReferenceKind =
  | 'latest-version'
  | 'schedule-event'
  | 'schedule-recurrence'
  | 'station-default-rotation'
  | 'dynamic-program-occurrence';

export type PlaylistVersionReference = {
  kind: PlaylistVersionReferenceKind;
  id: string;
  label: string;
};

export class PlaylistVersionReferencedError extends Error {
  readonly references: PlaylistVersionReference[];

  constructor(references: PlaylistVersionReference[]) {
    super(
      `Playlist version is still referenced by ${references.length} production resource(s): ${references
        .map((reference) => reference.label || reference.id)
        .join(', ')}.`,
    );
    this.name = 'PlaylistVersionReferencedError';
    this.references = references;
  }
}

function scheduleReferenceLabel(event: ScheduleEvent | ScheduleRecurrence): string {
  if (event.title?.trim()) {
    return event.title.trim();
  }

  return 'eventId' in event ? event.eventId : event.recurrenceId;
}

function occurrenceReferenceLabel(occurrence: DynamicProgramOccurrence): string {
  return `Request Show occurrence ${occurrence.scheduleEventId}`;
}

/**
 * Pure reference inventory against already-loaded production snapshots.
 * This is the source-of-truth policy; the async collector below only
 * populates these snapshots from QDN.
 */
export function findPlaylistVersionReferences(args: {
  versionId: string;
  playlists: readonly Playlist[];
  scheduleEvents: readonly ScheduleEvent[];
  scheduleRecurrences: readonly ScheduleRecurrence[];
  station?: Station | null;
  occurrences?: readonly DynamicProgramOccurrence[];
}): PlaylistVersionReference[] {
  const references: PlaylistVersionReference[] = [];

  for (const playlist of args.playlists) {
    if (playlist.latestVersionId === args.versionId) {
      references.push({
        kind: 'latest-version',
        id: playlist.playlistId,
        label: playlist.title,
      });
    }
  }

  for (const event of args.scheduleEvents) {
    if (event.source.type === 'playlist' && event.source.playlistVersionId === args.versionId) {
      references.push({
        kind: 'schedule-event',
        id: event.eventId,
        label: scheduleReferenceLabel(event),
      });
    }
  }

  for (const recurrence of args.scheduleRecurrences) {
    if (
      recurrence.source.type === 'playlist' &&
      recurrence.source.playlistVersionId === args.versionId
    ) {
      references.push({
        kind: 'schedule-recurrence',
        id: recurrence.recurrenceId,
        label: scheduleReferenceLabel(recurrence),
      });
    }
  }

  if (args.station?.defaultRotationPlaylistVersionId === args.versionId) {
    references.push({
      kind: 'station-default-rotation',
      id: args.station.stationId,
      label: `${args.station.name} default rotation`,
    });
  }

  for (const occurrence of args.occurrences ?? []) {
    const candidate = occurrence as unknown as { playlistVersionId?: unknown };
    if (candidate.playlistVersionId === args.versionId) {
      references.push({
        kind: 'dynamic-program-occurrence',
        id: occurrence.occurrenceId,
        label: occurrenceReferenceLabel(occurrence),
      });
    }
  }

  return references;
}

function isMissingResourceError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /does not exist|not found|not published|unavailable|empty payload/i.test(error.message)
  );
}

async function discoverIdentifiers(
  ownerName: string,
  service: string,
  prefix: string,
  limit = 1000,
): Promise<string[]> {
  const results = await searchQdnResources({
    service,
    name: ownerName,
    query: prefix,
    prefix: true,
    mode: 'ALL',
    limit,
    includeMetadata: true,
  });

  const seen = new Set<string>();
  const identifiers: string[] = [];

  for (const result of results) {
    if (!result.identifier || !result.identifier.startsWith(prefix)) continue;
    if (seen.has(result.identifier)) continue;
    seen.add(result.identifier);
    identifiers.push(result.identifier);
  }

  return identifiers;
}

async function collectPlaylists(ownerName: string): Promise<Playlist[]> {
  const identifiers = await discoverIdentifiers(
    ownerName,
    PLAYLIST_QDN_SERVICE,
    'nodefm-playlist-',
  );
  const playlists: Playlist[] = [];

  for (const identifier of identifiers) {
    // Skip immutable version resources, which share the same identifier prefix.
    if (identifier.startsWith('nodefm-playlist-version-')) continue;

    try {
      const payload = await fetchQdnResourceData({
        service: PLAYLIST_QDN_SERVICE,
        name: ownerName,
        identifier,
      });
      const playlist = deserializePlaylistFromQdn(payload);
      if (!playlist) {
        throw new Error(`Malformed playlist resource: ${identifier}`);
      }
      if (playlist.playlistId !== identifier.slice('nodefm-playlist-'.length)) continue;
      playlists.push(playlist);
    } catch (error) {
      if (!isMissingResourceError(error)) throw error;
    }
  }

  return playlists;
}

async function collectScheduleRecords(
  ownerName: string,
): Promise<{ events: ScheduleEvent[]; recurrences: ScheduleRecurrence[] }> {
  const identifiers = await discoverIdentifiers(
    ownerName,
    SCHEDULE_QDN_SERVICE,
    SCHEDULE_EVENT_IDENTIFIER_PREFIX,
  );
  const events: ScheduleEvent[] = [];
  const recurrences: ScheduleRecurrence[] = [];

  for (const identifier of identifiers) {
    let payload: unknown;

    try {
      payload = await fetchQdnResourceData({
        service: SCHEDULE_QDN_SERVICE,
        name: ownerName,
        identifier,
      });
    } catch (error) {
      if (isMissingResourceError(error)) continue;
      throw error;
    }

    if (identifier.startsWith('nodefm-schedule-recurrence-')) {
      const recurrence = deserializeScheduleRecurrenceFromQdn(payload);
      if (!recurrence) {
        throw new Error(`Malformed schedule recurrence resource: ${identifier}`);
      }
      recurrences.push(recurrence);
      continue;
    }

    const event = deserializeScheduleEventFromQdn(payload);
    if (!event) {
      throw new Error(`Malformed schedule event resource: ${identifier}`);
    }
    events.push(event);
  }

  return { events, recurrences };
}

async function collectStation(ownerName: string): Promise<Station | null> {
  try {
    const payload = await fetchQdnResourceData({
      service: STATION_QDN_SERVICE,
      name: ownerName,
      identifier: STATION_QDN_IDENTIFIER,
    });
    const parsed = deserializeStationFromQdn(payload);
    if (!parsed) {
      throw new Error('Invalid NodeFM station configuration payload.');
    }
    return parsed;
  } catch (error) {
    if (isMissingResourceError(error)) return null;
    throw error;
  }
}

async function collectOccurrences(ownerName: string): Promise<DynamicProgramOccurrence[]> {
  const identifiers = await discoverIdentifiers(
    ownerName,
    REQUEST_SHOW_QDN_SERVICE,
    REQUEST_SHOW_OCCURRENCE_IDENTIFIER_PREFIX,
  );
  const occurrences: DynamicProgramOccurrence[] = [];

  for (const identifier of identifiers) {
    let payload: unknown;

    try {
      payload = await fetchQdnResourceData({
        service: REQUEST_SHOW_QDN_SERVICE,
        name: ownerName,
        identifier,
      });
    } catch (error) {
      if (isMissingResourceError(error)) continue;
      throw error;
    }

    const occurrence = deserializeDynamicProgramOccurrenceFromQdn(payload);
    if (!occurrence) {
      throw new Error(`Malformed Request Show occurrence resource: ${identifier}`);
    }
    occurrences.push(occurrence);
  }

  return occurrences;
}

/**
 * Authoritative deletion check against current QDN state. This is used by
 * the production store before DELETE_QDN_RESOURCE is called for a version.
 */
export async function collectPlaylistVersionReferences(
  versionId: string,
  ownerName: string,
): Promise<PlaylistVersionReference[]> {
  const [playlists, schedule, station, occurrences] = await Promise.all([
    collectPlaylists(ownerName),
    collectScheduleRecords(ownerName),
    collectStation(ownerName),
    collectOccurrences(ownerName),
  ]);

  return findPlaylistVersionReferences({
    versionId,
    playlists,
    scheduleEvents: schedule.events,
    scheduleRecurrences: schedule.recurrences,
    station,
    occurrences,
  });
}

export function assertPlaylistVersionReferences(
  versionId: string,
  ownerName: string,
): Promise<void> {
  return collectPlaylistVersionReferences(versionId, ownerName).then((references) => {
    if (references.length > 0) {
      throw new PlaylistVersionReferencedError(references);
    }
  });
}

// Re-export the ID helper so the store never has to depend on internal QDN
// resource identity details just to build the reference error.
export { getPlaylistQdnIdentifier };
