// @vitest-environment jsdom

import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useAuth } from '../app/providers/authContext';
import ListenerPlaylistEditorPage from '../pages/ListenerPlaylistEditorPage';
import type { ListenerPlaylistDraft } from '../features/listener-playlists/services/listenerPlaylistService';
import type { ListenerTrackSubmission } from '../types/domain';

const uploadMock = vi.hoisted(() => ({ title: 'Uploaded Mix' }));

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

vi.mock('../features/station/useStationIdentity', () => ({
  useStationIdentity: () => ({
    publisherName: 'NodeFM',
    ownerAddress: 'Q-owner',
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

const uploadedSubmission: ListenerTrackSubmission = {
  schemaVersion: 1,
  submissionId: 'sub-1',
  submitterName: 'listener-a',
  submitterAddress: 'Q-listener-a',
  title: 'New Song',
  durationMs: 120_000,
  audio: { service: 'AUDIO', name: 'listener-a', identifier: 'audio-sub-1' },
  submittedAt: '2026-08-29T00:00:00.000Z',
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
    addOwnerTrack: (draft: typeof emptyDraft) => ({
      ...draft,
      title: draft.title || uploadMock.title,
      entries: [
        {
          entryId: 'entry-1',
          kind: 'pending-submission',
          submissionId: 'sub-1',
          durationMs: 120_000,
          title: 'New Song',
        },
      ],
      updatedAt: '2026-08-29T01:00:00.000Z',
    }),
    removeEntry: (draft: typeof emptyDraft) => draft,
    reorderEntry: (draft: typeof emptyDraft) => draft,
    shuffleDraft: (draft: typeof emptyDraft) => draft,
    rotateDraft: (draft: typeof emptyDraft) => draft,
    editDraft: (draft: typeof emptyDraft) => draft,
    resolveSubmissions: async () => [],
    resolveEntries: (draft: typeof emptyDraft) =>
      draft.entries.map((entry) => ({ ...entry, stationStatus: 'PENDING' })),
    evaluatePublication: (draft: typeof emptyDraft) => ({
      publishable: draft.entries.length > 0,
      reason: draft.entries.length === 0 ? 'Playlist has no tracks.' : undefined,
      pendingSubmissionCount: 0,
      rejectedSubmissionCount: 0,
      unresolvedSubmissionCount: 0,
      tracks:
        draft.entries.length > 0
          ? [
              {
                trackId: 'sub-1',
                durationMs: 120_000,
                kind: 'OWNER_TRACK',
                ownerName: 'listener-a',
              },
            ]
          : [],
    }),
    evaluateStationSubmission: () => ({
      eligible: false,
      reason: '1 track still awaiting station approval',
      pendingSubmissionCount: 1,
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

vi.mock('../features/listener-uploads', () => ({
  useListenerUploads: () => ({
    uploads: [],
    loaded: true,
    loading: false,
    incomplete: false,
    error: null,
    refresh: vi.fn(async () => {}),
  }),
}));

vi.mock('../features/listener-submissions/components/SubmitMusicForm', () => ({
  SubmitMusicForm: function SubmitMusicForm({
    onPublished,
  }: {
    onPublished?: (submission: ListenerTrackSubmission) => void;
  }) {
    useEffect(() => {
      onPublished?.(uploadedSubmission);
    }, [onPublished]);

    return null;
  },
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/my-playlists/new']}>
      <Routes>
        <Route path="/my-playlists/new" element={<ListenerPlaylistEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('listener playlist editor owner-track upload', () => {
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
    uploadMock.title = 'Uploaded Mix';
  });

  it('adds a newly published listener-owned track immediately and shows pending station review', async () => {
    renderPage();

    expect(screen.getByText('Upload New Music')).toBeTruthy();
    screen.getByText('Upload New Music').click();

    expect(
      await screen.findByText('Upload complete — Added to your playlist. Station review: Pending.'),
    ).toBeTruthy();
    expect(screen.getByText('New Song')).toBeTruthy();
  });

  it('keeps Publish Playlist enabled when the playlist title is still empty', async () => {
    uploadMock.title = '';

    renderPage();

    screen.getByText('Upload New Music').click();

    expect(
      await screen.findByText('Upload complete — Added to your playlist. Station review: Pending.'),
    ).toBeTruthy();

    const publishButton = screen.getByText('Publish Playlist') as HTMLButtonElement;
    expect(publishButton.disabled).toBe(false);
  });
});
