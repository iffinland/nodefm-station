/* ============================================================
 * NodeFM Station — QDN Read Contract Tests
 *
 * Focused tests against the production QDN integration/parser
 * code for the current Qortium Home contract.
 * ============================================================ */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../qortium/bridge', () => ({
  sendBridgeRequest: vi.fn(),
}));

import { sendBridgeRequest } from '../qortium/bridge';
import {
  decodeQdnResourcePayload,
  deleteQdnResource,
  ensureQdnResourceReady,
  fetchQdnResourceData,
  getQdnResourceUrl,
  publishResource,
  requireQdnResourceUrl,
  searchQdnResources,
} from '../qortium/qdn';
import { createTrack, deserializeTrackFromQdn } from '../features/tracks/services/trackService';
import {
  deserializePlaylistFromQdn,
  deserializePlaylistVersionFromQdn,
} from '../features/playlists/services/playlistService';
import type { CreateTrackInput } from '../features/tracks/services/trackService';
import {
  isConfirmedQdnNotFoundError,
  QDN_FILE_NOT_FOUND_ERROR,
  QdnResourceReadError,
} from '../qortium/qdnReadError';

const mockedSend = vi.mocked(sendBridgeRequest);

function validCreateTrackInput(overrides: Partial<CreateTrackInput> = {}): CreateTrackInput {
  return {
    title: 'Test Track',
    audio: { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
    durationMs: 1000,
    source: 'qdn-existing',
    ownerAddress: 'Q-owner',
    ...overrides,
  };
}

describe('GET_QDN_RESOURCE_URL raw string contract', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('accepts a raw URL string', () => {
    expect(requireQdnResourceUrl('https://node.example/render/AUDIO/Owner/audio-1')).toBe(
      'https://node.example/render/AUDIO/Owner/audio-1',
    );
  });

  it('rejects empty, whitespace, and non-string values', () => {
    expect(() => requireQdnResourceUrl('')).toThrow(/resource URL string/);
    expect(() => requireQdnResourceUrl('   ')).toThrow(/resource URL string/);
    expect(() => requireQdnResourceUrl({ url: 'https://node.example' })).toThrow(
      /resource URL string/,
    );
    expect(() => requireQdnResourceUrl(null)).toThrow(/resource URL string/);
    expect(() => requireQdnResourceUrl(undefined)).toThrow(/resource URL string/);
  });

  it('returns the bridge value directly without reading a .url envelope', async () => {
    const url = 'https://node.example/render/AUDIO/Owner/audio-1';
    mockedSend.mockResolvedValue(url);

    await expect(
      getQdnResourceUrl({ service: 'AUDIO', name: 'Owner', identifier: 'audio-1' }),
    ).resolves.toBe(url);

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'GET_QDN_RESOURCE_URL',
      service: 'AUDIO',
      name: 'Owner',
      identifier: 'audio-1',
    });
  });

  it('rejects the obsolete { url } envelope', async () => {
    mockedSend.mockResolvedValue({ url: 'https://node.example/render/AUDIO/Owner/audio-1' });

    await expect(
      getQdnResourceUrl({ service: 'AUDIO', name: 'Owner', identifier: 'audio-1' }),
    ).rejects.toThrow(/resource URL string/);
  });
});

