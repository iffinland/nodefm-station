/* ============================================================
 * NodeFM Station — QDN Transaction Flow Model Tests
 * ============================================================ */

import { describe, expect, it, vi } from 'vitest';
import {
  createQdnTransactionState,
  deriveQdnTransactionPhase,
  markQdnTransactionChunkActive,
  markQdnTransactionChunkFailed,
  markQdnTransactionChunkSucceeded,
  runQdnTransactionChunks,
} from '../components/qdnTransactionFlow';

describe('qdn transaction flow model', () => {
  it('derives success, running, failed, and partial phases', () => {
    const state = createQdnTransactionState([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);

    expect(state.phase).toBe('idle');
    expect(deriveQdnTransactionPhase(state.chunks)).toBe('running');

    let next = markQdnTransactionChunkActive(state, 'a');
    expect(next.phase).toBe('running');

    next = markQdnTransactionChunkSucceeded(next, 'a');
    next = markQdnTransactionChunkFailed(next, 'b', 'failed');
    expect(next.phase).toBe('partial');

    const failed = markQdnTransactionChunkFailed(
      markQdnTransactionChunkSucceeded(state, 'b'),
      'a',
      'failed',
    );
    expect(failed.phase).toBe('partial');

    const allFailed = markQdnTransactionChunkFailed(
      markQdnTransactionChunkFailed(state, 'a', 'failed'),
      'b',
      'failed',
    );
    expect(allFailed.phase).toBe('failed');
  });

  it('runs chunks sequentially and stops at the first failure', async () => {
    const seen: string[] = [];
    const states: string[] = [];

    const result = await runQdnTransactionChunks(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      async (chunk) => {
        seen.push(chunk.id);
        if (chunk.id === 'b') {
          throw new Error('b failed');
        }
      },
      (state) => {
        states.push(state.phase);
      },
    );

    expect(seen).toEqual(['a', 'b']);
    expect(result.phase).toBe('partial');
    expect(result.chunks.find((chunk) => chunk.id === 'a')?.status).toBe('succeeded');
    expect(result.chunks.find((chunk) => chunk.id === 'b')?.status).toBe('failed');
    expect(result.chunks.find((chunk) => chunk.id === 'c')?.status).toBe('pending');
    expect(states).toContain('running');
    expect(states[states.length - 1]).toBe('partial');
  });

  it('marks all chunks succeeded and finalizes as success', async () => {
    const result = await runQdnTransactionChunks(
      [{ id: 'a', label: 'A' }],
      async () => {
        vi.fn();
      },
      () => undefined,
    );

    expect(result.phase).toBe('success');
    expect(result.retryable).toBe(false);
    expect(result.chunks[0].status).toBe('succeeded');
  });
});
