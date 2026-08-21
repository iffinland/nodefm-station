/* ============================================================
 * NodeFM Station — Bulk Import Workspace
 *
 * Role-neutral staging UI used by both Admin and Listener entry
 * points. Browser File/Blob/object-URL material lives only in the
 * in-memory transient registry; the durable batch never contains
 * it. Async analysis is epoch- and source-generation guarded so a
 * stale operation cannot mutate a replaced/removed row, survive an
 * account/scope change, or leak a preview URL.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addLocalStagingFiles,
  applyBulkImportExtraction,
  createBulkImportBatch,
  getBulkImportRow,
  markBulkImportRowAnalysisFailed,
  markBulkImportRowAnalyzing,
  removeBulkImportRow,
  setBulkImportMetadataField,
  setBulkImportRowCover,
  setBulkImportRowSelected,
  setBulkImportRowSource,
} from '../batchStore';
import { getBulkImportBatchSummary } from '../selectors';
import { unavailableBulkPublicationAdapter } from '../publicationAdapter';
import { sourceDescriptorsMatch } from '../sourceIdentity';
import {
  clearTransientRegistry,
  createBulkImportTransientRegistry,
  deleteTransientEntry,
  getTransientEntry,
  setTransientEntry,
  transientSourceKey,
} from '../transientRegistry';
import { BULK_IMPORT_MAX_TOTAL_BYTES } from '../limits';
import { extractEmbeddedAudioMetadata } from '../services/audioMetadata';
import { resolveLocalAudioDurationMs, shouldAttemptLocalAudioDecode } from '../services/localAudio';
import { loadBulkImportBatch, saveBulkImportBatch } from '../services/bulkImportStorage';
import type {
  BulkImportBatch,
  BulkImportDurationSource,
  BulkImportMetadataField,
  BulkImportRole,
  EmbeddedAudioMetadata,
} from '../types';
import { BulkImportRowEditor } from './BulkImportRowEditor';
import { BulkImportSummary } from './BulkImportSummary';

type BulkImportWorkspaceProps = {
  role: BulkImportRole;
  scope: string;
  onClose?: () => void;
  showHeader?: boolean;
};

type AnalysisEntry = { rowId: string; file: File };

/**
 * Key/remount the workspace by canonical role + scope. This makes an
 * account/scope transition a synchronous remount, so the previous
 * account's batch can never render under the new scope, even for one
 * React render.
 */
export function BulkImportWorkspace(props: BulkImportWorkspaceProps) {
  return <BulkImportWorkspaceInner key={`${props.role}:${props.scope}`} {...props} />;
}

