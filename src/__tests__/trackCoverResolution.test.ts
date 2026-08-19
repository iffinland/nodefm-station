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

  it('resolves a ready cover to its QDN URL', async () => {
    mockedSend.mockImplementation(async (request) => {
      if (request.action === 'GET_QDN_RESOURCE_STATUS') {
        return { status: 'READY' };
      }

      if (request.action === 'GET_QDN_RESOURCE_URL') {
        return '/render/IMAGE/Owner/cover-1';
      }

      throw new Error(`Unexpected request: ${String(request.action)}`);
    });

    await expect(resolveQdnCoverUrl(cover)).resolves.toBe('/render/IMAGE/Owner/cover-1');
  });

  it('still retrieves the URL when readiness polling fails', async () => {
    mockedSend.mockImplementation(async (request) => {
      if (request.action === 'GET_QDN_RESOURCE_STATUS') {
        return { status: 'NOT_PUBLISHED' };
      }

      if (request.action === 'GET_QDN_RESOURCE_URL') {
        return '/arbitrary/IMAGE/Owner/cover-1';
      }

      throw new Error(`Unexpected request: ${String(request.action)}`);
    });

    await expect(resolveQdnCoverUrl(cover)).resolves.toBe('/arbitrary/IMAGE/Owner/cover-1');
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
