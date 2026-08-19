/* ============================================================
 * NodeFM Station — Radio Timeline Data Store
 *
 * Loads the immutable data needed by the pure timeline engine:
 * default/scheduled playlist versions, dynamic occurrences, and
 * track metadata. Schedule events are intentionally separate;
 * Phase 3 supplies an empty concrete-event list until Phase 4
 * publishes scheduler resources.
 * ============================================================ */

import type {
  DynamicProgramOccurrence,
  PlaylistVersion,
  ScheduleEvent,
  Station,
  Track,
} from '../../../types/domain';
import { fetchQdnResourceData } from '../../../qortium/qdn';
import {
  deserializePlaylistVersionFromQdn,
  getPlaylistVersionQdnIdentifier,
} from '../../playlists/services/playlistService';
import { deserializeTrackFromQdn, getTrackQdnIdentifier } from '../../tracks/services/trackService';
import { isValidPlaylistVersionRecord } from './timelineMath';
import { loadScheduleEventsForPublisher } from '../../scheduling/services/scheduleStore';
import { loadRequestShowOccurrencesForPublisher } from '../../dynamic-programs/request-show/requestShowStore';

export type RadioTimelineData = {
  station: Station;
  scheduleEvents: ScheduleEvent[];
  playlistVersions: Record<string, PlaylistVersion>;
  dynamicOccurrences: Record<string, DynamicProgramOccurrence>;
  tracks: Record<string, Track>;
};

type DataListener = () => void;

let timelineData: RadioTimelineData | null = null;
let dataLoaded = false;
let dataLoading = false;
let dataError: string | null = null;
let dataLoadKey: string | null = null;
let dataEpoch = 0;

const listeners = new Set<DataListener>();

function notify() {
  listeners.forEach((listener) => listener());
}

function dataKey(station: Station, publisherName: string): string {
  return [
    station.stationId,
    publisherName,
    station.defaultRotationPlaylistId,
    station.defaultRotationPlaylistVersionId,
    station.stationEpochUtc,
    station.updatedAt,
  ].join('\u0000');
}

export function subscribeToRadioTimelineData(listener: DataListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRadioTimelineData(): RadioTimelineData | null {
  return timelineData;
}

export function getRadioTimelineDataLoaded(): boolean {
  return dataLoaded;
}

export function getRadioTimelineDataLoading(): boolean {
  return dataLoading;
}

export function getRadioTimelineDataError(): string | null {
  return dataError;
}

export function getRadioTimelineDataLoadKey(): string | null {
  return dataLoadKey;
}

export function isRadioTimelineDataCurrent(station: Station, publisherName: string): boolean {
  return dataLoaded && dataLoadKey === dataKey(station, publisherName);
}

function requireVersion(value: unknown, versionId: string): PlaylistVersion {
  const version = deserializePlaylistVersionFromQdn(value);

  if (!version || version.versionId !== versionId || !isValidPlaylistVersionRecord(version)) {
    throw new Error(`Invalid or unavailable playlist version: ${versionId}`);
  }

  return version;
}

function requireTrack(value: unknown, trackId: string): Track {
  const track = deserializeTrackFromQdn(value);

  if (!track || track.trackId !== trackId) {
    throw new Error(`Invalid or unavailable track metadata: ${trackId}`);
  }

  return track;
}

async function fetchRecord(ref: {
  service: string;
  name: string;
  identifier: string;
}): Promise<unknown> {
  return fetchQdnResourceData(ref);
}

export async function loadRadioTimelineData(
  station: Station,
  publisherName: string,
): Promise<void> {
  if (dataLoaded || dataLoading) {
    return;
  }

  const targetKey = dataKey(station, publisherName);
  const epoch = dataEpoch;

  dataLoadKey = targetKey;
  dataLoading = true;
  dataError = null;
  notify();

  try {
    const playlistVersions: Record<string, PlaylistVersion> = {};
    const tracks: Record<string, Track> = {};
    const dynamicOccurrences: Record<string, DynamicProgramOccurrence> = {};
    const versionIds = new Set<string>([station.defaultRotationPlaylistVersionId]);

    const scheduleEvents = await loadScheduleEventsForPublisher(publisherName);
    for (const event of scheduleEvents) {
      if (event.source.type === 'playlist') {
        versionIds.add(event.source.playlistVersionId);
      }
    }

    const occurrenceRecords = await loadRequestShowOccurrencesForPublisher(publisherName);
    for (const occurrence of occurrenceRecords) {
      if (dynamicOccurrences[occurrence.occurrenceId]) {
        throw new Error(`Duplicate Request Show occurrence: ${occurrence.occurrenceId}`);
      }

      dynamicOccurrences[occurrence.occurrenceId] = occurrence;
    }

    for (const versionId of versionIds) {
      const payload = await fetchRecord({
        service: 'JSON',
        name: publisherName,
        identifier: getPlaylistVersionQdnIdentifier(versionId),
      });
      const version = requireVersion(payload, versionId);
      playlistVersions[versionId] = version;
    }

    const trackIds = new Set<string>();
    for (const version of Object.values(playlistVersions)) {
      for (const track of version.tracks) {
        trackIds.add(track.trackId);
      }
    }
    for (const occurrence of Object.values(dynamicOccurrences)) {
      for (const track of occurrence.tracks) {
        trackIds.add(track.trackId);
      }
    }

    for (const trackId of trackIds) {
      const payload = await fetchRecord({
        service: 'JSON',
        name: publisherName,
        identifier: getTrackQdnIdentifier(trackId),
      });
      const track = requireTrack(payload, trackId);
      tracks[trackId] = track;
    }

    if (epoch !== dataEpoch || dataLoadKey !== targetKey) {
      return;
    }

    timelineData = {
      station,
      scheduleEvents,
      playlistVersions,
      dynamicOccurrences,
      tracks,
    };
    dataLoaded = true;
  } catch (error) {
    if (epoch !== dataEpoch || dataLoadKey !== targetKey) {
      return;
    }

    dataError = error instanceof Error ? error.message : 'Failed to load radio timeline data.';
  } finally {
    if (epoch === dataEpoch) {
      dataLoading = false;
      notify();
    }
  }
}

export function resetRadioTimelineData(): void {
  timelineData = null;
  dataLoaded = false;
  dataLoading = false;
  dataError = null;
  dataLoadKey = null;
  dataEpoch += 1;
  notify();
}