describe('FETCH_QDN_RESOURCE payload decoder', () => {
  it('passes through an already parsed JSON object', () => {
    const payload = { trackId: 't1', durationMs: 1000 };
    expect(decodeQdnResourcePayload(payload)).toBe(payload);
  });

  it('passes through an already parsed JSON array', () => {
    const payload = [{ a: 1 }];
    expect(decodeQdnResourcePayload(payload)).toBe(payload);
  });

  it('parses a raw JSON string', () => {
    expect(decodeQdnResourcePayload('{"trackId":"t1","durationMs":1000}')).toEqual({
      trackId: 't1',
      durationMs: 1000,
    });
  });

  it('parses a raw JSON array string', () => {
    expect(decodeQdnResourcePayload('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns appropriate raw non-JSON string content unchanged', () => {
    expect(decodeQdnResourcePayload('not-json-content')).toBe('not-json-content');
  });

  it('fails explicitly on malformed JSON-looking payloads', () => {
    expect(() => decodeQdnResourcePayload('{not-json')).toThrow(/malformed JSON/);
  });

  it('fails explicitly on empty payloads', () => {
    expect(() => decodeQdnResourcePayload(null)).toThrow(/empty/);
    expect(() => decodeQdnResourcePayload(undefined)).toThrow(/empty/);
    expect(() => decodeQdnResourcePayload('')).toThrow(/empty/);
    expect(() => decodeQdnResourcePayload('   ')).toThrow(/empty/);
  });
});

describe('fetchQdnResourceData', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('returns an already parsed object from the bridge', async () => {
    const payload = { trackId: 't1', durationMs: 1000 };
    mockedSend.mockResolvedValue(payload);

    await expect(
      fetchQdnResourceData({ service: 'JSON', name: 'Owner', identifier: 'track-t1' }),
    ).resolves.toBe(payload);
  });

  it('decodes a raw JSON string from the bridge', async () => {
    mockedSend.mockResolvedValue('{"trackId":"t1","durationMs":1000}');

    await expect(
      fetchQdnResourceData({ service: 'JSON', name: 'Owner', identifier: 'track-t1' }),
    ).resolves.toEqual({ trackId: 't1', durationMs: 1000 });
  });

  it('returns raw non-JSON string content unchanged', async () => {
    mockedSend.mockResolvedValue('raw-audio-content');

    await expect(
      fetchQdnResourceData({ service: 'AUDIO', name: 'Owner', identifier: 'audio-1' }),
    ).resolves.toBe('raw-audio-content');
  });

  it('rejects malformed JSON payloads explicitly', async () => {
    mockedSend.mockResolvedValue('{bad-json');

    await expect(
      fetchQdnResourceData({ service: 'JSON', name: 'Owner', identifier: 'track-t1' }),
    ).rejects.toThrow(/malformed JSON/);
  });

  it('classifies a Core 1401 missing PUT transaction as NOT_FOUND', async () => {
    mockedSend.mockRejectedValue(
      new Error(
        "QDN error 1401: Couldn't find PUT transaction for name Owner, service JSON and identifier track-t1",
      ),
    );

    try {
      await fetchQdnResourceData({ service: 'JSON', name: 'Owner', identifier: 'track-t1' });
      throw new Error('Expected fetchQdnResourceData to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(QdnResourceReadError);
      expect((error as QdnResourceReadError).code).toBe('NOT_FOUND');
    }
  });

  it('keeps transient read failures UNAVAILABLE, not NOT_FOUND', async () => {
    mockedSend.mockRejectedValue(new Error('temporarily unavailable'));

    try {
      await fetchQdnResourceData({ service: 'JSON', name: 'Owner', identifier: 'track-t1' });
      throw new Error('Expected fetchQdnResourceData to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(QdnResourceReadError);
      expect((error as QdnResourceReadError).code).toBe('UNAVAILABLE');
    }
  });
});

describe('QDN read error classification', () => {
  it('recognizes current Core file-not-found semantics', () => {
    expect(isConfirmedQdnNotFoundError(new QdnResourceReadError('NOT_FOUND', 'missing'))).toBe(
      true,
    );
    expect(
      isConfirmedQdnNotFoundError(
        new Error(
          `Couldn't find PUT transaction for name Owner, service JSON and identifier track-t1`,
        ),
      ),
    ).toBe(true);
    expect(
      isConfirmedQdnNotFoundError(
        new Error(
          JSON.stringify({
            error: QDN_FILE_NOT_FOUND_ERROR,
            message: "Couldn't find PUT transaction for name Owner",
          }),
        ),
      ),
    ).toBe(true);
  });

  it('does not collapse malformed or unavailable failures into not-found', () => {
    expect(
      isConfirmedQdnNotFoundError(new QdnResourceReadError('UNAVAILABLE', 'network failed')),
    ).toBe(false);
    expect(isConfirmedQdnNotFoundError(new Error('temporarily unavailable'))).toBe(false);
    expect(
      isConfirmedQdnNotFoundError(new Error('QDN error 125: identifier must not exceed 64 bytes')),
    ).toBe(false);
  });
});

describe('QDN write request shapes', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('publishes with the registered Qortium name and identifier', async () => {
    mockedSend.mockResolvedValue({ accepted: true });

    await publishResource({
      service: 'JSON',
      name: 'Owner',
      identifier: 'nodefm-track-t1',
      data64: 'eyJ0cmFja0lkIjoidDEifQ==',
      title: 'Track',
    });

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'PUBLISH_QDN_RESOURCE',
      service: 'JSON',
      name: 'Owner',
      identifier: 'nodefm-track-t1',
      data64: 'eyJ0cmFja0lkIjoidDEifQ==',
      title: 'Track',
    });
  });

  it('normalizes Unicode inline filenames to a transport-safe ASCII name', async () => {
    mockedSend.mockResolvedValue({ accepted: true });

    await publishResource({
      service: 'IMAGE',
      name: 'Owner',
      identifier: 'nodefm-cover-1',
      data64: 'aW1hZ2U=',
      filename: 'cover õhtu.png',
    });

    const payload = mockedSend.mock.calls[0][0] as {
      filename?: string;
      sourceToken?: string;
    };

    expect(payload.filename).toMatch(/^nodefm-upload-[a-z0-9]+\.png$/);
    expect(payload.sourceToken).toBeUndefined();
  });

  it('leaves sourceToken filenames unchanged because Home uses the selected source name', async () => {
    mockedSend.mockResolvedValue({ accepted: true });

    await publishResource({
      service: 'AUDIO',
      name: 'Owner',
      identifier: 'nodefm-audio-1',
      sourceToken: 'token-1',
      filename: 'Metsajärve öö.mp3',
    });

    const payload = mockedSend.mock.calls[0][0] as { filename?: string; sourceToken?: string };

    expect(payload.sourceToken).toBe('token-1');
    expect(payload.filename).toBe('Metsajärve öö.mp3');
  });

  it('deletes only the requested resource identifier', async () => {
    mockedSend.mockResolvedValue({ accepted: true });

    await deleteQdnResource({
      service: 'JSON',
      name: 'Owner',
      identifier: 'nodefm-track-t1',
    });

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'DELETE_QDN_RESOURCE',
      service: 'JSON',
      name: 'Owner',
      identifier: 'nodefm-track-t1',
    });
  });
});

