/* ============================================================
 * NodeFM Station — Station Epoch Presentation Safety Tests
 *
 * The AutoDJ timeline start is a deterministic anchor. This test
 * keeps the renamed admin copy observable and proves that display
 * edits preserve the stored `stationEpochUtc` value exactly.
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import { createStation, editStation } from '../features/station/services/stationService';

const settingsSourceModule = import.meta.glob('../pages/admin/StationSettingsPage.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const settingsSource = settingsSourceModule['../pages/admin/StationSettingsPage.tsx'] as string;

function station() {
  return createStation({
    name: 'NodeFM',
    publisherName: 'Owner',
    ownerAddress: 'Q-owner',
    ownerName: 'Owner',
    timezone: 'Europe/Helsinki',
    defaultRotationPlaylistId: 'playlist-1',
    defaultRotationPlaylistVersionId: 'version-1',
    stationEpochUtc: '2026-01-01T00:00:00.000Z',
    messagingEnabled: false,
    tipsEnabled: false,
  });
}

describe('station epoch admin copy', () => {
  it('replaces the misleading local-time label with AutoDJ timeline start', () => {
    expect(settingsSource).toContain('AutoDJ timeline start');
    expect(settingsSource).not.toContain('Station epoch (local time)');
  });

  it('explains that the value is normally set once', () => {
    expect(settingsSource).toContain('Base reference time used to calculate deterministic AutoDJ');
    expect(settingsSource).toContain('Normally set once');
  });

  it('names the configured station timezone next to the field', () => {
    expect(settingsSource).toContain('Station time:');
  });
});

describe('station epoch storage semantics', () => {
  it('preserves the exact epoch value through a display-only station edit', () => {
    const original = station();
    const edited = editStation(original, { name: 'NodeFM Updated' });

    expect(edited.stationEpochUtc).toBe(original.stationEpochUtc);
    expect(edited.name).toBe('NodeFM Updated');
  });

  it('does not reset an existing epoch merely because another field changes', () => {
    const original = station();
    const edited = editStation(original, { timezone: 'Europe/Tallinn' });

    expect(edited.stationEpochUtc).toBe(original.stationEpochUtc);
    expect(edited.timezone).toBe('Europe/Tallinn');
  });

  it('keeps a newly-created epoch byte-for-byte as authored', () => {
    const created = station();
    expect(created.stationEpochUtc).toBe('2026-01-01T00:00:00.000Z');
  });
});