function BulkImportWorkspaceInner({
  role,
  scope,
  onClose,
  showHeader = true,
}: BulkImportWorkspaceProps) {
  const [batch, setBatch] = useState<BulkImportBatch>(
    () => loadBulkImportBatch(role, scope) ?? createBulkImportBatch(role, scope),
  );
  const batchRef = useRef(batch);
  batchRef.current = batch;

  const workspaceEpochRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const transientRegistryRef = useRef(createBulkImportTransientRegistry());
  const livePreviewUrlsRef = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const commitBatch = useCallback((next: BulkImportBatch) => {
    batchRef.current = next;
    setBatch(next);
  }, []);

  const isCurrent = useCallback((epoch: number, rowId: string, generation: number) => {
    if (workspaceEpochRef.current !== epoch) return false;
    const row = getBulkImportRow(batchRef.current, rowId);
    return !!row && row.sourceGeneration === generation;
  }, []);

  const abortPreviousAnalysis = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const createCoverPreviewUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    livePreviewUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeCoverPreviewUrl = useCallback((url: string | null) => {
    if (url && livePreviewUrlsRef.current.delete(url)) {
      URL.revokeObjectURL(url);
    }
  }, []);

  const revokeAllCoverPreviewUrls = useCallback(() => {
    livePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    livePreviewUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    saveBulkImportBatch(batch);
  }, [batch]);

  useEffect(
    () => () => {
      workspaceEpochRef.current += 1;
      abortPreviousAnalysis();
      revokeAllCoverPreviewUrls();
      clearTransientRegistry(transientRegistryRef.current);
    },
    [abortPreviousAnalysis, revokeAllCoverPreviewUrls],
  );

  const analyzeEntries = useCallback(
    async (entries: ReadonlyArray<AnalysisEntry>) => {
      const taskEpoch = workspaceEpochRef.current;
      abortPreviousAnalysis();
      const controller = new AbortController();
      abortRef.current = controller;

      for (const entry of entries) {
        const before = batchRef.current;
        const startRow = getBulkImportRow(before, entry.rowId);
        if (!startRow) continue;

        const generation = startRow.sourceGeneration;
        if (!isCurrent(taskEpoch, entry.rowId, generation)) continue;

        commitBatch(markBulkImportRowAnalyzing(before, entry.rowId));

        let embedded: EmbeddedAudioMetadata | null = null;
        let error: string | null = null;

        if (entry.file.size > BULK_IMPORT_MAX_TOTAL_BYTES) {
          error = 'File exceeds the 100 MiB staging limit.';
        } else {
          try {
            embedded = await extractEmbeddedAudioMetadata(entry.file);
          } catch (caught) {
            error = caught instanceof Error ? caught.message : 'Audio metadata could not be read.';
          }
        }

        if (!isCurrent(taskEpoch, entry.rowId, generation)) continue;

        let durationMs: number | null = null;
        let durationSource: BulkImportDurationSource = 'none';

        if (embedded?.durationMs != null && embedded.durationMs > 0) {
          durationMs = embedded.durationMs;
          durationSource = 'embedded';
        } else if (shouldAttemptLocalAudioDecode(entry.file)) {
          const localDuration = await resolveLocalAudioDurationMs(entry.file, {
            signal: controller.signal,
          });
          if (!isCurrent(taskEpoch, entry.rowId, generation)) continue;
          if (localDuration !== null && localDuration > 0) {
            durationMs = localDuration;
            durationSource = 'local';
          }
        }

        if (!isCurrent(taskEpoch, entry.rowId, generation)) continue;

        if (embedded) {
          const latest = batchRef.current;
          const currentRow = getBulkImportRow(latest, entry.rowId);
          if (!currentRow || currentRow.sourceGeneration !== generation) continue;

          let coverPreviewUrl: string | null = null;
          let coverBlob: Blob | null = null;

          if (!currentRow.cover && embedded.picture) {
            coverBlob = new Blob([embedded.picture.data], {
              type: embedded.picture.format,
            });
            coverPreviewUrl = createCoverPreviewUrl(coverBlob);
          }

          const result = applyBulkImportExtraction(latest, entry.rowId, {
            metadata: embedded,
            durationMs,
            durationSource,
            coverPreviewUrl,
          });

          if (coverPreviewUrl && result.usedCoverPreviewUrl !== coverPreviewUrl) {
            revokeCoverPreviewUrl(coverPreviewUrl);
          }

          if (coverPreviewUrl && coverBlob && result.usedCoverPreviewUrl === coverPreviewUrl) {
            const key = transientSourceKey(latest.id, entry.rowId, generation);
            const existing = getTransientEntry(transientRegistryRef.current, key);
            if (existing) {
              setTransientEntry(transientRegistryRef.current, key, {
                ...existing,
                coverBlob,
                coverPreviewUrl,
              });
            }
          }

          commitBatch(result.batch);
        } else {
          const latest = batchRef.current;
          if (!getBulkImportRow(latest, entry.rowId)) continue;

          commitBatch(
            markBulkImportRowAnalysisFailed(
              latest,
              entry.rowId,
              error ?? 'Audio metadata could not be read.',
              durationMs,
            ),
          );
        }
      }
    },
    [abortPreviousAnalysis, commitBatch, createCoverPreviewUrl, isCurrent, revokeCoverPreviewUrl],
  );

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      const result = addLocalStagingFiles(batchRef.current, files);
      commitBatch(result.batch);

      for (const added of result.added) {
        const row = getBulkImportRow(result.batch, added.rowId);
        if (!row) continue;
        setTransientEntry(
          transientRegistryRef.current,
          transientSourceKey(result.batch.id, added.rowId, row.sourceGeneration),
          {
            batchId: result.batch.id,
            rowId: added.rowId,
            sourceGeneration: row.sourceGeneration,
            audioFile: added.file,
            coverBlob: null,
            coverPreviewUrl: null,
          },
        );
      }

      void analyzeEntries(result.added);
    },
    [analyzeEntries, commitBatch],
  );

  const handleSelect = useCallback(
    (rowId: string, selected: boolean) => {
      commitBatch(setBulkImportRowSelected(batchRef.current, rowId, selected));
    },
    [commitBatch],
  );

  const handleRemove = useCallback(
    (rowId: string) => {
      const current = batchRef.current;
      const row = getBulkImportRow(current, rowId);

      if (row) {
        const key = transientSourceKey(current.id, rowId, row.sourceGeneration);
        const entry = getTransientEntry(transientRegistryRef.current, key);
        if (entry?.coverPreviewUrl) revokeCoverPreviewUrl(entry.coverPreviewUrl);
        deleteTransientEntry(transientRegistryRef.current, key);
      }

      commitBatch(removeBulkImportRow(current, rowId));
    },
    [commitBatch, revokeCoverPreviewUrl],
  );

  const handleFieldChange = useCallback(
    (rowId: string, field: BulkImportMetadataField, value: string | string[]) => {
      commitBatch(setBulkImportMetadataField(batchRef.current, rowId, field, value));
    },
    [commitBatch],
  );

  const handleCoverSelected = useCallback(
    (rowId: string, file: File) => {
      const current = batchRef.current;
      const row = getBulkImportRow(current, rowId);
      if (!row) return;

      const key = transientSourceKey(current.id, rowId, row.sourceGeneration);
      const entry = getTransientEntry(transientRegistryRef.current, key);
      if (entry?.coverPreviewUrl) revokeCoverPreviewUrl(entry.coverPreviewUrl);

      const previewUrl = createCoverPreviewUrl(file);
      setTransientEntry(transientRegistryRef.current, key, {
        batchId: current.id,
        rowId,
        sourceGeneration: row.sourceGeneration,
        audioFile: entry?.audioFile ?? null,
        coverBlob: file,
        coverPreviewUrl: previewUrl,
      });

      commitBatch(
        setBulkImportRowCover(current, rowId, {
          origin: 'manual',
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          previewUrl,
        }),
      );
    },
    [commitBatch, createCoverPreviewUrl, revokeCoverPreviewUrl],
  );

  const handleCoverRemove = useCallback(
    (rowId: string) => {
      const current = batchRef.current;
      const row = getBulkImportRow(current, rowId);
      if (!row) return;

      const key = transientSourceKey(current.id, rowId, row.sourceGeneration);
      const entry = getTransientEntry(transientRegistryRef.current, key);
      if (entry?.coverPreviewUrl) revokeCoverPreviewUrl(entry.coverPreviewUrl);
      if (entry) {
        setTransientEntry(transientRegistryRef.current, key, {
          ...entry,
          coverBlob: null,
          coverPreviewUrl: null,
        });
      }

      commitBatch(setBulkImportRowCover(current, rowId, null));
    },
    [commitBatch, revokeCoverPreviewUrl],
  );

  const handleSourceSelected = useCallback(
    (rowId: string, file: File) => {
      const current = batchRef.current;
      const row = getBulkImportRow(current, rowId);
      if (!row) return;

      const candidate = {
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      };
      const isRebind = !row.audioSourceAvailable;

      if (isRebind && !sourceDescriptorsMatch(row.localSource, candidate)) {
        const previousName = row.localSource?.fileName ?? 'the previously staged file';
        const confirmed =
          typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(
                `"${file.name}" does not match ${previousName}. Replace this row with the new audio?`,
              )
            : true;

        if (!confirmed) return;
      }

      const oldKey = transientSourceKey(current.id, rowId, row.sourceGeneration);
      const oldEntry = getTransientEntry(transientRegistryRef.current, oldKey);
      const manualCover = row.cover?.origin === 'manual' ? oldEntry : undefined;

      if (row.cover?.origin === 'embedded' && row.cover.previewUrl) {
        revokeCoverPreviewUrl(row.cover.previewUrl);
      }

      const next = setBulkImportRowSource(current, rowId, candidate);
      commitBatch(next);

      const nextRow = getBulkImportRow(next, rowId);
      if (nextRow) {
        const nextKey = transientSourceKey(next.id, rowId, nextRow.sourceGeneration);
        setTransientEntry(transientRegistryRef.current, nextKey, {
          batchId: next.id,
          rowId,
          sourceGeneration: nextRow.sourceGeneration,
          audioFile: file,
          coverBlob: manualCover?.coverBlob ?? null,
          coverPreviewUrl: manualCover?.coverPreviewUrl ?? null,
        });

        if (oldKey !== nextKey) {
          deleteTransientEntry(transientRegistryRef.current, oldKey);
        }
      }

      void analyzeEntries([{ rowId, file }]);
    },
    [analyzeEntries, commitBatch, revokeCoverPreviewUrl],
  );

  const handleClearBatch = useCallback(() => {
    workspaceEpochRef.current += 1;
    abortPreviousAnalysis();
    revokeAllCoverPreviewUrls();
    clearTransientRegistry(transientRegistryRef.current);
    commitBatch(createBulkImportBatch(role, scope));
  }, [abortPreviousAnalysis, commitBatch, revokeAllCoverPreviewUrls, role, scope]);

  const summary = useMemo(() => getBulkImportBatchSummary(batch), [batch]);
  const capability = unavailableBulkPublicationAdapter.capability();
  const canPublish = summary.isPublicationReady && capability.status === 'available';
  const finalLabel = role === 'admin' ? 'Publish Selected Tracks' : 'Submit Selected Music';

  if (!scope.trim()) {
    return (
      <div className="bulk-import__empty">
        A Qortium identity is required to stage bulk music imports.
      </div>
    );
  }

  return (
    <div className="bulk-import">
      {showHeader ? (
        <header className="bulk-import__header">
          <div>
            <h2 className="bulk-import__title">
              {role === 'admin' ? 'Bulk Import' : 'Bulk Submit Music'}
            </h2>
            <p className="bulk-import__hint">
              Stage up to 15 local audio files for metadata review. Publication is intentionally
              deferred to the upcoming Qortium Home capability.
            </p>
          </div>
          <div className="bulk-import__header-actions">
            {onClose ? (
              <button className="button button--secondary" type="button" onClick={onClose}>
                Close
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      <div className="bulk-import__controls">
        <button
          className="button button--primary"
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          Add Local Audio Files (staging only)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []).filter((file) => file.size > 0);
            handleFilesSelected(files);
            event.target.value = '';
          }}
        />
        <button className="button button--secondary" type="button" onClick={handleClearBatch}>
          Clear Batch
        </button>
      </div>

      <BulkImportSummary summary={summary} capabilityMessage={capability.message} />

      <div className="bulk-import__rows">
        {batch.rows.length === 0 ? (
          <p className="bulk-import__empty">No staged tracks yet. Add audio files to begin.</p>
        ) : (
          batch.rows.map((row) => (
            <BulkImportRowEditor
              key={row.id}
              row={row}
              onSelect={(selected) => handleSelect(row.id, selected)}
              onRemove={() => handleRemove(row.id)}
              onFieldChange={(field, value) => handleFieldChange(row.id, field, value)}
              onCoverSelected={(file) => handleCoverSelected(row.id, file)}
              onCoverRemove={() => handleCoverRemove(row.id)}
              onReselectSource={(file) => handleSourceSelected(row.id, file)}
            />
          ))
        )}
      </div>

      <div className="bulk-import__blockers">
        {summary.publicationBlockers.map((blocker) => (
          <p key={blocker} className="bulk-import__blocker">
            {blocker}
          </p>
        ))}
      </div>

      <footer className="bulk-import__footer">
        <button className="button button--primary" type="button" disabled={!canPublish}>
          {finalLabel}
        </button>
        {!canPublish ? (
          <p className="bulk-import__footer-note">
            Final publication is disabled until validation passes and the A2 Home capability is
            available.
          </p>
        ) : null}
      </footer>
    </div>
  );
}