describe('SEARCH_QDN_RESOURCES request shape', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('defaults to mode=ALL so prefix reconstruction returns every matching identifier', async () => {
    mockedSend.mockResolvedValue([]);

    await searchQdnResources({
      service: 'JSON',
      name: 'Owner',
      query: 'nodefm-track-',
      prefix: true,
      limit: 500,
      includeMetadata: true,
      includeStatus: true,
    });

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'SEARCH_QDN_RESOURCES',
      mode: 'ALL',
      limit: 500,
      service: 'JSON',
      name: 'Owner',
      query: 'nodefm-track-',
      prefix: true,
      includeMetadata: true,
      includeStatus: true,
    });
  });

  it('preserves an explicit LATEST mode when requested', async () => {
    mockedSend.mockResolvedValue([]);

    await searchQdnResources({
      service: 'AUDIO',
      query: 'nodefm-audio-',
      prefix: true,
      mode: 'LATEST',
    });

    expect(mockedSend).toHaveBeenCalledWith({
      action: 'SEARCH_QDN_RESOURCES',
      mode: 'LATEST',
      limit: 50,
      service: 'AUDIO',
      query: 'nodefm-audio-',
      prefix: true,
    });
  });
});

describe('QDN resource readiness', () => {
  beforeEach(() => {
    mockedSend.mockReset();
  });

  it('resolves immediately for an already READY resource', async () => {
    mockedSend.mockResolvedValue({ status: 'READY' });

    await expect(
      ensureQdnResourceReady({ service: 'AUDIO', name: 'Owner', identifier: 'audio-1' }),
    ).resolves.toBeUndefined();

    expect(mockedSend).toHaveBeenCalledTimes(1);
  });

  it('triggers a build for buildable statuses and waits for READY', async () => {
    mockedSend
      .mockResolvedValueOnce({ status: 'PUBLISHED' })
      .mockResolvedValueOnce({ status: 'BUILDING' })
      .mockResolvedValueOnce({ status: 'READY' });

    await ensureQdnResourceReady(
      { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
      { retries: 3, delayMs: 1 },
    );

    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'GET_QDN_RESOURCE_STATUS',
        build: true,
      }),
    );
  });

  it('fails explicitly for a missing resource', async () => {
    mockedSend.mockResolvedValue({ status: 'NOT_PUBLISHED' });

    await expect(
      ensureQdnResourceReady({ service: 'AUDIO', name: 'Owner', identifier: 'audio-1' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('never treats uncertainty as ready', async () => {
    mockedSend.mockResolvedValue({ status: 'BUILDING' });

    await expect(
      ensureQdnResourceReady(
        { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
        { retries: 3, delayMs: 1 },
      ),
    ).rejects.toThrow(/not ready/);
  });
});

describe('duration integrity', () => {
  it('rejects invalid durations when creating a track', () => {
    expect(() => createTrack(validCreateTrackInput({ durationMs: 0 }))).toThrow(
      /positive integer durationMs/,
    );
    expect(() => createTrack(validCreateTrackInput({ durationMs: -1 }))).toThrow(
      /positive integer durationMs/,
    );
    expect(() => createTrack(validCreateTrackInput({ durationMs: Number.NaN }))).toThrow(
      /positive integer durationMs/,
    );
    expect(() => createTrack(validCreateTrackInput({ durationMs: 1000.5 }))).toThrow(
      /positive integer durationMs/,
    );
    expect(() =>
      createTrack(validCreateTrackInput({ durationMs: undefined as unknown as number })),
    ).toThrow(/positive integer durationMs/);
  });

  it('creates a track only when duration is a valid positive integer', () => {
    const track = createTrack(validCreateTrackInput({ durationMs: 1000 }));
    expect(track.durationMs).toBe(1000);
  });

  it('never deserializes a track with an invalid duration as valid', () => {
    expect(
      deserializeTrackFromQdn({
        trackId: 't1',
        ownerAddress: 'Q-owner',
        title: 'Test',
        audio: { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
        durationMs: 0,
        source: 'qdn-existing',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('deserializes a valid parsed track object', () => {
    const track = {
      trackId: 't1',
      ownerAddress: 'Q-owner',
      title: 'Test',
      audio: { service: 'AUDIO', name: 'Owner', identifier: 'audio-1' },
      durationMs: 1000,
      source: 'qdn-existing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(deserializeTrackFromQdn(track)).toEqual(track);
  });
});

describe('playlist and version deserialization', () => {
  it('deserializes a parsed playlist object', () => {
    const playlist = {
      playlistId: 'p1',
      ownerAddress: 'Q-owner',
      title: 'Playlist',
      visibility: 'public',
      latestVersionId: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(deserializePlaylistFromQdn(playlist)).toEqual(playlist);
  });

  it('deserializes a parsed playlist version object', () => {
    const version = {
      playlistId: 'p1',
      versionId: 'v1',
      versionNumber: 1,
      createdBy: 'Q-owner',
      createdAt: '2026-01-01T00:00:00.000Z',
      tracks: [{ trackId: 't1', durationMs: 1000 }],
      totalDurationMs: 1000,
    };

    expect(deserializePlaylistVersionFromQdn(version)).toEqual(version);
  });
});
