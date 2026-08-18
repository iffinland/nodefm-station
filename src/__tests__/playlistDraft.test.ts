/* ============================================================
 * NodeFM Station — Playlist Draft Store Tests
 *
 * Tests account-scoped session draft persistence without QDN.
 * ============================================================ */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearPlaylistDraft,
  getPlaylistDraft,
  resetPlaylistDrafts,
  savePlaylistDraft,
  type PlaylistDraftTrack,
} from '../features/playlists/services/playlistDraftStore';

function draftTracks(): PlaylistDraftTrack[] {
  return [
    { trackId: 't1', durationMs: 1000, title: 'Track One', artist: 'Artist' },
    { trackId: 't2', durationMs: 2000, title: 'Track Two' },
  ];
}

describe('playlistDraftStore', () => {
  beforeEach(() => {
    resetPlaylistDrafts();
  });

  it('persists a draft across simulated component remounts', () => {
    savePlaylistDraft('Q-owner-A', 'playlist-1', draftTracks());

    // A remount reads from the account-scoped store rather than local state.
    expect(getPlaylistDraft('Q-owner-A', 'playlist-1')).toEqual(draftTracks());
  });

  it('returns a defensive copy', () => {
    savePlaylistDraft('Q-owner-A', 'playlist-1', draftTracks());
    const read = getPlaylistDraft('Q-owner-A', 'playlist-1');
    read?.splice(0, 1);

    expect(getPlaylistDraft('Q-owner-A', 'playlist-1')).toEqual(draftTracks());
  });

  it('preserves an explicitly empty draft', () => {
    savePlaylistDraft('Q-owner-A', 'playlist-1', []);
    expect(getPlaylistDraft('Q-owner-A', 'playlist-1')).toEqual([]);
  });

  it('does not expose account A drafts to account B', () => {
    savePlaylistDraft('Q-owner-A', 'playlist-1', draftTracks());
    expect(getPlaylistDraft('Q-owner-B', 'playlist-1')).toBeUndefined();
  });

  it('clears drafts per account and globally', () => {
    savePlaylistDraft('Q-owner-A', 'playlist-1', draftTracks());
    clearPlaylistDraft('Q-owner-A', 'playlist-1');
    expect(getPlaylistDraft('Q-owner-A', 'playlist-1')).toBeUndefined();

    savePlaylistDraft('Q-owner-A', 'playlist-1', draftTracks());
    resetPlaylistDrafts();
    expect(getPlaylistDraft('Q-owner-A', 'playlist-1')).toBeUndefined();
  });
});
