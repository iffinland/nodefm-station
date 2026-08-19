/* ============================================================
 * NodeFM Station — Share Service Tests
 * ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  buildAppShareTarget,
  buildPlaylistShareTarget,
  buildShareTarget,
  copyShareTarget,
} from '../features/sharing/services/shareService';

describe('canonical app share target', () => {
  it('uses the current QDN host identity when available', () => {
    expect(
      buildAppShareTarget({
        _qdnService: 'APP',
        _qdnName: 'NodeFM',
        _qdnIdentifier: 'NodeFM',
      }),
    ).toBe('qdn://APP/NodeFM/NodeFM');
  });

  it('returns null rather than inventing an app identity', () => {
    expect(buildAppShareTarget({})).toBeNull();
  });
});

describe('canonical playlist share target', () => {
  it('uses the published playlist QDN identifier', () => {
    expect(buildPlaylistShareTarget('Learning DEV - iffi', 'playlist-1')).toBe(
      'qdn://PLAYLIST/Learning%20DEV%20-%20iffi/nodefm-playlist-playlist-1',
    );
  });

  it('builds typed share targets', () => {
    expect(
      buildShareTarget(
        { kind: 'playlist', publisherName: 'station', playlistId: 'p1' },
        { _qdnService: 'APP', _qdnName: 'NodeFM', _qdnIdentifier: 'NodeFM' },
      ),
    ).toBe('qdn://PLAYLIST/station/nodefm-playlist-p1');
  });
});

describe('clipboard copy', () => {
  it('returns true when the modern clipboard API succeeds', async () => {
    const writeText = async () => {};
    const result = await copyShareTarget('qdn://APP/NodeFM/NodeFM', {
      navigator: { clipboard: { writeText } },
    });

    expect(result).toBe(true);
  });

  it('falls back to execCommand copy when the modern API fails', async () => {
    const execCommand = () => true;
    const body = {
      appendChild: () => {},
      removeChild: () => {},
    } as unknown as Pick<Document, 'body' | 'createElement' | 'execCommand'>['body'];
    const createElement = () =>
      ({
        value: '',
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
        setSelectionRange: () => {},
        style: {},
      }) as unknown as ReturnType<Document['createElement']>;

    const result = await copyShareTarget('qdn://APP/NodeFM/NodeFM', {
      navigator: {
        clipboard: {
          writeText: async () => {
            throw new Error('denied');
          },
        },
      },
      document: {
        body,
        createElement,
        execCommand,
      },
    });

    expect(result).toBe(true);
  });

  it('returns false when copy is unavailable', async () => {
    await expect(
      copyShareTarget('qdn://APP/NodeFM/NodeFM', {
        navigator: {},
        document: {
          body: null as unknown as HTMLElement,
          createElement: () => ({}) as never,
          execCommand: () => false,
        },
      }),
    ).resolves.toBe(false);
  });
});
