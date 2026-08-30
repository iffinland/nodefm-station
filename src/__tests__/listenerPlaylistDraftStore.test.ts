/* ============================================================
 * NodeFM Station — Listener Playlist Draft Store Tests
 * ============================================================ */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearListenerPlaylistDraft,
  getListenerPlaylistDraft,
  resetListenerPlaylistDrafts,
  saveListenerPlaylistDraft,
} from '../features/listener-playlists/services/listenerPlaylistDraftStore';
import { createListenerPlaylistDraft } from '../features/listener-playlists/services/listenerPlaylistService';

function storedDraft(ownerName = 'listener-a', ownerAddress = 'Q-listener-a') {
  return createListenerPlaylistDraft({
    playlistId: 'playlist-1',
    title: 'Draft',
    ownerName,
    ownerAddress,
    entries: [
      {
        entryId: 'entry-1',
        kind: 'canonical-track',
        trackId: 'track-1',
        durationMs: 1000,
        title: 'Track One',
      },
    ],
  });
}

describe('listenerPlaylistDraftStore', () => {
  beforeEach(() => {
    resetListenerPlaylistDrafts();
  });

  it('scopes drafts by account and registered name', () => {
    saveListenerPlaylistDraft(storedDraft('listener-a', 'Q-listener-a'));

    expect(getListenerPlaylistDraft('listener-a', 'Q-listener-a', 'playlist-1')).toBeDefined();
    expect(getListenerPlaylistDraft('listener-b', 'Q-listener-a', 'playlist-1')).toBeUndefined();
    expect(getListenerPlaylistDraft('listener-a', 'Q-listener-b', 'playlist-1')).toBeUndefined();
  });

  it('restores a valid draft and clears it', () => {
    saveListenerPlaylistDraft(storedDraft());
    expect(
      getListenerPlaylistDraft('listener-a', 'Q-listener-a', 'playlist-1')?.entries,
    ).toHaveLength(1);

    clearListenerPlaylistDraft('listener-a', 'Q-listener-a', 'playlist-1');
    expect(getListenerPlaylistDraft('listener-a', 'Q-listener-a', 'playlist-1')).toBeUndefined();
  });

  it('handles corrupt persisted data honestly', () => {
    const key = 'nodefm.listener-playlist-draft.v1.Q-listener-a\u0000listener-a\u0000playlist-1';
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, '{not-json');
    }

    expect(getListenerPlaylistDraft('listener-a', 'Q-listener-a', 'playlist-1')).toBeUndefined();
  });
});
