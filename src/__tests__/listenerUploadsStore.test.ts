/* ============================================================
 * NodeFM Station — Listener Uploads Store Tests
 * ============================================================ */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../qortium/qdn', () => ({
  qdnJsonPublishFileName: (identifier: string) => `${identifier}.json`,
  fetchQdnResourceData: vi.fn(),
  searchQdnResources: vi.fn(),
}));

vi.mock('../qortium/qdnReadError', async () => {
  const actual =
    await vi.importActual<typeof import('../qortium/qdnReadError')>('../qortium/qdnReadError');

  return {
    ...actual,
    isConfirmedQdnNotFoundError: vi.fn(
      (error) => error instanceof Error && error.message === 'missing moderation',
    ),
  };
});

import { fetchQdnResourceData, searchQdnResources } from '../qortium/qdn';
import {
  createListenerTrackSubmission,
  createSubmissionModeration,
  getSubmissionAudioQdnIdentifier,
  getSubmissionModerationQdnIdentifier,
  getSubmissionQdnIdentifier,
} from '../features/listener-submissions/services/submissionService';
import {
  getListenerUploads,
  getListenerUploadsLoadAction,
  loadListenerUploads,
  resetListenerUploads,
} from '../features/listener-uploads/services/listenerUploadsStore';

const mockedFetch = vi.mocked(fetchQdnResourceData);
const mockedSearch = vi.mocked(searchQdnResources);

const LISTENER = 'listener-a';
const LISTENER_ADDRESS = 'Q-listener-a';
const STATION = 'NodeFM';
const STATION_ADDRESS = 'Q-owner';

function submission(id: string, title: string) {
  return createListenerTrackSubmission({
    submissionId: id,
    submitterName: LISTENER,
    submitterAddress: LISTENER_ADDRESS,
    title,
    audio: {
      service: 'AUDIO',
      name: LISTENER,
      identifier: getSubmissionAudioQdnIdentifier(id),
    },
    durationMs: 120_000,
  });
}

describe('listener uploads store', () => {
  beforeEach(() => {
    resetListenerUploads();
    mockedFetch.mockReset();
    mockedSearch.mockReset();
  });

  it('loads only the current registered name uploads and resolves station status', async () => {
    mockedSearch.mockImplementation(async (params) => {
      if (params.name !== LISTENER) return [];

      return [
        {
          service: 'JSON',
          name: LISTENER,
          identifier: getSubmissionQdnIdentifier('sub-1'),
          created: 1,
        },
        {
          service: 'JSON',
          name: LISTENER,
          identifier: getSubmissionQdnIdentifier('sub-2'),
          created: 2,
        },
      ];
    });

    mockedFetch.mockImplementation(async (ref) => {
      if (ref.identifier === getSubmissionQdnIdentifier('sub-1')) {
        return submission('sub-1', 'Pending Song');
      }

      if (ref.identifier === getSubmissionQdnIdentifier('sub-2')) {
        return submission('sub-2', 'Approved Song');
      }

      if (ref.identifier === getSubmissionModerationQdnIdentifier('sub-1')) {
        throw new Error('missing moderation');
      }

      if (ref.identifier === getSubmissionModerationQdnIdentifier('sub-2')) {
        return createSubmissionModeration({
          moderationId: 'sub-2',
          submissionId: 'sub-2',
          submissionRef: {
            service: 'JSON',
            name: LISTENER,
            identifier: getSubmissionQdnIdentifier('sub-2'),
          },
          decision: 'accepted',
          acceptedTrackId: 'sub-sub-2',
          moderatorAddress: STATION_ADDRESS,
        });
      }

      throw new Error(`unexpected ${String(ref.identifier)}`);
    });

    await loadListenerUploads(LISTENER, LISTENER_ADDRESS, STATION, STATION_ADDRESS);

    const uploads = getListenerUploads();
    expect(uploads).toHaveLength(2);
    expect(uploads.find((entry) => entry.submission.submissionId === 'sub-1')?.status).toBe(
      'PENDING',
    );
    expect(uploads.find((entry) => entry.submission.submissionId === 'sub-2')?.status).toBe(
      'ACCEPTED',
    );
    expect(uploads.every((entry) => entry.submission.submitterName === LISTENER)).toBe(true);
  });

  it('isolates account and registered name scope', async () => {
    mockedSearch.mockResolvedValue([]);
    mockedFetch.mockResolvedValue({});

    await loadListenerUploads(LISTENER, LISTENER_ADDRESS, STATION, STATION_ADDRESS);
    expect(getListenerUploads()).toHaveLength(0);
    expect(getListenerUploadsLoadAction(LISTENER, LISTENER_ADDRESS, STATION, STATION_ADDRESS)).toBe(
      'reuse',
    );
    expect(
      getListenerUploadsLoadAction('listener-b', LISTENER_ADDRESS, STATION, STATION_ADDRESS),
    ).toBe('load');

    await loadListenerUploads('listener-b', 'Q-listener-b', STATION, STATION_ADDRESS);
    expect(getListenerUploads()).toHaveLength(0);
  });
});
