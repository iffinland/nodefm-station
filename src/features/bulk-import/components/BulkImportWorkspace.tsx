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
import { isBridgeAvailable } from '../../../qortium/bridge';
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
import { mapBulkImportRoleToPublicationIntent } from '../publicationAdapter';
import type {
  BulkPublicationCapability,
  BulkPublicationIntent,
  BulkPublicationSourceDescriptor,
} from '../publicationAdapter';
import { sourceDescriptorsMatch } from '../sourceIdentity';
import {
  createHome2BulkPublicationAdapter,
  Home2ReconciliationRequiredError,
} from '../home2BulkPublicationAdapter';
import type { Home2BulkPublicationAdapter } from '../home2BulkPublicationAdapter';
import {
  applyBulkPublicationRowResultToBatch,
  applyBulkPublicationSourceAcquisitionToBatch,
  getHome2ResourcePublicationUiState,
  home2ResourcePublicationFailureMessage,
  home2RowPublicationFailureMessage,
  isHome2AudioPublished,
  isHome2AudioUnknown,
  isHome2MetadataReadyToExport,
  isHome2ResourcePublished,
  isHome2ResourceUnknown,
} from '../home2PublicationReducer';
import type { Home2ResourcePublicationUiState } from '../home2PublicationReducer';
import {
  createBulkImportMetadataArtifact,
  downloadBulkImportMetadataArtifact,
  isBulkImportMetadataArtifactCurrent,
  type BulkImportMetadataArtifact,
} from '../metadataExport';
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
  BulkImportRow,
  EmbeddedAudioMetadata,
} from '../types';
import { BulkImportRowEditor } from './BulkImportRowEditor';
import { BulkImportSummary } from './BulkImportSummary';
import { SystemStatusNotice } from './SystemStatusNotice';

