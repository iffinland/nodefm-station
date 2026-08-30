/* ============================================================
 * NodeFM Station — QDN Transaction Flow Model
 *
 * Small, UI-independent state machine for presenting a coordinated
 * QDN operation as a sequence of chunks. It does not know anything
 * about React, the bridge, or a specific feature. Components render
 * `QdnTransactionState` and services/features advance it.
 * ============================================================ */

export type QdnTransactionChunkStatus = 'pending' | 'active' | 'succeeded' | 'failed' | 'skipped';

export type QdnTransactionPhase = 'idle' | 'running' | 'success' | 'partial' | 'failed';

export type QdnTransactionChunk = {
  id: string;
  label: string;
  detail?: string;
  status: QdnTransactionChunkStatus;
  error?: string;
};

export type QdnTransactionState = {
  phase: QdnTransactionPhase;
  chunks: QdnTransactionChunk[];
  error?: string;
  retryable: boolean;
  cancelable: boolean;
  successMessage?: string;
};

export type QdnTransactionChunkSpec = {
  id: string;
  label: string;
  detail?: string;
};

export function createQdnTransactionState(
  specs: readonly QdnTransactionChunkSpec[],
  options: {
    cancelable?: boolean;
    retryable?: boolean;
  } = {},
): QdnTransactionState {
  return {
    phase: 'idle',
    chunks: specs.map((spec) => ({
      id: spec.id,
      label: spec.label,
      detail: spec.detail,
      status: 'pending',
    })),
    error: undefined,
    retryable: options.retryable ?? false,
    cancelable: options.cancelable ?? false,
  };
}

export function deriveQdnTransactionPhase(
  chunks: readonly QdnTransactionChunk[],
): QdnTransactionPhase {
  if (chunks.length === 0) {
    return 'success';
  }

  const failedCount = chunks.filter((chunk) => chunk.status === 'failed').length;
  const pendingCount = chunks.filter((chunk) => chunk.status === 'pending').length;
  const activeCount = chunks.filter((chunk) => chunk.status === 'active').length;

  if (failedCount > 0) {
    const succeededCount = chunks.filter((chunk) => chunk.status === 'succeeded').length;
    return succeededCount > 0 ? 'partial' : 'failed';
  }

  if (activeCount > 0 || pendingCount > 0) {
    return 'running';
  }

  return 'success';
}

export function updateQdnTransactionChunk(
  state: QdnTransactionState,
  chunkId: string,
  patch: Partial<Pick<QdnTransactionChunk, 'status' | 'detail' | 'error'>>,
): QdnTransactionState {
  const chunks = state.chunks.map((chunk) =>
    chunk.id === chunkId ? { ...chunk, ...patch } : chunk,
  );

  return {
    ...state,
    chunks,
    phase: deriveQdnTransactionPhase(chunks),
  };
}

export function markQdnTransactionChunkActive(
  state: QdnTransactionState,
  chunkId: string,
): QdnTransactionState {
  return updateQdnTransactionChunk(state, chunkId, { status: 'active', error: undefined });
}

export function markQdnTransactionChunkSucceeded(
  state: QdnTransactionState,
  chunkId: string,
  detail?: string,
): QdnTransactionState {
  return updateQdnTransactionChunk(state, chunkId, {
    status: 'succeeded',
    detail,
    error: undefined,
  });
}

export function markQdnTransactionChunkFailed(
  state: QdnTransactionState,
  chunkId: string,
  error?: string,
): QdnTransactionState {
  return updateQdnTransactionChunk(state, chunkId, { status: 'failed', error });
}

export function setQdnTransactionError(
  state: QdnTransactionState,
  error: string,
): QdnTransactionState {
  return {
    ...state,
    error,
  };
}

export function finalizeQdnTransaction(
  state: QdnTransactionState,
  options: {
    error?: string;
    successMessage?: string;
  } = {},
): QdnTransactionState {
  const chunks = state.chunks.map((chunk) => {
    if (chunk.status === 'active') {
      return { ...chunk, status: options.error ? 'failed' : 'succeeded' } as const;
    }
    return chunk;
  });

  return {
    ...state,
    chunks,
    phase: deriveQdnTransactionPhase(chunks),
    error: options.error,
    successMessage: options.successMessage,
  };
}

/**
 * Execute chunk operations sequentially and emit an immutable state after
 * every transition. The runner stops on the first failed chunk and returns
 * the final state. This is intentionally a pure orchestration helper; callers
 * provide the operations and keep any feature-specific recovery data.
 */
export async function runQdnTransactionChunks(
  specs: readonly QdnTransactionChunkSpec[],
  runChunk: (chunk: QdnTransactionChunkSpec) => Promise<void>,
  onStateChange: (state: QdnTransactionState) => void,
): Promise<QdnTransactionState> {
  let state = createQdnTransactionState(specs, { cancelable: false, retryable: true });
  onStateChange(state);

  for (const spec of specs) {
    state = markQdnTransactionChunkActive(state, spec.id);
    onStateChange(state);

    try {
      await runChunk(spec);
      state = markQdnTransactionChunkSucceeded(state, spec.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'QDN operation failed.';
      state = markQdnTransactionChunkFailed(state, spec.id, message);
      state = setQdnTransactionError(state, message);
      onStateChange(state);
      return state;
    }

    onStateChange(state);
  }

  state = {
    ...state,
    phase: 'success',
    error: undefined,
    retryable: false,
  };
  onStateChange(state);
  return state;
}
