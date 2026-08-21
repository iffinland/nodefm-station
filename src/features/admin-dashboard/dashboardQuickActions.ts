/* ============================================================
 * NodeFM Station — Admin Dashboard Quick Actions
 *
 * Central definitions for the dashboard's existing Admin workflow
 * entry points. Each action is an ordinary React Router Link to a
 * real Admin route with a query parameter that opens the existing
 * feature flow rather than a dashboard-only duplicate.
 * ============================================================ */

export type DashboardQuickAction = {
  id: 'add-track' | 'create-playlist' | 'schedule-playlist';
  label: string;
  to: string;
  searchParams: URLSearchParams;
};

export const DASHBOARD_QUICK_ACTIONS: readonly DashboardQuickAction[] = [
  {
    id: 'add-track',
    label: 'Add Track',
    to: '/admin/library',
    searchParams: new URLSearchParams({ action: 'upload' }),
  },
  {
    id: 'create-playlist',
    label: 'Create Playlist',
    to: '/admin/playlists',
    searchParams: new URLSearchParams({ action: 'create' }),
  },
  {
    id: 'schedule-playlist',
    label: 'Schedule Playlist',
    to: '/admin/schedule',
    searchParams: new URLSearchParams({ action: 'create' }),
  },
];

export function getDashboardQuickActionHref(action: DashboardQuickAction): string {
  return `${action.to}?${action.searchParams.toString()}`;
}
