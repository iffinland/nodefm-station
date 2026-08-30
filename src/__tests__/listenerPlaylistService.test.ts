/* ============================================================
 * NodeFM Station — Listener Playlist Domain Service Tests
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  addCanonicalTracksToListenerDraft,
  addPendingSubmissionToListenerDraft,
  createListenerPlaylistDraft,
  editListenerPlaylistDraft,
  evaluateListenerDraftPublication,
  evaluateListenerDraftStationSubmission,
  getListenerPlaylistDisplayTitle,
  getListenerPlaylistQdnIdentifier,
  getListenerPlaylistVersionQdnIdentifier,
  isListenerPlaylistDraft,
  removeListenerDraftEntry,
  reorderListenerDraftEntry,
  rotateListenerDraftStart,
  shuffleListenerDraft,
  toListenerPlaylist,
  type ListenerSubmissionResolution,
} from '../features/listener-playlists/services/listenerPlaylistService';

function draft(overrides: Partial<Parameters<typeof createListenerPlaylistDraft>[0]> = {}) {
  return createListenerPlaylistDraft({
    title: 'Road Music',
    ownerName: 'listener-a',
    ownerAddress: 'Q-listener-a',
    playlistId: 'playlist-1',
    ...overrides,
  });
}

describe('listener playlist identity', () => {
  it('defaults new and legacy drafts to private visibility', () => {
    const created = draft();
    const legacy = { ...created } as Record<string, unknown>;
    delete legacy.visibility;

    expect(created.visibility).toBe('private');
    expect(toListenerPlaylist(legacy as never).visibility).toBe('private');
  });

  it('persists public visibility and publishes it on the logical playlist', () => {
    const created = draft({ visibility: 'public' });
    const edited = editListenerPlaylistDraft(created, { visibility: 'private' });

    expect(toListenerPlaylist(created).visibility).toBe('public');
    expect(toListenerPlaylist(edited).visibility).toBe('private');
  });

  it('requires a registered name and account', () => {
    expect(() =>
      createListenerPlaylistDraft({
        title: 'No Name',
        ownerName: '',
        ownerAddress: 'Q-owner',
      }),
    ).toThrow(/registered Qortium name/);

    expect(() =>
      createListenerPlaylistDraft({
        title: 'No Account',
        ownerName: 'listener-a',
        ownerAddress: '',
      }),
    ).toThrow(/authenticated account/);
  });

  it('keeps playlist identity stable when the title changes', () => {
    const original = draft();
    const renamed = editListenerPlaylistDraft(original, { title: 'Forest Night' });

    expect(renamed.playlistId).toBe(original.playlistId);
    expect(renamed.title).toBe('Forest Night');
  });

  it('generates bounded, distinct QDN identifiers', () => {
    const identifiers = [
      getListenerPlaylistQdnIdentifier('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      getListenerPlaylistQdnIdentifier('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      getListenerPlaylistVersionQdnIdentifier('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    ];

    expect(new Set(identifiers).size).toBe(identifiers.length);
    for (const identifier of identifiers) {
      expect(identifier.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('listener playlist draft editor', () => {
  it('allows an empty default title so create mode can initialize a safe draft', () => {
    const empty = createListenerPlaylistDraft({
      title: '',
      ownerName: 'listener-a',
      ownerAddress: 'Q-listener-a',
    });

    expect(empty.title).toBe('');
    expect(empty.entries).toEqual([]);
    expect(isListenerPlaylistDraft(empty)).toBe(true);
    expect(empty.playlistId).not.toBe('');
    expect(getListenerPlaylistDisplayTitle(empty)).toBe('Untitled Playlist');
  });

  it('keeps the generated create-draft ID stable across equivalent initializations', () => {
    const explicit = createListenerPlaylistDraft({
      playlistId: 'stable-create-id',
      title: '',
      ownerName: 'listener-a',
      ownerAddress: 'Q-listener-a',
    });
    const edited = editListenerPlaylistDraft(explicit, { title: 'Road Music' });

    expect(edited.playlistId).toBe('stable-create-id');
    expect(edited.title).toBe('Road Music');
  });

  it('adds many canonical tracks at once and avoids duplicates', () => {
    const original = draft();
    const withTracks = addCanonicalTracksToListenerDraft(original, [
      { trackId: 't1', durationMs: 1000, title: 'One' },
      { trackId: 't2', durationMs: 2000, title: 'Two' },
      { trackId: 't3', durationMs: 3000, title: 'Three' },
    ]);

    const duplicateAware = addCanonicalTracksToListenerDraft(withTracks, [
      { trackId: 't1', durationMs: 1000, title: 'One' },
      { trackId: 't4', durationMs: 4000, title: 'Four' },
    ]);

    expect(duplicateAware.entries).toHaveLength(4);
  });

  it('removes entries, reorders, shuffles, and rotates without changing ownership', () => {
    let value = addCanonicalTracksToListenerDraft(draft(), [
      { trackId: 'a', durationMs: 1, title: 'A' },
      { trackId: 'b', durationMs: 2, title: 'B' },
      { trackId: 'c', durationMs: 3, title: 'C' },
    ]);

    value = removeListenerDraftEntry(value, value.entries[1].entryId);
    expect(value.entries.map((entry) => entry.kind === 'canonical-track' && entry.trackId)).toEqual(
      ['a', 'c'],
    );

    value = reorderListenerDraftEntry(value, value.entries[1].entryId, 0);
    expect(value.entries.map((entry) => entry.kind === 'canonical-track' && entry.trackId)).toEqual(
      ['c', 'a'],
    );

    const rotated = rotateListenerDraftStart(value);
    expect(rotated.entries[0]).toMatchObject({ trackId: 'a' });
    expect(rotated.ownerName).toBe('listener-a');
    expect(rotated.ownerAddress).toBe('Q-listener-a');

    // Shuffle is non-deterministic but must preserve membership.
    const shuffled = shuffleListenerDraft(value);
    expect(shuffled.entries).toHaveLength(2);
    expect(new Set(shuffled.entries.map((entry) => entry.entryId))).toEqual(
      new Set(value.entries.map((entry) => entry.entryId)),
    );
  });
});

describe('listener-owned track personal publication authority', () => {
  it('allows immediate personal publication with an empty draft title', () => {
    const value = addPendingSubmissionToListenerDraft(draft({ title: '' }), {
      submissionId: 'sub-1',
      durationMs: 2000,
      title: 'New Song',
    });

    const result = evaluateListenerDraftPublication(value, [
      {
        submissionId: 'sub-1',
        status: 'PENDING',
        title: 'New Song',
        durationMs: 2000,
      },
    ]);

    expect(result.publishable).toBe(true);
    expect(getListenerPlaylistDisplayTitle(value)).toBe('Untitled Playlist');
  });

  it('allows immediate personal publication while station review is pending', () => {
    const value = addPendingSubmissionToListenerDraft(
      addCanonicalTracksToListenerDraft(draft(), [
        { trackId: 't1', durationMs: 1000, title: 'One' },
      ]),
      { submissionId: 'sub-1', durationMs: 2000, title: 'New Song' },
    );

    const result = evaluateListenerDraftPublication(value, [
      {
        submissionId: 'sub-1',
        status: 'PENDING',
        title: 'New Song',
        durationMs: 2000,
      },
    ]);

    expect(result.publishable).toBe(true);
    if (result.publishable) {
      expect(result.tracks).toEqual([
        { trackId: 't1', durationMs: 1000, kind: 'STATION_TRACK' },
        {
          trackId: 'sub-1',
          durationMs: 2000,
          kind: 'OWNER_TRACK',
          ownerName: 'listener-a',
        },
      ]);
    }
  });

  it('keeps owner track identity stable after station accept for personal use', () => {
    const value = addPendingSubmissionToListenerDraft(draft(), {
      submissionId: 'sub-1',
      durationMs: 2000,
      title: 'New Song',
    });

    const resolutions: ListenerSubmissionResolution[] = [
      {
        submissionId: 'sub-1',
        status: 'ACCEPTED',
        acceptedTrackId: 'sub-sub-1',
        title: 'New Song',
        durationMs: 2000,
      },
    ];

    const result = evaluateListenerDraftPublication(value, resolutions);
    expect(result.publishable).toBe(true);
    if (result.publishable) {
      expect(result.tracks).toEqual([
        {
          trackId: 'sub-1',
          durationMs: 2000,
          kind: 'OWNER_TRACK',
          ownerName: 'listener-a',
        },
      ]);
    }
  });

  it('keeps rejected owner tracks personally usable', () => {
    const value = addPendingSubmissionToListenerDraft(draft(), {
      submissionId: 'sub-1',
      durationMs: 2000,
      title: 'Rejected Song',
    });

    const blocked = evaluateListenerDraftPublication(value, [
      {
        submissionId: 'sub-1',
        status: 'REJECTED',
        title: 'Rejected Song',
        durationMs: 2000,
      },
    ]);

    expect(blocked.publishable).toBe(true);
    if (blocked.publishable) {
      expect(blocked.tracks).toEqual([
        {
          trackId: 'sub-1',
          durationMs: 2000,
          kind: 'OWNER_TRACK',
          ownerName: 'listener-a',
        },
      ]);
    }

    const removed = removeListenerDraftEntry(value, value.entries[0].entryId);
    expect(evaluateListenerDraftPublication(removed, []).publishable).toBe(false);
  });
});

describe('submit playlist to station gate', () => {
  it('requires every owner track to be station-approved', () => {
    const value = addPendingSubmissionToListenerDraft(
      addCanonicalTracksToListenerDraft(draft(), [
        { trackId: 't1', durationMs: 1000, title: 'One' },
      ]),
      { submissionId: 'sub-1', durationMs: 2000, title: 'Pending Song' },
    );

    const pending = evaluateListenerDraftStationSubmission(value, [
      {
        submissionId: 'sub-1',
        status: 'PENDING',
        title: 'Pending Song',
        durationMs: 2000,
      },
    ]);

    expect(pending.eligible).toBe(false);
    if (!pending.eligible) {
      expect(pending.pendingSubmissionCount).toBe(1);
      expect(pending.reason).toContain('awaiting station approval');
    }
  });

  it('maps accepted owner tracks to canonical station track IDs', () => {
    const value = addPendingSubmissionToListenerDraft(draft(), {
      submissionId: 'sub-1',
      durationMs: 2000,
      title: 'Approved Song',
    });

    const result = evaluateListenerDraftStationSubmission(value, [
      {
        submissionId: 'sub-1',
        status: 'ACCEPTED',
        acceptedTrackId: 'sub-sub-1',
        title: 'Approved Song',
        durationMs: 2000,
      },
    ]);

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.stationTracks).toEqual([
        { trackId: 'sub-sub-1', durationMs: 2000, kind: 'STATION_TRACK' },
      ]);
    }
  });
});