type BulkImportWorkspaceProps = {
  role: BulkImportRole;
  scope: string;
  onClose?: () => void;
  showHeader?: boolean;
  actorName?: string | null;
  actorAddress?: string | null;
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
  actorName = null,
  actorAddress = null,
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

  const adapterRef = useRef<Home2BulkPublicationAdapter | null>(null);
  if (adapterRef.current === null) {
    adapterRef.current = createHome2BulkPublicationAdapter();
  }
  const publicationAdapter = adapterRef.current;

  const [capability, setCapability] = useState<BulkPublicationCapability>(
    publicationAdapter.capability(),
  );
  const [nativeSources, setNativeSources] = useState<
    Record<string, BulkPublicationSourceDescriptor | null>
  >({});
  const nativeSourcesRef = useRef(nativeSources);
  nativeSourcesRef.current = nativeSources;
  const [nativeCoverSources, setNativeCoverSources] = useState<
    Record<string, BulkPublicationSourceDescriptor | null>
  >({});
  const nativeCoverSourcesRef = useRef(nativeCoverSources);
  nativeCoverSourcesRef.current = nativeCoverSources;
  const [nativeMetadataSources, setNativeMetadataSources] = useState<
    Record<string, BulkPublicationSourceDescriptor | null>
  >({});
  const nativeMetadataSourcesRef = useRef(nativeMetadataSources);
  nativeMetadataSourcesRef.current = nativeMetadataSources;
  const [metadataArtifacts, setMetadataArtifacts] = useState<
    Record<string, BulkImportMetadataArtifact>
  >({});
  const metadataArtifactsRef = useRef(metadataArtifacts);
  metadataArtifactsRef.current = metadataArtifacts;
  const [publicationMessages, setPublicationMessages] = useState<Record<string, string>>({});
  const [publishingResources, setPublishingResources] = useState<Set<string>>(new Set());

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
      publicationAdapter.dispose();
    },
    [abortPreviousAnalysis, publicationAdapter, revokeAllCoverPreviewUrls],
  );

  useEffect(() => {
    let cancelled = false;

    if (!isBridgeAvailable()) {
      setCapability(publicationAdapter.capability());
      return;
    }

    void publicationAdapter
      .detectCapability()
      .then((nextCapability) => {
        if (!cancelled) setCapability(nextCapability);
      })
      .catch(() => {
        if (!cancelled) setCapability(publicationAdapter.capability());
      });

    return () => {
      cancelled = true;
    };
  }, [publicationAdapter]);

  const setResourceMessage = useCallback(
    (rowId: string, resourceKind: 'audio' | 'cover' | 'metadata', message: string | null) => {
      const key = `${rowId}:${resourceKind}`;
      setPublicationMessages((current) => {
        const next = { ...current };
        if (message) {
          next[key] = message;
        } else {
          delete next[key];
        }
        return next;
      });
    },
    [],
  );

  const buildIntent = useCallback(
    (rows: readonly BulkImportRow[]): BulkPublicationIntent => {
      const roleIntent = mapBulkImportRoleToPublicationIntent(role);
      const current = batchRef.current;

      return {
        batchId: current.id,
        role,
        scope,
        actor: {
          name: actorName?.trim() || null,
          address: actorAddress?.trim() || null,
        },
        rows: rows.map((row) => ({
          rowId: row.id,
          sourceGeneration: row.sourceGeneration,
          roleIntent,
          source: row.localSource,
          metadata: row.metadata,
          durationMs: row.durationMs,
          cover: row.cover
            ? {
                origin: row.cover.origin,
                fileName: row.cover.fileName,
                mimeType: row.cover.mimeType,
                sizeBytes: row.cover.sizeBytes,
              }
            : null,
          publication: row.publication,
        })),
      };
    },
    [actorAddress, actorName, role, scope],
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

      setNativeSources((previous) => {
        const next = { ...previous };
        delete next[rowId];
        return next;
      });
      setNativeCoverSources((previous) => {
        const next = { ...previous };
        delete next[rowId];
        return next;
      });
      setNativeMetadataSources((previous) => {
        const next = { ...previous };
        delete next[rowId];
        return next;
      });
      setMetadataArtifacts((previous) => {
        const next = { ...previous };
        delete next[rowId];
        return next;
      });
      setPublicationMessages((previous) => {
        const next = { ...previous };
        for (const kind of ['audio', 'cover', 'metadata'] as const) {
          delete next[`${rowId}:${kind}`];
        }
        return next;
      });

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

  const publishingKey = useCallback((rowId: string, kind: 'audio' | 'cover' | 'metadata') => {
    return `${rowId}:${kind}`;
  }, []);

  const clearRowNativeSource = useCallback(
    (rowId: string, kind: 'audio' | 'cover' | 'metadata') => {
      if (kind === 'audio') {
        setNativeSources((previous) => {
          const next = { ...previous };
          delete next[rowId];
          return next;
        });
      } else if (kind === 'cover') {
        setNativeCoverSources((previous) => {
          const next = { ...previous };
          delete next[rowId];
          return next;
        });
      } else {
        setNativeMetadataSources((previous) => {
          const next = { ...previous };
          delete next[rowId];
          return next;
        });
      }
    },
    [],
  );

  const setPublishing = useCallback(
    (rowId: string, kind: 'audio' | 'cover' | 'metadata') => {
      const key = publishingKey(rowId, kind);
      setPublishingResources((previous) => new Set(previous).add(key));
    },
    [publishingKey],
  );

  const clearPublishing = useCallback(
    (rowId: string, kind: 'audio' | 'cover' | 'metadata') => {
      const key = publishingKey(rowId, kind);
      setPublishingResources((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    },
    [publishingKey],
  );

  const handleClearBatch = useCallback(() => {
    workspaceEpochRef.current += 1;
    abortPreviousAnalysis();
    revokeAllCoverPreviewUrls();
    clearTransientRegistry(transientRegistryRef.current);
    publicationAdapter.dispose();
    setNativeSources({});
    setNativeCoverSources({});
    setNativeMetadataSources({});
    setMetadataArtifacts({});
    setPublicationMessages({});
    setPublishingResources(new Set());
    commitBatch(createBulkImportBatch(role, scope));
  }, [
    abortPreviousAnalysis,
    commitBatch,
    publicationAdapter,
    revokeAllCoverPreviewUrls,
    role,
    scope,
  ]);

  const handleAcquireSelectedSources = useCallback(async () => {
    const current = batchRef.current;
    const selectedRows = current.rows.filter((row) => row.selected);

    for (const row of selectedRows) {
      if (isHome2AudioPublished(row) || isHome2AudioUnknown(row)) continue;

      setResourceMessage(row.id, 'audio', null);

      try {
        const result = await publicationAdapter.acquireRowSource(buildIntent([row]), row.id);

        if (result.canceled) {
          setResourceMessage(row.id, 'audio', 'Native selection cancelled.');
          continue;
        }

        const source = result.sources[0];
        if (source) {
          commitBatch(applyBulkPublicationSourceAcquisitionToBatch(batchRef.current, source));
          setNativeSources((previous) => ({ ...previous, [row.id]: source }));
          setResourceMessage(row.id, 'audio', null);
          continue;
        }

        const failure = result.failedRows[0];
        if (failure) {
          setResourceMessage(
            row.id,
            'audio',
            `Native source acquisition failed: ${failure.error.message}`,
          );
        }
      } catch (error) {
        setResourceMessage(
          row.id,
          'audio',
          error instanceof Error ? error.message : 'Native source acquisition failed.',
        );
      }
    }
  }, [buildIntent, commitBatch, publicationAdapter, setResourceMessage]);

  const handlePublishSelectedAudio = useCallback(async () => {
    const current = batchRef.current;
    const selectedRows = current.rows.filter((row) => row.selected);

    for (const row of selectedRows) {
      if (isHome2AudioPublished(row)) {
        setResourceMessage(row.id, 'audio', 'Audio is already published.');
        continue;
      }

      if (isHome2AudioUnknown(row)) {
        setResourceMessage(row.id, 'audio', 'Audio requires reconciliation before retry.');
        continue;
      }

      const source = nativeSourcesRef.current[row.id];
      if (!source || source.sourceGeneration !== row.sourceGeneration) {
        setResourceMessage(row.id, 'audio', 'Select the same audio file in Home first.');
        continue;
      }

      setPublishing(row.id, 'audio');
      setResourceMessage(row.id, 'audio', null);

      try {
        const result = await publicationAdapter.publishRow(buildIntent([row]), source);
        commitBatch(applyBulkPublicationRowResultToBatch(batchRef.current, result));

        if (result.status === 'partial') {
          clearRowNativeSource(row.id, 'audio');
          setResourceMessage(row.id, 'audio', 'Audio published. Continue with cover and metadata.');
        } else if (result.status === 'unknown') {
          clearRowNativeSource(row.id, 'audio');
          setResourceMessage(row.id, 'audio', 'Audio outcome is unknown. Reconciliation required.');
        } else if (result.status === 'failed') {
          setResourceMessage(
            row.id,
            'audio',
            home2RowPublicationFailureMessage(
              batchRef.current.rows.find((candidate) => candidate.id === row.id)!,
            ) ?? 'Audio publication failed.',
          );
        }
      } catch (error) {
        if (error instanceof Home2ReconciliationRequiredError) {
          setResourceMessage(
            row.id,
            'audio',
            `Reconciliation required for attempt ${error.attemptId}.`,
          );
        } else {
          setResourceMessage(
            row.id,
            'audio',
            error instanceof Error ? error.message : 'Audio publication failed.',
          );
        }
      } finally {
        clearPublishing(row.id, 'audio');
      }
    }
  }, [
    buildIntent,
    clearPublishing,
    clearRowNativeSource,
    commitBatch,
    publicationAdapter,
    setPublishing,
    setResourceMessage,
  ]);

  const handleAcquireAudioRow = useCallback(
    async (row: BulkImportRow) => {
      if (isHome2AudioPublished(row) || isHome2AudioUnknown(row)) return;

      setResourceMessage(row.id, 'audio', null);

      try {
        const result = await publicationAdapter.acquireRowSource(buildIntent([row]), row.id);
        if (result.canceled) {
          setResourceMessage(row.id, 'audio', 'Audio selection cancelled.');
          return;
        }

        const source = result.sources[0];
        if (source) {
          commitBatch(applyBulkPublicationSourceAcquisitionToBatch(batchRef.current, source));
          setNativeSources((previous) => ({ ...previous, [row.id]: source }));
          setResourceMessage(row.id, 'audio', null);
          return;
        }

        const failure = result.failedRows[0];
        if (failure) {
          setResourceMessage(row.id, 'audio', failure.error.message);
        }
      } catch (error) {
        setResourceMessage(
          row.id,
          'audio',
          error instanceof Error ? error.message : 'Audio source acquisition failed.',
        );
      }
    },
    [buildIntent, commitBatch, publicationAdapter, setResourceMessage],
  );

  const handlePublishAudioRow = useCallback(
    async (row: BulkImportRow) => {
      if (isHome2AudioPublished(row)) {
        setResourceMessage(row.id, 'audio', 'Audio is already published.');
        return;
      }
      if (isHome2AudioUnknown(row)) {
        setResourceMessage(row.id, 'audio', 'Audio requires reconciliation before retry.');
        return;
      }

      const source = nativeSourcesRef.current[row.id];
      if (!source || source.sourceGeneration !== row.sourceGeneration) {
        setResourceMessage(row.id, 'audio', 'Select the same audio file in Home first.');
        return;
      }

      setPublishing(row.id, 'audio');
      setResourceMessage(row.id, 'audio', null);

      try {
        const result = await publicationAdapter.publishRow(buildIntent([row]), source);
        commitBatch(applyBulkPublicationRowResultToBatch(batchRef.current, result));

        if (result.status === 'partial') {
          clearRowNativeSource(row.id, 'audio');
          setResourceMessage(row.id, 'audio', 'Audio published.');
        } else if (result.status === 'unknown') {
          clearRowNativeSource(row.id, 'audio');
          setResourceMessage(row.id, 'audio', 'Audio outcome is unknown. Reconciliation required.');
        } else if (result.status === 'failed') {
          setResourceMessage(
            row.id,
            'audio',
            home2RowPublicationFailureMessage(
              batchRef.current.rows.find((candidate) => candidate.id === row.id)!,
            ) ?? 'Audio publication failed.',
          );
        }
      } catch (error) {
        if (error instanceof Home2ReconciliationRequiredError) {
          setResourceMessage(
            row.id,
            'audio',
            `Reconciliation required for attempt ${error.attemptId}.`,
          );
        } else {
          setResourceMessage(
            row.id,
            'audio',
            error instanceof Error ? error.message : 'Audio publication failed.',
          );
        }
      } finally {
        clearPublishing(row.id, 'audio');
      }
    },
    [
      buildIntent,
      clearPublishing,
      clearRowNativeSource,
      commitBatch,
      publicationAdapter,
      setPublishing,
      setResourceMessage,
    ],
  );

  const handleAcquireCover = useCallback(
    async (row: BulkImportRow) => {
      if (isHome2ResourcePublished(row, 'cover') || isHome2ResourceUnknown(row, 'cover')) return;

      setResourceMessage(row.id, 'cover', null);

      try {
        const result = await publicationAdapter.acquireCoverSource(buildIntent([row]), row.id);

        if (result.canceled) {
          setResourceMessage(row.id, 'cover', 'Cover selection cancelled.');
          return;
        }

        const source = result.sources[0];
        if (source) {
          setNativeCoverSources((previous) => ({ ...previous, [row.id]: source }));
          setResourceMessage(row.id, 'cover', null);
          return;
        }

        const failure = result.failedRows[0];
        if (failure) {
          setResourceMessage(row.id, 'cover', failure.error.message);
        }
      } catch (error) {
        setResourceMessage(
          row.id,
          'cover',
          error instanceof Error ? error.message : 'Cover source acquisition failed.',
        );
      }
    },
    [buildIntent, publicationAdapter, setResourceMessage],
  );

  const handleExportCover = useCallback(
    (row: BulkImportRow) => {
      const key = transientSourceKey(batchRef.current.id, row.id, row.sourceGeneration);
      const entry = getTransientEntry(transientRegistryRef.current, key);
      const coverBlob = entry?.coverBlob;

      if (!coverBlob) {
        setResourceMessage(
          row.id,
          'cover',
          'The cover source is gone. Re-select or remove the cover.',
        );
        return;
      }

      const extension =
        coverBlob.type === 'image/png'
          ? '.png'
          : coverBlob.type === 'image/webp'
            ? '.webp'
            : '.jpg';
      const fileName =
        row.cover?.fileName && row.cover.fileName.trim()
          ? row.cover.fileName
          : `nodefm-track-${row.id}-cover${extension}`;
      const url = URL.createObjectURL(coverBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setResourceMessage(row.id, 'cover', 'Cover file saved. Select that file in Home.');
    },
    [setResourceMessage],
  );

  const handlePublishCover = useCallback(
    async (row: BulkImportRow) => {
      if (isHome2ResourcePublished(row, 'cover')) {
        setResourceMessage(row.id, 'cover', 'Cover is already published.');
        return;
      }

      if (isHome2ResourceUnknown(row, 'cover')) {
        setResourceMessage(row.id, 'cover', 'Cover requires reconciliation before retry.');
        return;
      }

      const source = nativeCoverSourcesRef.current[row.id];
      if (!source || source.sourceGeneration !== row.sourceGeneration) {
        setResourceMessage(row.id, 'cover', 'Select the same cover image in Home first.');
        return;
      }

      setPublishing(row.id, 'cover');
      setResourceMessage(row.id, 'cover', null);

      try {
        const result = await publicationAdapter.publishCover(buildIntent([row]), source);
        commitBatch(applyBulkPublicationRowResultToBatch(batchRef.current, result));

        if (result.status === 'partial') {
          clearRowNativeSource(row.id, 'cover');
          setResourceMessage(row.id, 'cover', 'Cover published.');
        } else if (result.status === 'unknown') {
          clearRowNativeSource(row.id, 'cover');
          setResourceMessage(row.id, 'cover', 'Cover outcome is unknown. Reconciliation required.');
        } else if (result.status === 'failed') {
          clearRowNativeSource(row.id, 'cover');
          setResourceMessage(
            row.id,
            'cover',
            home2ResourcePublicationFailureMessage(
              batchRef.current.rows.find((candidate) => candidate.id === row.id)!,
              'cover',
            ) ?? 'Cover publication failed.',
          );
        }
      } catch (error) {
        if (error instanceof Home2ReconciliationRequiredError) {
          setResourceMessage(
            row.id,
            'cover',
            `Reconciliation required for attempt ${error.attemptId}.`,
          );
        } else {
          setResourceMessage(
            row.id,
            'cover',
            error instanceof Error ? error.message : 'Cover publication failed.',
          );
        }
      } finally {
        clearPublishing(row.id, 'cover');
      }
    },
    [
      buildIntent,
      clearPublishing,
      clearRowNativeSource,
      commitBatch,
      publicationAdapter,
      setPublishing,
      setResourceMessage,
    ],
  );

  const metadataDescriptor = useCallback((artifact: BulkImportMetadataArtifact) => {
    return {
      fileName: artifact.fileName,
      mimeType: 'application/json',
      sizeBytes: artifact.sizeBytes,
    };
  }, []);

  const handleExportMetadata = useCallback(
    async (row: BulkImportRow) => {
      if (!isHome2MetadataReadyToExport(row)) {
        setResourceMessage(
          row.id,
          'metadata',
          'Publish audio (and cover when present) before exporting metadata.',
        );
        return;
      }

      try {
        const artifact = createBulkImportMetadataArtifact(
          batchRef.current,
          row,
          actorName,
          actorAddress,
        );
        setMetadataArtifacts((previous) => ({ ...previous, [row.id]: artifact }));
        setResourceMessage(row.id, 'metadata', null);
        downloadBulkImportMetadataArtifact(artifact);
      } catch (error) {
        setResourceMessage(
          row.id,
          'metadata',
          error instanceof Error ? error.message : 'Metadata export failed.',
        );
      }
    },
    [actorAddress, actorName, setResourceMessage],
  );

  const handleAcquireMetadata = useCallback(
    async (row: BulkImportRow) => {
      const artifact = metadataArtifactsRef.current[row.id];

      if (
        !artifact ||
        !isBulkImportMetadataArtifactCurrent(
          batchRef.current,
          row,
          actorName,
          actorAddress,
          artifact,
        )
      ) {
        setMetadataArtifacts((previous) => {
          const next = { ...previous };
          delete next[row.id];
          return next;
        });
        setResourceMessage(
          row.id,
          'metadata',
          'The exported metadata is stale. Export the current metadata again.',
        );
        return;
      }

      setResourceMessage(row.id, 'metadata', null);

      try {
        const result = await publicationAdapter.acquireMetadataSource(
          buildIntent([row]),
          row.id,
          metadataDescriptor(artifact),
        );

        if (result.canceled) {
          setResourceMessage(row.id, 'metadata', 'Metadata file selection cancelled.');
          return;
        }

        const source = result.sources[0];
        if (source) {
          setNativeMetadataSources((previous) => ({ ...previous, [row.id]: source }));
          setResourceMessage(row.id, 'metadata', null);
          return;
        }

        const failure = result.failedRows[0];
        if (failure) {
          setResourceMessage(row.id, 'metadata', failure.error.message);
        }
      } catch (error) {
        setResourceMessage(
          row.id,
          'metadata',
          error instanceof Error ? error.message : 'Metadata source acquisition failed.',
        );
      }
    },
    [
      actorAddress,
      actorName,
      buildIntent,
      metadataDescriptor,
      publicationAdapter,
      setResourceMessage,
    ],
  );

  const handlePublishMetadata = useCallback(
    async (row: BulkImportRow) => {
      if (isHome2ResourcePublished(row, 'metadata')) {
        setResourceMessage(row.id, 'metadata', 'Metadata is already published.');
        return;
      }

      if (isHome2ResourceUnknown(row, 'metadata')) {
        setResourceMessage(row.id, 'metadata', 'Metadata requires reconciliation before retry.');
        return;
      }

      const artifact = metadataArtifactsRef.current[row.id];
      if (
        !artifact ||
        !isBulkImportMetadataArtifactCurrent(
          batchRef.current,
          row,
          actorName,
          actorAddress,
          artifact,
        )
      ) {
        setMetadataArtifacts((previous) => {
          const next = { ...previous };
          delete next[row.id];
          return next;
        });
        setResourceMessage(
          row.id,
          'metadata',
          'The exported metadata is stale. Export the current metadata again.',
        );
        return;
      }

      const source = nativeMetadataSourcesRef.current[row.id];
      if (!source || source.sourceGeneration !== row.sourceGeneration) {
        setResourceMessage(row.id, 'metadata', 'Select the exported metadata JSON in Home first.');
        return;
      }

      setPublishing(row.id, 'metadata');
      setResourceMessage(row.id, 'metadata', null);

      try {
        const result = await publicationAdapter.publishMetadata(
          buildIntent([row]),
          source,
          metadataDescriptor(artifact),
        );
        commitBatch(applyBulkPublicationRowResultToBatch(batchRef.current, result));

        if (result.status === 'complete') {
          clearRowNativeSource(row.id, 'metadata');
          setMetadataArtifacts((previous) => {
            const next = { ...previous };
            delete next[row.id];
            return next;
          });
          setResourceMessage(row.id, 'metadata', 'Metadata published.');
        } else if (result.status === 'unknown') {
          clearRowNativeSource(row.id, 'metadata');
          setMetadataArtifacts((previous) => {
            const next = { ...previous };
            delete next[row.id];
            return next;
          });
          setResourceMessage(
            row.id,
            'metadata',
            'Metadata outcome is unknown. Reconciliation required.',
          );
        } else if (result.status === 'failed') {
          clearRowNativeSource(row.id, 'metadata');
          setResourceMessage(
            row.id,
            'metadata',
            home2ResourcePublicationFailureMessage(
              batchRef.current.rows.find((candidate) => candidate.id === row.id)!,
              'metadata',
            ) ?? 'Metadata publication failed.',
          );
        }
      } catch (error) {
        if (error instanceof Home2ReconciliationRequiredError) {
          setResourceMessage(
            row.id,
            'metadata',
            `Reconciliation required for attempt ${error.attemptId}.`,
          );
        } else {
          setResourceMessage(
            row.id,
            'metadata',
            error instanceof Error ? error.message : 'Metadata publication failed.',
          );
        }
      } finally {
        clearPublishing(row.id, 'metadata');
      }
    },
    [
      actorAddress,
      actorName,
      buildIntent,
      clearPublishing,
      clearRowNativeSource,
      commitBatch,
      metadataDescriptor,
      publicationAdapter,
      setPublishing,
      setResourceMessage,
    ],
  );

  const summary = useMemo(() => getBulkImportBatchSummary(batch), [batch]);
  const canPublish = summary.isPublicationReady && capability.status === 'available';
  const finalLabel = role === 'admin' ? 'Publish Selected Audio' : 'Submit Selected Audio';

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
              Stage up to 15 local audio files for metadata review. When Home 2 native publication
              is available, publish audio, optional cover image, and the exported metadata JSON one
              resource at a time.
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
        <button
          className="button button--secondary"
          type="button"
          disabled={!canPublish}
          onClick={() => void handleAcquireSelectedSources()}
        >
          Acquire Native Audio Sources
        </button>
      </div>

      <BulkImportSummary
        summary={summary}
        capabilityMessage={capability.message}
        capabilityStatus={capability.status}
      />

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

      {batch.rows.length > 0 ? (
        <section className="bulk-import__publication-state">
          <h3 className="bulk-import__publication-state-title">Publication checklist</h3>
          <ul className="bulk-import__publication-state-list">
            {batch.rows.map((row) => {
              const audioState = getHome2ResourcePublicationUiState(
                row,
                'audio',
                nativeSources[row.id] ?? null,
                publishingResources.has(publishingKey(row.id, 'audio')),
              );
              const coverState = getHome2ResourcePublicationUiState(
                row,
                'cover',
                nativeCoverSources[row.id] ?? null,
                publishingResources.has(publishingKey(row.id, 'cover')),
              );
              const metadataState = getHome2ResourcePublicationUiState(
                row,
                'metadata',
                nativeMetadataSources[row.id] ?? null,
                publishingResources.has(publishingKey(row.id, 'metadata')),
              );
              const audioMessage = publicationMessages[`${row.id}:audio`];
              const coverMessage = publicationMessages[`${row.id}:cover`];
              const metadataMessage = publicationMessages[`${row.id}:metadata`];
              const metadataArtifact = metadataArtifacts[row.id];
              const metadataCurrent =
                metadataArtifact &&
                isBulkImportMetadataArtifactCurrent(
                  batch,
                  row,
                  actorName,
                  actorAddress,
                  metadataArtifact,
                );
              const coverTransient = getTransientEntry(
                transientRegistryRef.current,
                transientSourceKey(batch.id, row.id, row.sourceGeneration),
              );
              const coverNeedsExport =
                row.cover !== null &&
                (row.cover.origin === 'embedded' || !row.cover.fileName) &&
                !!coverTransient?.coverBlob;

              return (
                <li key={row.id} className="bulk-import__publication-state-item">
                  <div className="bulk-import__publication-state-row">
                    <strong className="bulk-import__publication-state-name">
                      {row.metadata.title || row.localSource?.fileName || row.id}
                    </strong>
                    <span className="bulk-import__publication-state-message">
                      {row.localSource?.fileName ?? row.id}
                    </span>
                  </div>

                  <ul className="bulk-import__publication-checklist">
                    <ChecklistResourceItem
                      label="Audio"
                      state={audioState}
                      message={audioMessage}
                      capabilityReady={capability.status === 'available'}
                      actionLabel={
                        audioState === 'native-source-acquired'
                          ? 'Publish audio'
                          : 'Select audio file'
                      }
                      onAction={() =>
                        audioState === 'native-source-acquired'
                          ? void handlePublishAudioRow(row)
                          : void handleAcquireAudioRow(row)
                      }
                    />
                    <ChecklistResourceItem
                      label="Cover"
                      state={coverState}
                      message={coverMessage}
                      capabilityReady={capability.status === 'available'}
                      actionLabel={
                        row.cover === null
                          ? null
                          : coverState === 'native-source-acquired'
                            ? 'Publish cover'
                            : 'Select cover file'
                      }
                      onAction={() =>
                        row.cover === null
                          ? undefined
                          : coverState === 'native-source-acquired'
                            ? void handlePublishCover(row)
                            : void handleAcquireCover(row)
                      }
                      secondaryActionLabel={coverNeedsExport ? 'Save cover file' : null}
                      onSecondaryAction={
                        coverNeedsExport ? () => handleExportCover(row) : undefined
                      }
                    />
                    <ChecklistResourceItem
                      label="Metadata"
                      state={metadataState}
                      message={metadataMessage}
                      capabilityReady={capability.status === 'available'}
                      actionLabel={
                        metadataState === 'native-source-acquired'
                          ? 'Publish metadata'
                          : metadataCurrent
                            ? 'Select exported JSON'
                            : 'Export metadata JSON'
                      }
                      onAction={() =>
                        metadataState === 'native-source-acquired'
                          ? void handlePublishMetadata(row)
                          : metadataCurrent
                            ? void handleAcquireMetadata(row)
                            : void handleExportMetadata(row)
                      }
                    />
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <div className="bulk-import__blockers">
        {summary.publicationBlockers.map((blocker) => (
          <p key={blocker} className="bulk-import__blocker">
            {blocker}
          </p>
        ))}
      </div>

      <footer className="bulk-import__footer">
        <button
          className="button button--primary"
          type="button"
          disabled={!canPublish}
          onClick={() => void handlePublishSelectedAudio()}
        >
          {finalLabel}
        </button>
        {!canPublish ? (
          <p className="bulk-import__footer-note">
            Audio publication is disabled until validation passes and Home 2 native publication is
            available. Cover and metadata steps appear in the checklist after audio is confirmed.
          </p>
        ) : null}
      </footer>
    </div>
  );
}

type ChecklistResourceItemProps = {
  label: string;
  state: Home2ResourcePublicationUiState;
  message: string | undefined;
  capabilityReady: boolean;
  actionLabel: string | null;
  onAction: (() => void) | undefined;
  secondaryActionLabel?: string | null;
  onSecondaryAction?: (() => void) | undefined;
};

export function ChecklistResourceItem({
  label,
  state,
  message,
  capabilityReady,
  actionLabel,
  onAction,
  secondaryActionLabel = null,
  onSecondaryAction,
}: ChecklistResourceItemProps) {
  const notice =
    state === 'published'
      ? {
          tone: 'success' as const,
          title: `${label} published.`,
          detail: message ?? 'QDN resource confirmed.',
        }
      : state === 'unknown'
        ? {
            tone: 'warning' as const,
            title: `${label} reconciliation required.`,
            detail: message ?? 'Publication could not be confirmed.',
          }
        : state === 'failed'
          ? {
              tone: 'error' as const,
              title: `${label} publication failed.`,
              detail: message ?? 'Check the message and try again.',
            }
          : state === 'not-required'
            ? {
                tone: 'info' as const,
                title: `${label} publication not required.`,
                detail: 'No resource needs to be published for this step.',
              }
            : state === 'native-source-acquired'
              ? {
                  tone: 'info' as const,
                  title: `${label} source ready.`,
                  detail: message ?? 'The selected file matches this Track.',
                }
              : state === 'publishing'
                ? {
                    tone: 'info' as const,
                    title: `Publishing ${label.toLowerCase()}…`,
                    detail: null,
                  }
                : state === 'native-source-required'
                  ? {
                      tone: 'warning' as const,
                      title: `${label} source required.`,
                      detail: message ?? 'Select the file in Home before publishing.',
                    }
                  : {
                      tone: 'info' as const,
                      title: `${label} waiting for earlier steps.`,
                      detail: null,
                    };

  return (
    <li className="bulk-import__publication-checklist-item">
      <span className="bulk-import__publication-checklist-label">{label}</span>
      <div className="bulk-import__publication-checklist-actions">
        {secondaryActionLabel && onSecondaryAction ? (
          <button
            className="button button--secondary"
            type="button"
            disabled={!capabilityReady || state === 'published' || state === 'publishing'}
            onClick={onSecondaryAction}
          >
            {secondaryActionLabel}
          </button>
        ) : null}
        {actionLabel && onAction ? (
          <button
            className="button button--secondary"
            type="button"
            disabled={!capabilityReady || state === 'published' || state === 'publishing'}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      <SystemStatusNotice tone={notice.tone} title={notice.title} detail={notice.detail} />
    </li>
  );
}
