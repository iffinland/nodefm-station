/* ============================================================
 * NodeFM Station — Track Cover Resolution Tests
 *
 * Regression coverage for the production cover URL path. Cover
 * resolution must be best-effort and must never block audio.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  sendBridgeRequest: vi.fn(),
}));

import { sendBridgeRequest } from '../qortium/bridge';
import {
  resolveQdnCoverUrl,
  resolveTrackPlayback,
  resolveTrackCoverUrl,
} from '../features/radio/player/resolveTrackPlayback';
import type { Track } from '../types/domain';

const mockedSend = vi.mocked(sendBridgeRequest);

const cover = {
  service: 'IMAGE',
  name: 'Owner',
  identifier: 'cover-1',
};

function trackWithCover(): Track {
  return {
    schemaVersion: 1,
    trackId: 'track-1',
    ownerAddress: 'Q-owner',
    title: 'Track',
    audio: { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
    cover,
    durationMs: 1000,
    source: 'station-upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('track cover resolution', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('resolves a ready cover to its ranged QDN stream URL', async () => {
    mockedSend.mockImplementation(async (request) => {
      if (request.action === 'GET_QDN_RESOURCE_STATUS') {
        return { status: 'READY' };
      }

      if (request.action === 'GET_QDN_RESOURCE_STREAM_URL') {
        return 'https://home.invalid/qdn-media/cover-token';
      }

      throw new Error(`Unexpected request: ${String(request.action)}`);
    });

    await expect(resolveQdnCoverUrl(cover)).resolves.toBe(
      'https://home.invalid/qdn-media/cover-token',
    );
  });

  it('uses the ranged stream action for both native audio and cover image elements', async () => {
    mockedSend.mockImplementation(async (request) => {
      if (request.action === 'GET_QDN_RESOURCE_STATUS') {
        return { status: 'READY' };
      }

      if (request.action === 'GET_QDN_RESOURCE_STREAM_URL') {
        return request.service === 'AUDIO'
          ? 'https://home.invalid/qdn-media/audio-token'
          : 'https://home.invalid/qdn-media/cover-token';
      }

      throw new Error(`Unexpected request: ${String(request.action)}`);
    });

    await expect(resolveTrackPlayback(trackWithCover())).resolves.toEqual({
      audioUrl: 'https://home.invalid/qdn-media/audio-token',
    });
    await expect(resolveTrackCoverUrl(trackWithCover())).resolves.toBe(
      'https://home.invalid/qdn-media/cover-token',
    );

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'GET_QDN_RESOURCE_STREAM_URL',
      service: 'AUDIO',
      name: 'Owner',
      identifier: 'audio-1',
    });
    expect(mockedSend).toHaveBeenCalledWith({
      action: 'GET_QDN_RESOURCE_STREAM_URL',
      service: 'IMAGE',
      name: 'Owner',
      identifier: 'cover-1',
    });
  });

  it('still retrieves the URL when readiness polling fails', async () => {
    mockedSend.mockImplementation(async (request) => {
      if (request.action === 'GET_QDN_RESOURCE_STATUS') {
        return { status: 'NOT_PUBLISHED' };
      }

      if (request.action === 'GET_QDN_RESOURCE_STREAM_URL') {
        return 'https://home.invalid/qdn-media/cover-token';
      }

      throw new Error(`Unexpected request: ${String(request.action)}`);
    });

    await expect(resolveQdnCoverUrl(cover)).resolves.toBe(
      'https://home.invalid/qdn-media/cover-token',
    );
  });

  it('returns undefined instead of throwing when URL retrieval fails', async () => {
    mockedSend.mockImplementation(async (request) => {
      if (request.action === 'GET_QDN_RESOURCE_STATUS') {
        return { status: 'READY' };
      }

      throw new Error('URL unavailable');
    });

    await expect(resolveQdnCoverUrl(cover)).resolves.toBeUndefined();
  });

  it('returns undefined for tracks without a cover reference', async () => {
    const track = {
      ...trackWithCover(),
      cover: undefined,
    };

    await expect(resolveTrackCoverUrl(track)).resolves.toBeUndefined();
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
