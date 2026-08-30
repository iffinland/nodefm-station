/* ============================================================
 * NodeFM Station — Listener Playlist Submission Domain Tests
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  createListenerPlaylistSubmission,
  createListenerPlaylistSubmissionModeration,
  deserializeListenerPlaylistSubmission,
  deserializeListenerPlaylistSubmissionModeration,
  getListenerPlaylistSubmissionModerationQdnIdentifier,
  getListenerPlaylistSubmissionQdnIdentifier,
} from '../features/listener-playlists/services/listenerPlaylistSubmissionService';

describe('listener playlist submission model', () => {
  it('records an exact immutable version reference', () => {
    const submission = createListenerPlaylistSubmission({
      submissionId: 'submission-1',
      listenerName: 'listener-a',
      listenerAddress: 'Q-listener-a',
      playlistId: 'playlist-1',
      playlistTitle: 'Forest Night',
      versionId: 'version-1',
      versionRef: {
        service: 'JSON',
        name: 'listener-a',
        identifier: 'nodefm-lp-ver-version-1',
      },
    });

    expect(submission.versionId).toBe('version-1');
    expect(submission.versionRef).toEqual({
      service: 'JSON',
      name: 'listener-a',
      identifier: 'nodefm-lp-ver-version-1',
    });
    expect(deserializeListenerPlaylistSubmission(JSON.parse(JSON.stringify(submission)))).toEqual(
      submission,
    );
  });

  it('requires registered name and exact version reference', () => {
    expect(() =>
      createListenerPlaylistSubmission({
        listenerName: '',
        listenerAddress: 'Q-listener-a',
        playlistId: 'p1',
        playlistTitle: 'Playlist',
        versionId: 'v1',
        versionRef: { service: 'JSON', name: 'listener-a', identifier: 'id' },
      }),
    ).toThrow(/registered Qortium name/);

    expect(() =>
      createListenerPlaylistSubmission({
        listenerName: 'listener-a',
        listenerAddress: 'Q-listener-a',
        playlistId: 'p1',
        playlistTitle: 'Playlist',
        versionId: 'v1',
        versionRef: { service: 'JSON', name: '', identifier: 'id' },
      }),
    ).toThrow(/PlaylistVersion resource reference/);
  });

  it('requires imported station version coordinates for accept', () => {
    expect(() =>
      createListenerPlaylistSubmissionModeration({
        submissionId: 'submission-1',
        submissionRef: { service: 'JSON', name: 'listener-a', identifier: 'submission-1' },
        decision: 'accepted',
        moderatorAddress: 'Q-owner',
      }),
    ).toThrow(/importedPlaylistId/);
  });

  it('rejects without imported coordinates and keeps moderation identity valid', () => {
    const moderation = createListenerPlaylistSubmissionModeration({
      moderationId: 'moderation-1',
      submissionId: 'submission-1',
      submissionRef: { service: 'JSON', name: 'listener-a', identifier: 'submission-1' },
      decision: 'rejected',
      reason: 'Not a fit',
      moderatorAddress: 'Q-owner',
    });

    expect(
      deserializeListenerPlaylistSubmissionModeration(JSON.parse(JSON.stringify(moderation))),
    ).toEqual(moderation);
  });

  it('builds bounded, distinct QDN identifiers', () => {
    const identifiers = [
      getListenerPlaylistSubmissionQdnIdentifier('submission-a'),
      getListenerPlaylistSubmissionModerationQdnIdentifier('submission-a'),
      getListenerPlaylistSubmissionQdnIdentifier('submission-b'),
    ];

    expect(new Set(identifiers).size).toBe(identifiers.length);
    for (const identifier of identifiers) {
      expect(identifier.length).toBeLessThanOrEqual(64);
    }
  });
});
