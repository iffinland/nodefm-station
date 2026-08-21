/* ============================================================
 * NodeFM Station — Listener Submission Domain Service Tests
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  createListenerTrackSubmission,
  createSubmissionModeration,
  deserializeSubmissionFromQdn,
  getAcceptedSubmissionTrackId,
  getSubmissionAudioQdnIdentifier,
  getSubmissionCoverQdnIdentifier,
  getSubmissionModerationQdnIdentifier,
  getSubmissionQdnIdentifier,
  validateSubmissionStructuralIntegrity,
} from '../features/listener-submissions/services/submissionService';
import type { QdnResourceRef } from '../types/domain';

const LISTENER = 'listener';
const ADDRESS = 'Q-listener';

function validInput(overrides: Partial<Parameters<typeof createListenerTrackSubmission>[0]> = {}) {
  return {
    submissionId: '11111111-1111-4111-8111-111111111111',
    submitterName: LISTENER,
    submitterAddress: ADDRESS,
    title: 'Listener Song',
    audio: {
      service: 'AUDIO',
      name: LISTENER,
      identifier: getSubmissionAudioQdnIdentifier('11111111-1111-4111-8111-111111111111'),
    },
    durationMs: 123456,
    ...overrides,
  };
}

describe('listener submission domain model', () => {
  it('creates a valid submission with canonical refs', () => {
    const submission = createListenerTrackSubmission(validInput());

    expect(submission.submissionId).toBe('11111111-1111-4111-8111-111111111111');
    expect(submission.audio).toEqual({
      service: 'AUDIO',
      name: LISTENER,
      identifier: 'nodefm-submission-audio-11111111-1111-4111-8111-111111111111',
    });
    expect(submission.durationMs).toBe(123456);
  });

  it('rejects malformed title, duration, and refs', () => {
    expect(() => createListenerTrackSubmission(validInput({ title: ' ' }))).toThrow(/title/);
    expect(() => createListenerTrackSubmission(validInput({ durationMs: 0 }))).toThrow(/duration/);
    expect(() =>
      createListenerTrackSubmission(validInput({ audio: { service: '', name: 'x' } })),
    ).toThrow(/audio/);
    expect(() =>
      createListenerTrackSubmission(
        validInput({
          cover: { service: 'IMAGE', name: ' ' },
        }),
      ),
    ).toThrow(/cover/);
  });

  it('rejects malformed artist and genres/tags', () => {
    expect(() => createListenerTrackSubmission(validInput({ genres: ['ok', ''] }))).toThrow(
      /genres/,
    );
    expect(() =>
      createListenerTrackSubmission(validInput({ tags: [42 as unknown as string] })),
    ).toThrow(/tags/);
  });

  it('serializes and deserializes a valid submission', () => {
    const submission = createListenerTrackSubmission(validInput());
    expect(deserializeSubmissionFromQdn(JSON.parse(JSON.stringify(submission)))).toEqual(
      submission,
    );
  });

  it('preserves optional Album and Release date through serialization', () => {
    const submission = createListenerTrackSubmission(
      validInput({
        album: 'The Dark Side of the Moon',
        releaseDate: '1973-03-01',
      }),
    );

    expect(submission.album).toBe('The Dark Side of the Moon');
    expect(submission.releaseDate).toBe('1973-03-01');
    expect(deserializeSubmissionFromQdn(JSON.parse(JSON.stringify(submission)))).toEqual(
      submission,
    );
  });

  it('rejects an invalid Release date and keeps the fields optional', () => {
    expect(() => createListenerTrackSubmission(validInput({ releaseDate: '2023-02-30' }))).toThrow(
      /release date/i,
    );
    expect(createListenerTrackSubmission(validInput()).album).toBeUndefined();
    expect(createListenerTrackSubmission(validInput()).releaseDate).toBeUndefined();
  });

  it('rejects a submission with an invalid duration on deserialization', () => {
    const submission = createListenerTrackSubmission(validInput());
    expect(
      deserializeSubmissionFromQdn({
        ...submission,
        durationMs: 0,
      }),
    ).toBeNull();
  });

  it('generates distinct, bounded identifiers', () => {
    const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    const identifiers = [
      getSubmissionQdnIdentifier(idA),
      getSubmissionQdnIdentifier(idB),
      getSubmissionAudioQdnIdentifier(idA),
      getSubmissionCoverQdnIdentifier(idA),
      getSubmissionModerationQdnIdentifier(idA),
    ];

    expect(new Set(identifiers).size).toBe(identifiers.length);
    for (const identifier of identifiers) {
      expect(identifier.length).toBeLessThanOrEqual(64);
    }
  });

  it('builds a stable accepted track ID', () => {
    expect(getAcceptedSubmissionTrackId('submission-1')).toBe('sub-submission-1');
  });
});

describe('submission structural identity', () => {
  it('accepts exact publisher/audio/cover identity', () => {
    const submission = createListenerTrackSubmission(
      validInput({
        cover: {
          service: 'IMAGE',
          name: LISTENER,
          identifier: getSubmissionCoverQdnIdentifier('11111111-1111-4111-8111-111111111111'),
        },
      }),
    );

    expect(
      validateSubmissionStructuralIntegrity(
        submission,
        LISTENER,
        getSubmissionQdnIdentifier(submission.submissionId),
      ),
    ).toEqual({ ok: true });
  });

  it('rejects identifier mismatch', () => {
    const submission = createListenerTrackSubmission(validInput());
    const result = validateSubmissionStructuralIntegrity(submission, LISTENER, 'wrong-id');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('IDENTIFIER_MISMATCH');
  });

  it('rejects forged publisher', () => {
    const submission = createListenerTrackSubmission(validInput());
    const result = validateSubmissionStructuralIntegrity(
      submission,
      'mallory',
      getSubmissionQdnIdentifier(submission.submissionId),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('IDENTITY_UNVERIFIED');
  });

  it('rejects forged audio reference', () => {
    const submission = createListenerTrackSubmission(
      validInput({
        audio: { service: 'AUDIO', name: 'mallory', identifier: 'other' } as QdnResourceRef,
      }),
    );
    const result = validateSubmissionStructuralIntegrity(
      submission,
      LISTENER,
      getSubmissionQdnIdentifier(submission.submissionId),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AUDIO_MISMATCH');
  });

  it('rejects forged cover reference', () => {
    const submissionId = '11111111-1111-4111-8111-111111111111';
    const submission = createListenerTrackSubmission(
      validInput({
        cover: {
          service: 'IMAGE',
          name: 'mallory',
          identifier: getSubmissionCoverQdnIdentifier(submissionId),
        },
      }),
    );
    const result = validateSubmissionStructuralIntegrity(
      submission,
      LISTENER,
      getSubmissionQdnIdentifier(submission.submissionId),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('COVER_MISMATCH');
  });
});

describe('submission moderation model', () => {
  const submissionRef = {
    service: 'JSON',
    name: LISTENER,
    identifier: getSubmissionQdnIdentifier('11111111-1111-4111-8111-111111111111'),
  };

  it('requires acceptedTrackId for accepted moderation', () => {
    expect(() =>
      createSubmissionModeration({
        moderationId: '11111111-1111-4111-8111-111111111111',
        submissionId: '11111111-1111-4111-8111-111111111111',
        submissionRef,
        decision: 'accepted',
        moderatorAddress: 'Q-owner',
      }),
    ).toThrow(/acceptedTrackId/);
  });

  it('creates rejected moderation without a track ID', () => {
    const moderation = createSubmissionModeration({
      moderationId: '11111111-1111-4111-8111-111111111111',
      submissionId: '11111111-1111-4111-8111-111111111111',
      submissionRef,
      decision: 'rejected',
      moderatorAddress: 'Q-owner',
    });

    expect(moderation.decision).toBe('rejected');
    expect(moderation.acceptedTrackId).toBeUndefined();
  });
});
