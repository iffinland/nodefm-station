/* ============================================================
 * NodeFM Station — Playlist Draft Store
 *
 * Account-scoped, session-local draft storage for the playlist
 * editor. Drafts survive ordinary route/component remounts but are
 * not published to QDN. Published PlaylistVersions are immutable and
 * remain separate from these drafts.
 * ============================================================ */

export type PlaylistDraftTrack = {
  trackId: string;
  durationMs: number;
  title: string;
  artist?: string;
};

type PlaylistDraft = {
  playlistId: string;
  tracks: PlaylistDraftTrack[];
};

const drafts = new Map<string, PlaylistDraft>();

function draftKey(ownerAddress: string, playlistId: string): string {
  return `${ownerAddress}\u0000${playlistId}`;
}

export function getPlaylistDraft(
  ownerAddress: string,
  playlistId: string,
): PlaylistDraftTrack[] | undefined {
  const draft = drafts.get(draftKey(ownerAddress, playlistId));
  return draft ? [...draft.tracks] : undefined;
}

export function savePlaylistDraft(
  ownerAddress: string,
  playlistId: string,
  tracks: PlaylistDraftTrack[],
): void {
  drafts.set(draftKey(ownerAddress, playlistId), {
    playlistId,
    tracks: [...tracks],
  });
}

export function clearPlaylistDraft(ownerAddress: string, playlistId: string): void {
  drafts.delete(draftKey(ownerAddress, playlistId));
}

/** Test/account-hygiene helper: drop every session draft. */
export function resetPlaylistDrafts(): void {
  drafts.clear();
}
