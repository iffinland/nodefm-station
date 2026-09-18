// @vitest-environment jsdom

/* ============================================================
 * NodeFM Station — Listener Playlist Editor auth-refresh integrity
 *
 * Home reports a wallet lock-state change through the same
 * `qortium:selected-account-changed` signal as a real account change, so the
 * auth provider briefly reports `loading` while the account is unchanged.
 *
 * Regression under test: that transient used to reset the editor page, which
 * destroyed the pending publish progress and replaced the authored draft with
 * a new empty one while the publish itself resumed and succeeded.
 * ============================================================ */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ListenerPlaylistEditorPage from '../pages/ListenerPlaylistEditorPage';
import type { AuthState } from '../qortium/auth';
import type { PublishListenerPlaylistResult } from '../features/listener-playlists/services/listenerPlaylistStore';

const harness = vi.hoisted(() => ({
  auth: { status: 'authenticated', address: 'Q-listener-a', name: 'listener-a' } as AuthState,
  createDraftCalls: 0,
  publishCalls: 0,
  clearDraftCalls: 0,
  resolvePublish: null as null | ((result: PublishListenerPlaylistResult) => void),
}));

vi.mock('../app/providers/authContext', () => ({
  useAuth: () => ({
    auth: harness.auth,
    ownerName: harness.auth.status === 'authenticated' ? (harness.auth.name ?? null) : null,
    refresh: () => {},
  }),
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

vi.mock('../features/listener-playlists', () => {
  type Draft = {
    playlistId: string;
    title: string;
    description?: string;
    ownerName: string;
    ownerAddress: string;
    entries: Array<{
      entryId: string;
      kind: 'canonical-track';
      trackId: string;
      durationMs: number;
      title: string;
      artist?: string;
    }>;
    createdAt: string;
    updatedAt: string;
  };

  const authoredDraft: Draft = {
    playlistId: 'authored-draft',
    title: 'Authored Draft',
    description: undefined,
    ownerName: 'listener-a',
    ownerAddress: 'Q-listener-a',
    entries: [
      {
        entryId: 'entry-1',
        kind: 'canonical-track',
        trackId: 'track-1',
        durationMs: 309_586,
        title: 'A Dangerous Meeting',
        artist: 'Mercyful Fate',
      },
    ],
    createdAt: '2026-09-17T16:13:25.236Z',
    updatedAt: '2026-09-17T16:22:57.459Z',
  };

  return {
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
      createDraft: () => {
        harness.createDraftCalls += 1;

        if (harness.createDraftCalls === 1) return authoredDraft;

        return {
          ...authoredDraft,
          playlistId: `reset-draft-${harness.createDraftCalls}`,
          title: '',
          entries: [],
          updatedAt: '2026-09-17T19:23:57.000Z',
        };
      },
      saveDraft: () => {},
      addTracks: (draft: Draft) => draft,
      addOwnerTrack: (draft: Draft) => draft,
      addPendingSubmission: (draft: Draft) => draft,
      removeEntry: (draft: Draft) => draft,
      reorderEntry: (draft: Draft) => draft,
      shuffleDraft: (draft: Draft) => draft,
      rotateDraft: (draft: Draft) => draft,
      editDraft: (draft: Draft) => draft,
      resolveSubmissions: async () => [],
      resolveEntries: (draft: Draft) =>
        draft.entries.map((entry) => ({ ...entry, status: 'READY' as const })),
      evaluatePublication: (draft: Draft) => ({
        publishable: draft.entries.length > 0,
        reason: draft.entries.length === 0 ? 'Playlist has no tracks.' : undefined,
        pendingSubmissionCount: 0,
        rejectedSubmissionCount: 0,
        unresolvedSubmissionCount: 0,
        tracks:
          draft.entries.length > 0
            ? [
                {
                  trackId: 'track-1',
                  durationMs: 309_586,
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
      publishDraft: () => {
        harness.publishCalls += 1;

        return new Promise<PublishListenerPlaylistResult>((resolve) => {
          harness.resolvePublish = resolve;
        });
      },
      clearDraft: () => {
        harness.clearDraftCalls += 1;
      },
      refresh: async () => {},
    }),
    resolveListenerPlaylistSubmissions: async () => [],
  };
});

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
  SubmitMusicForm: () => null,
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

const authoredTrackRow = 'A Dangerous Meeting — Mercyful Fate';
const successMessage = 'Playlist published successfully.';
const lockRefresh: AuthState = { status: 'loading' };
const sameAccountUnlocked: AuthState = {
  status: 'authenticated',
  address: 'Q-listener-a',
  name: 'listener-a',
};
const otherAccount: AuthState = {
  status: 'authenticated',
  address: 'Q-listener-b',
  name: 'listener-b',
};

function pageTree() {
  return (
    <MemoryRouter initialEntries={['/my-playlists/new']}>
      <Routes>
        <Route path="/my-playlists/new" element={<ListenerPlaylistEditorPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function startPublish() {
  fireEvent.click(screen.getByText('Publish Playlist'));
}

describe('listener playlist editor across auth refreshes', () => {
  beforeEach(() => {
    harness.auth = { status: 'authenticated', address: 'Q-listener-a', name: 'listener-a' };
    harness.createDraftCalls = 0;
    harness.publishCalls = 0;
    harness.clearDraftCalls = 0;
    harness.resolvePublish = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps the authored draft and the pending publish UI through a lock-state-only refresh', async () => {
    const view = render(pageTree());

    expect(screen.getByText(authoredTrackRow)).toBeTruthy();
    startPublish();
    expect(await screen.findByText('Playlist version')).toBeTruthy();

    harness.auth = lockRefresh;
    view.rerender(pageTree());

    // The lock-state refresh is not an identity change: nothing is recreated.
    expect(screen.queryByText('Loading playlist editor…')).toBeNull();
    expect(screen.getByText('Playlist version')).toBeTruthy();
    expect(screen.getByText('Playlist')).toBeTruthy();
    expect(screen.getByText(authoredTrackRow)).toBeTruthy();
    expect(harness.createDraftCalls).toBe(1);

    harness.auth = sameAccountUnlocked;
    view.rerender(pageTree());

    expect(screen.getByText(authoredTrackRow)).toBeTruthy();
    expect(harness.createDraftCalls).toBe(1);
    expect(harness.publishCalls).toBe(1);
  });

  it('renders the success state with a working Close action after the resumed publish completes', async () => {
    const view = render(pageTree());

    startPublish();
    expect(await screen.findByText('Playlist version')).toBeTruthy();

    harness.auth = lockRefresh;
    view.rerender(pageTree());
    harness.auth = sameAccountUnlocked;
    view.rerender(pageTree());

    await act(async () => {
      harness.resolvePublish?.({ ok: true } as PublishListenerPlaylistResult);
    });

    expect(await screen.findByText(successMessage)).toBeTruthy();
    expect(harness.publishCalls).toBe(1);
    expect(harness.clearDraftCalls).toBe(1);

    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByText(successMessage)).toBeNull();
    expect(screen.queryByText('Playlist version')).toBeNull();
  });

  it('resets page state on a real account change and ignores the previous run', async () => {
    const view = render(pageTree());

    expect(screen.getByText(authoredTrackRow)).toBeTruthy();
    startPublish();
    expect(await screen.findByText('Playlist version')).toBeTruthy();

    harness.auth = otherAccount;
    view.rerender(pageTree());

    // A real identity change is still a reset: new draft, no inherited progress.
    expect(harness.createDraftCalls).toBe(2);
    expect(screen.queryByText('Playlist version')).toBeNull();
    expect(screen.queryByText(authoredTrackRow)).toBeNull();
    expect(
      screen.getByText(
        'No tracks in this playlist yet. Add from the station library or submit new music.',
      ),
    ).toBeTruthy();
    expect(harness.publishCalls).toBe(1);

    await act(async () => {
      harness.resolvePublish?.({ ok: true } as PublishListenerPlaylistResult);
    });

    // The completed write of the previous account must not surface here.
    expect(screen.queryByText(successMessage)).toBeNull();
    expect(screen.queryByText('Playlist version')).toBeNull();
    expect(harness.clearDraftCalls).toBe(1);
  });
});
