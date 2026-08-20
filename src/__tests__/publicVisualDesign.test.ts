/* ============================================================
 * NodeFM Station — Public Visual Design Smoke Test
 *
 * Keeps the Beta 8C public visual copy and state semantics
 * observable without snapshotting fragile CSS details.
 * ============================================================ */

import { describe, expect, it } from 'vitest';

const layoutSourceModule = import.meta.glob('../app/Layout.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const radioSourceModule = import.meta.glob('../pages/RadioPage.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const playlistsSourceModule = import.meta.glob('../pages/PlaylistsPage.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const detailSourceModule = import.meta.glob('../pages/PlaylistDetailPage.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const layoutSource = layoutSourceModule['../app/Layout.tsx'] as string;
const radioSource = radioSourceModule['../pages/RadioPage.tsx'] as string;
const playlistsSource = playlistsSourceModule['../pages/PlaylistsPage.tsx'] as string;
const detailSource = detailSourceModule['../pages/PlaylistDetailPage.tsx'] as string;

describe('NodeFM public visual copy', () => {
  it('uses AutoDJ-LIVE for the live listener-facing broadcast', () => {
    expect(layoutSource).toContain('AutoDJ-LIVE');
    expect(radioSource).toContain('AutoDJ-LIVE');
  });

  it('keeps the corrected Upcoming Schedule heading', () => {
    expect(radioSource).toContain('<h3>Upcoming Schedule</h3>');
  });
});

describe('NodeFM public interaction semantics', () => {
  it('exposes Like as an accessible toggle with distinct liked/unliked states', () => {
    expect(radioSource).toContain('button--like');
    expect(radioSource).toContain('button--liked');
    expect(radioSource).toContain('aria-pressed');
  });

  it('marks the currently playing playlist track', () => {
    expect(detailSource).toContain('playlist-detail__track--playing');
  });

  it('renders an understandable unavailable state for malformed playlists', () => {
    expect(playlistsSource).toContain('public-playlist-card--unavailable');
  });
});
