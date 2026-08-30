// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, Outlet } from 'react-router-dom';
import { AppRouter } from '../app/AppRouter';

vi.mock('../qortium/bridge', () => ({
  getRouterBasename: () => '',
}));

vi.mock('../app/providers/authContext', () => ({
  useAuth: () => ({
    auth: {
      status: 'authenticated',
      address: 'Q-listener-a',
      name: 'listener-a',
    },
    ownerName: 'listener-a',
    refresh: () => {},
  }),
}));

vi.mock('../features/station', () => ({
  useStation: () => ({
    isOwner: false,
    station: null,
    publisherName: 'NodeFM',
    loading: false,
  }),
}));

vi.mock('../app/Layout', () => ({
  Layout: function Layout() {
    return (
      <div>
        <header>Station shell</header>
        <nav>
          <Link to="/my-playlists">My Playlists</Link>
          <Link to="/my-playlists/new">Create Playlist</Link>
        </nav>
        <main>
          <Outlet />
        </main>
      </div>
    );
  },
  default: function Layout() {
    return <div>Layout default</div>;
  },
}));

vi.mock('../app/AdminLayout', () => ({
  AdminLayout: function AdminLayout() {
    return <div>Admin layout</div>;
  },
  default: function AdminLayout() {
    return <div>Admin layout default</div>;
  },
}));

vi.mock('../pages/RadioPage', () => ({ default: () => <div>radio-page</div> }));
vi.mock('../pages/PlaylistsPage', () => ({ default: () => <div>playlists-page</div> }));
vi.mock('../pages/PlaylistDetailPage', () => ({
  default: () => <div>playlist-detail-page</div>,
}));
vi.mock('../pages/MyPlaylistsPage', () => ({ default: () => <div>my-playlists-page</div> }));
vi.mock('../pages/ListenerPlaylistEditorPage', () => ({
  default: () => <div>listener-create-editor</div>,
}));
vi.mock('../pages/ListenerPlaylistDetailPage', () => ({
  default: () => <div>listener-playlist-detail-page</div>,
}));
vi.mock('../pages/SubmitMusicPage', () => ({ default: () => <div>submit-music-page</div> }));
vi.mock('../pages/AboutPage', () => ({ default: () => <div>about-page</div> }));
vi.mock('../pages/admin/AdminDashboard', () => ({
  default: () => <div>admin-dashboard</div>,
}));
vi.mock('../pages/admin/LibraryPage', () => ({ default: () => <div>admin-library</div> }));
vi.mock('../pages/admin/PlaylistsAdminPage', () => ({
  default: () => <div>admin-playlists</div>,
}));
vi.mock('../pages/admin/PlaylistEditorPage', () => ({
  default: () => <div>admin-playlist-editor</div>,
}));
vi.mock('../pages/admin/AdminPlaylistSubmissionsPage', () => ({
  default: () => <div>admin-playlist-submissions</div>,
}));
vi.mock('../pages/admin/SchedulePage', () => ({ default: () => <div>admin-schedule</div> }));
vi.mock('../pages/admin/MessagesPage', () => ({ default: () => <div>admin-messages</div> }));
vi.mock('../pages/admin/StationSettingsPage', () => ({
  default: () => <div>admin-station-settings</div>,
}));

describe('listener playlist routing', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/my-playlists/new');
  });

  afterEach(() => {
    cleanup();
  });

  it('matches /my-playlists/new to the create editor, not the dynamic playlist ID route', async () => {
    render(<AppRouter />);

    expect(await screen.findByText('listener-create-editor')).toBeTruthy();
    expect(screen.getByText('Station shell')).toBeTruthy();
  });

  it('keeps navigation usable from create back to My Playlists', async () => {
    window.history.pushState({}, '', '/my-playlists');
    render(<AppRouter />);

    expect(await screen.findByText('my-playlists-page')).toBeTruthy();

    fireEvent.click(screen.getByText('Create Playlist'));
    expect(await screen.findByText('listener-create-editor')).toBeTruthy();

    fireEvent.click(screen.getByText('My Playlists'));
    expect(await screen.findByText('my-playlists-page')).toBeTruthy();
  });
});
