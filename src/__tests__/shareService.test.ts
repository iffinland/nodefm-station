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
        _qdnIdentifier: 'Radio-AutoDJ',
      }),
    ).toBe('qdn://APP/NodeFM/Radio-AutoDJ');
  });

  it('falls back to the canonical NodeFM APP identity when host globals are absent', () => {
    expect(buildAppShareTarget({})).toBe('qdn://APP/NodeFM/Radio-AutoDJ');
  });
});

describe('canonical playlist share target', () => {
  it('produces a NodeFM APP playlist route, not a raw PLAYLIST viewer URL', () => {
    expect(buildPlaylistShareTarget('playlist-1')).toBe(
      'qdn://APP/NodeFM/Radio-AutoDJ/playlists/playlist-1',
    );
  });

  it('encodes spaces and special characters in the playlist route segment', () => {
    expect(buildPlaylistShareTarget('playlist / 1')).toBe(
      'qdn://APP/NodeFM/Radio-AutoDJ/playlists/playlist%20%2F%201',
    );
  });

  it('builds typed share targets', () => {
    expect(buildShareTarget({ kind: 'app' }, {})).toBe('qdn://APP/NodeFM/Radio-AutoDJ');

    expect(
      buildShareTarget(
        { kind: 'playlist', playlistId: 'p1' },
        { _qdnService: 'APP', _qdnName: 'NodeFM', _qdnIdentifier: 'Radio-AutoDJ' },
      ),
    ).toBe('qdn://APP/NodeFM/Radio-AutoDJ/playlists/p1');
  });

  it('never emits the obsolete Learning DEV - iffi identity', () => {
    const app = buildAppShareTarget({});
    const playlist = buildPlaylistShareTarget('p1', {});

    expect(app).not.toContain('Learning DEV - iffi');
    expect(playlist).not.toContain('Learning DEV - iffi');
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
