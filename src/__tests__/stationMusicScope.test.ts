/* ============================================================
 * NodeFM Station — Station Music Scope Tests
 *
 * Backward-compatible optional station programming metadata.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  createStation,
  deserializeStationFromQdn,
  editStation,
  isStationMusicScope,
} from '../features/station/services/stationService';

function stationPayload(musicScope?: unknown) {
  return {
    schemaVersion: 1,
    stationId: 'station-1',
    name: 'NodeFM',
    publisherName: 'Owner',
    ownerAddress: 'Q-owner',
    timezone: 'Europe/Helsinki',
    defaultRotationPlaylistId: 'playlist-1',
    defaultRotationPlaylistVersionId: 'version-1',
    stationEpochUtc: '2026-01-01T00:00:00.000Z',
    messagingEnabled: false,
    tipsEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(musicScope === undefined ? {} : { musicScope }),
  };
}

describe('station musicScope domain validation', () => {
  it('loads legacy StationConfig without musicScope', () => {
    const station = deserializeStationFromQdn(stationPayload());
    expect(station).not.toBeNull();
    expect(station?.musicScope).toBeUndefined();
  });

  it.each(['INTERNATIONAL', 'REGIONAL', 'MIXED'] as const)('round-trips %s', (musicScope) => {
    const station = deserializeStationFromQdn(stationPayload(musicScope));
    expect(station?.musicScope).toBe(musicScope);
  });

  it('rejects an invalid persisted value using existing config validation style', () => {
    expect(isStationMusicScope('INTERNATIONAL')).toBe(true);
    expect(isStationMusicScope('FUTURE_VALUE')).toBe(false);
    expect(deserializeStationFromQdn(stationPayload('FUTURE_VALUE'))).toBeNull();
  });

  it('preserves legacy records through create/edit without forcing a rewrite', () => {
    const legacy = deserializeStationFromQdn(stationPayload())!;
    const edited = editStation(legacy, { name: 'Updated NodeFM' });
    expect(edited.musicScope).toBeUndefined();
  });

  it('persists an explicit admin selection only when provided', () => {
    const created = createStation({
      name: 'NodeFM',
      publisherName: 'Owner',
      ownerAddress: 'Q-owner',
      timezone: 'Europe/Helsinki',
      defaultRotationPlaylistId: 'playlist-1',
      defaultRotationPlaylistVersionId: 'version-1',
      stationEpochUtc: '2026-01-01T00:00:00.000Z',
      messagingEnabled: false,
      tipsEnabled: false,
      musicScope: 'INTERNATIONAL',
    });

    expect(created.musicScope).toBe('INTERNATIONAL');

    const edited = editStation(created, { musicScope: 'MIXED' });
    expect(edited.musicScope).toBe('MIXED');
  });

  it('does not infer scope when no selection is provided', () => {
    const created = createStation({
      name: 'NodeFM',
      publisherName: 'Owner',
      ownerAddress: 'Q-owner',
      timezone: 'Europe/Helsinki',
      defaultRotationPlaylistId: 'playlist-1',
      defaultRotationPlaylistVersionId: 'version-1',
      stationEpochUtc: '2026-01-01T00:00:00.000Z',
      messagingEnabled: false,
      tipsEnabled: false,
    });

    expect(created.musicScope).toBeUndefined();
  });
});
