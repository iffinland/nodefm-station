import { describe, expect, it } from 'vitest';
import { DASHBOARD_QUICK_ACTIONS, getDashboardQuickActionHref } from './dashboardQuickActions';

describe('dashboard quick actions', () => {
  it('routes every action to an existing Admin workflow URL', () => {
    expect(DASHBOARD_QUICK_ACTIONS).toHaveLength(3);
    expect(DASHBOARD_QUICK_ACTIONS.map((action) => action.id)).toEqual([
      'add-track',
      'create-playlist',
      'schedule-playlist',
    ]);

    expect(getDashboardQuickActionHref(DASHBOARD_QUICK_ACTIONS[0])).toBe(
      '/admin/library?action=upload',
    );
    expect(getDashboardQuickActionHref(DASHBOARD_QUICK_ACTIONS[1])).toBe(
      '/admin/playlists?action=create',
    );
    expect(getDashboardQuickActionHref(DASHBOARD_QUICK_ACTIONS[2])).toBe(
      '/admin/schedule?action=create',
    );
  });

  it('does not introduce duplicate dashboard-only actions', () => {
    const ids = new Set(DASHBOARD_QUICK_ACTIONS.map((action) => action.id));
    expect(ids.size).toBe(DASHBOARD_QUICK_ACTIONS.length);
  });
});

describe('quick action destination pages consume the shared action parameter', () => {
  const pageModules = import.meta.glob(
    [
      '../../pages/admin/LibraryPage.tsx',
      '../../pages/admin/PlaylistsAdminPage.tsx',
      '../../pages/admin/SchedulePage.tsx',
    ],
    {
      query: '?raw',
      import: 'default',
      eager: true,
    },
  );

  it('does not add separate dashboard-only workflow implementations', () => {
    const sources = Object.values(pageModules) as string[];

    expect(sources.length).toBe(3);
    for (const source of sources) {
      expect(source).toContain('useSearchParams');
      expect(source).toContain('action');
    }
  });
});
