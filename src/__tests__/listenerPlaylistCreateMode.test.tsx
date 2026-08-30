// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../app/providers/authContext';
import ListenerPlaylistEditorPage from '../pages/ListenerPlaylistEditorPage';
import type { ListenerPlaylistDraft } from '../features/listener-playlists/services/listenerPlaylistService';

vi.mock('../app/providers/authContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../features/station', () => ({
  useStation: () => ({
    publisherName: 'NodeFM',
    station: null,
    loading: false,
  }),
}));

vi.mock('../hooks/useLibrary', () => ({
  useLibrary: () => ({
    tracks: [],
    loading: false,
    loaded: true,
    error: null,
    incomplete: false,
    diagnostics: [],
  }),
}));

vi.mock('../features/tracks', () => {
  const noop = () => {};

  return {
    TrackFilterBar: () => null,
    TrackMetadataLine: () => null,
    TrackPrimaryLine: () => null,
    useTrackFiltering: () => ({
      filters: {},
      sort: 'title',
      options: [],
      visibleTracks: [],
      setFilter: noop,
      setSort: noop,
      clearFilters: noop,
      resetAll: noop,
    }),
  };
});

const emptyDraft: ListenerPlaylistDraft = {
  playlistId: 'stable-create-id',
  title: '',
  description: undefined,
  ownerName: 'listener-a',
  ownerAddress: 'Q-listener-a',
  entries: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('../features/listener-playlists', () => ({
  useListenerPlaylists: () => ({
    playlists: [],
    loaded: true,
    loading: false,
    error: null,
    incomplete: false,
    diagnostics: [],
    revision: 0,
    ownerName: 'listener-a',
    ownerAddress: 'Q-listener-a',
    hasRegisteredName: true,
    getPlaylist: () => undefined,
    getVersions: () => [],
    getLatestVersion: () => undefined,
    getDrafts: () => [],
    getDraft: () => undefined,
    createDraft: () => emptyDraft,
    saveDraft: () => {},
    addTracks: (draft: typeof emptyDraft) => draft,
    addPendingSubmission: (draft: typeof emptyDraft) => draft,
    addOwnerTrack: (draft: typeof emptyDraft) => draft,
    removeEntry: (draft: typeof emptyDraft) => draft,
    reorderEntry: (draft: typeof emptyDraft) => draft,
    shuffleDraft: (draft: typeof emptyDraft) => draft,
    rotateDraft: (draft: typeof emptyDraft) => draft,
    editDraft: (draft: typeof emptyDraft) => draft,
    resolveSubmissions: async () => [],
    resolveEntries: (draft: typeof emptyDraft) =>
      draft.entries.map((entry) => ({ ...entry, status: 'READY' })),
    evaluatePublication: () => ({
      publishable: false,
      reason: 'Playlist has no tracks.',
      pendingSubmissionCount: 0,
      rejectedSubmissionCount: 0,
      unresolvedSubmissionCount: 0,
      tracks: [],
    }),
    evaluateStationSubmission: () => ({
      eligible: false,
      reason: 'Playlist has no station-eligible tracks.',
      pendingSubmissionCount: 0,
      rejectedSubmissionCount: 0,
      unresolvedSubmissionCount: 0,
      stationTracks: [],
    }),
    publishDraft: async () => ({ ok: false, error: 'Not published in test.', invalidTrackIds: [] }),
    clearDraft: () => {},
    refresh: async () => {},
  }),
  resolveListenerPlaylistSubmissions: async () => [],
}));

vi.mock('../features/listener-playlists/services/listenerPlaylistSubmissionStore', () => ({
  submitListenerPlaylist: async () => {},
}));

vi.mock('../features/listener-submissions/components/SubmitMusicForm', () => ({
  SubmitMusicForm: () => null,
}));

vi.mock('../features/listener-uploads', () => ({
  useListenerUploads: () => ({
    uploads: [],
    loaded: true,
    loading: false,
    incomplete: false,
    error: null,
    refresh: async () => {},
  }),
}));

vi.mock('../features/pagination', () => {
  const setPage = vi.fn();

  return {
    PaginationControls: () => null,
    paginateItems: (items: unknown[]) => items,
    usePagination: () => ({
      pageIndex: 0,
      pageSize: 10,
      setPageIndex: setPage,
      setPageSize: setPage,
    }),
  };
});

function renderCreatePage() {
  return render(
    <MemoryRouter initialEntries={['/my-playlists/new']}>
      <Routes>
        <Route path="/my-playlists/new" element={<ListenerPlaylistEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('listener playlist create mode', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      auth: {
        status: 'authenticated',
        address: 'Q-listener-a',
        name: 'listener-a',
      },
      ownerName: 'listener-a',
      refresh: () => {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the create editor with a valid empty draft', () => {
    renderCreatePage();

    expect(screen.getByText('Untitled Playlist')).toBeTruthy();
    expect(screen.getByText('New Listener Playlist')).toBeTruthy();
    expect(
      screen.getByText(
        'No tracks in this playlist yet. Add from the station library or submit new music.',
      ),
    ).toBeTruthy();
  });

  it('shows the loading state while Qortium identity is still loading', () => {
    vi.mocked(useAuth).mockReturnValue({
      auth: { status: 'loading' },
      ownerName: null,
      refresh: () => {},
    });

    renderCreatePage();

    expect(screen.getByText('Loading playlist editor…')).toBeTruthy();
  });

  it('shows the registered-name blocked state without creating a draft', () => {
    vi.mocked(useAuth).mockReturnValue({
      auth: {
        status: 'authenticated',
        address: 'Q-listener-a',
        name: undefined,
      },
      ownerName: null,
      refresh: () => {},
    });

    renderCreatePage();

    expect(screen.getByText('Registered Name required')).toBeTruthy();
  });
});
