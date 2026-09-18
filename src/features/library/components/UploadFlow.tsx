/* ============================================================
 * NodeFM Station — Upload Flow
 *
 * Step-by-step wizard for uploading local audio.
 * Uses the proven Qortium large-file flow:
 * 1. SELECT_QDN_PUBLISH_SOURCE (native picker — once)
 * 2. Collect/edit metadata
 * 3. Optionally select cover (browser File → base64)
 * 4. Publish AUDIO + optional cover in one multi-resource approval
 * 5. Resolve audio duration post-publish
 * 6. Create & publish Track metadata in a second approval
 * ============================================================ */

import { useState, useCallback, useRef } from 'react';
import { Modal } from '../../../components/Modal';
import { PublicationProgress } from '../../../components/PublicationProgress';
import {
  selectPublishSource,
  getQdnResourceUrl,
  ensureQdnResourceReady,
  type SelectPublishSourceResult,
} from '../../../qortium/qdn';
import { useStationIdentity } from '../../station';
import { TaxonomyInput, useTaxonomy, getCanonicalTaxonomyValues } from '../../taxonomy';
import {
  AlbumInput,
  ArtistInput,
  ReleaseDateInput,
  TitleInput,
  isValidReleaseDateValue,
} from '../../metadata-intelligence';
import { readCoverFile } from '../services/coverService';
import { publishUploadMediaResources, publishUploadTrackMetadata } from '../services/uploadService';
import { resolveAudioDurationFromUrl } from '../../../utils/duration';
import { createTrack, getAudioQdnIdentifier } from '../../tracks/services/trackService';

type Step = 'select' | 'metadata' | 'publishing' | 'resolving' | 'done' | 'error';

type UploadResourceId = 'audio' | 'cover' | 'track';
type UploadResourceStatus = 'waiting' | 'active' | 'succeeded' | 'failed';

type UploadPublicationRow = {
  id: UploadResourceId;
  label: string;
  status: UploadResourceStatus;
  error?: string;
};

type UploadPublicationState = {
  phase: 'publishing' | 'success' | 'failed';
  rows: UploadPublicationRow[];
  error?: string;
};

type UploadState = {
  step: Step;
  /** Source from SELECT_QDN_PUBLISH_SOURCE — the sole audio selection */
  audioSource: SelectPublishSourceResult | null;
  durationMs: number | null;
  title: string;
  artist: string;
  album: string;
  releaseDate: string;
  description: string;
  genres: string;
  tags: string;
  coverFile: File | null;
  coverBase64: string | null;
  error: string | null;
};

export function UploadFlow({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const { ownerAddress, publisherName } = useStationIdentity();
  const { remember, genres: genreSuggestions, tags: tagSuggestions } = useTaxonomy();
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [publication, setPublication] = useState<UploadPublicationState | null>(null);

  const [state, setState] = useState<UploadState>({
    step: 'select',
    audioSource: null,
    durationMs: null,
    title: '',
    artist: '',
    album: '',
    releaseDate: '',
    description: '',
    genres: '',
    tags: '',
    coverFile: null,
    coverBase64: null,
    error: null,
  });

  // ── Step 1: Native file picker (SELECT_QDN_PUBLISH_SOURCE) ──────

  const handleSelectAudio = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));

    try {
      const source = await selectPublishSource('file');

      if (source.canceled) {
        return; // user cancelled — stay on select step
      }

      setState((s) => ({
        ...s,
        audioSource: source,
        step: 'metadata',
        title: s.title || source.fileName.replace(/\.[^/.]+$/, ''),
        error: null,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Failed to open file picker.',
      }));
    }
  }, []);

  // ── Cover: browser File → base64 (small images only) ────────────

  const handleCoverSelected = useCallback(async (file: File) => {
    try {
      const cover = await readCoverFile(file);
      setState((s) => ({
        ...s,
        coverFile: file,
        coverBase64: cover.dataUrl,
        error: null,
      }));
    } catch (error) {
      setState((s) => ({
        ...s,
        error: error instanceof Error ? error.message : 'Failed to read cover image.',
      }));
    }
  }, []);

  // ── Publish ────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    if (!state.audioSource || state.audioSource.canceled || !ownerAddress || !publisherName) return;

    if (state.releaseDate.trim() && !isValidReleaseDateValue(state.releaseDate)) {
      setState((s) => ({
        ...s,
        error: 'Release date must use YYYY, YYYY-MM, or YYYY-MM-DD.',
      }));
      return;
    }

    // Block if no registered Qortium name
    if (!publisherName) {
      setState((s) => ({
        ...s,
        error: 'A registered Qortium name is required to publish NodeFM resources.',
      }));
      return;
    }

    setState((s) => ({ ...s, step: 'publishing', error: null }));
    const hasCover = Boolean(state.coverFile && state.coverBase64);
    const trackTitle = state.title || state.audioSource.fileName.replace(/\.[^/.]+$/, '');
    const rows: UploadPublicationRow[] = [
      { id: 'audio', label: 'Audio file', status: 'active' },
      ...(hasCover
        ? [{ id: 'cover' as const, label: 'Cover image', status: 'active' as const }]
        : []),
      { id: 'track', label: 'Track metadata', status: 'waiting' },
    ];
    setPublication({ phase: 'publishing', rows });

    try {
      const audioIdentifier = getAudioQdnIdentifier();

      // 1. One approval for AUDIO + optional cover IMAGE.
      const mediaResult = await publishUploadMediaResources({
        publisherName,
        audioIdentifier,
        audioSourceToken: state.audioSource.sourceToken,
        title: trackTitle,
        cover:
          state.coverFile && state.coverBase64
            ? {
                publisherName,
                title: trackTitle,
                file: state.coverFile,
                bytesBase64: state.coverBase64.split(',')[1] ?? '',
              }
            : undefined,
      });

      const audioFailure = mediaResult.response.failures.find(
        (entry) => entry.resource.identifier === audioIdentifier,
      );
      const coverFailure = mediaResult.coverRef
        ? mediaResult.response.failures.find(
            (entry) => entry.resource.identifier === mediaResult.coverRef?.identifier,
          )
        : undefined;

      if (!mediaResult.audioPublished || (hasCover && !mediaResult.coverPublished)) {
        const message =
          audioFailure?.error ??
          coverFailure?.error ??
          'QDN batch publication returned an incomplete result.';

        setPublication((current) =>
          current
            ? {
                phase: 'failed',
                rows: current.rows.map((row) => {
                  if (row.id === 'audio' && !mediaResult.audioPublished) {
                    return { ...row, status: 'failed' as const, error: audioFailure?.error };
                  }
                  if (row.id === 'cover' && hasCover && !mediaResult.coverPublished) {
                    return { ...row, status: 'failed' as const, error: coverFailure?.error };
                  }
                  if (row.id === 'audio') return { ...row, status: 'succeeded' as const };
                  if (row.id === 'cover' && hasCover) {
                    return { ...row, status: 'succeeded' as const };
                  }
                  return row;
                }),
                error: message,
              }
            : current,
        );
        setState((s) => ({ ...s, step: 'error', error: message }));
        return;
      }

      setPublication((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) => {
                if (row.id === 'audio' || row.id === 'cover') {
                  return { ...row, status: 'succeeded' as const, error: undefined };
                }
                if (row.id === 'track') {
                  return { ...row, status: 'active' as const, error: undefined };
                }
                return row;
              }),
            }
          : current,
      );

      // 2. Resolve duration from the now-published AUDIO resource.
      let durationMs: number | null = null;

      try {
        const audioRef = {
          service: 'AUDIO',
          name: publisherName,
          identifier: audioIdentifier,
        };
        await ensureQdnResourceReady(audioRef);
        const url = await getQdnResourceUrl(audioRef);
        durationMs = await resolveAudioDurationFromUrl(url);
      } catch (durationError) {
        durationMs = null;
        const message =
          durationError instanceof Error
            ? `Audio duration could not be resolved: ${durationError.message}`
            : 'Audio duration could not be resolved.';
        setPublication((current) =>
          current
            ? {
                phase: 'failed',
                rows: current.rows.map((row) =>
                  row.id === 'track' ? { ...row, status: 'failed' as const, error: message } : row,
                ),
                error: message,
              }
            : current,
        );
        setState((s) => ({ ...s, step: 'error', error: message }));
        return;
      }

      if (!durationMs || durationMs <= 0) {
        const message = 'Audio duration could not be resolved. Track metadata was not created.';
        setPublication((current) =>
          current
            ? {
                phase: 'failed',
                rows: current.rows.map((row) =>
                  row.id === 'track' ? { ...row, status: 'failed' as const, error: message } : row,
                ),
                error: message,
              }
            : current,
        );
        setState((s) => ({ ...s, step: 'error', error: message }));
        return;
      }

      // 3. Create and publish the Track metadata JSON in a second approval.
      const genres = state.genres.trim()
        ? getCanonicalTaxonomyValues(state.genres, genreSuggestions)
        : undefined;
      const tags = state.tags.trim()
        ? getCanonicalTaxonomyValues(state.tags, tagSuggestions)
        : undefined;

      const track = createTrack({
        title: trackTitle,
        artist: state.artist || undefined,
        album: state.album || undefined,
        releaseDate: state.releaseDate || undefined,
        description: state.description || undefined,
        audio: {
          service: 'AUDIO',
          name: publisherName,
          identifier: audioIdentifier,
        },
        cover: mediaResult.coverRef,
        durationMs,
        genres,
        tags,
        source: 'station-upload',
        ownerAddress,
      });

      await publishUploadTrackMetadata(track, publisherName);

      remember('genres', genres ?? []);
      remember('tags', tags ?? []);

      setPublication((current) =>
        current
          ? {
              phase: 'success',
              rows: current.rows.map((row) => ({
                ...row,
                status: 'succeeded' as const,
                error: undefined,
              })),
              error: undefined,
            }
          : current,
      );
      setState((s) => ({ ...s, step: 'done' }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed.';

      setPublication((current) =>
        current
          ? {
              phase: 'failed',
              rows: current.rows.map((row) =>
                row.status === 'active'
                  ? { ...row, status: 'failed' as const, error: message }
                  : row,
              ),
              error: message,
            }
          : current,
      );
      setState((s) => ({ ...s, step: 'error', error: message }));
    }
  }, [
    state.audioSource,
    state.title,
    state.artist,
    state.album,
    state.releaseDate,
    state.description,
    state.genres,
    state.tags,
    state.coverFile,
    state.coverBase64,
    ownerAddress,
    publisherName,
    genreSuggestions,
    tagSuggestions,
    remember,
  ]);

  const publicationTitle =
    publication?.phase === 'success' ? 'Track Published' : 'Publishing Track';

  if (publication) {
    return (
      <PublicationProgress
        title={publicationTitle}
        state={publication}
        successMessage="Track published successfully."
        onClose={onClose}
        onSuccess={onComplete}
      />
    );
  }

  return (
    <Modal title="Upload Audio" onClose={onClose}>
      <>
        {state.step === 'select' && (
          <div className="upload-flow__select">
            <p>Select an audio file to upload to the station library.</p>
            <p className="upload-flow__hint">Supported formats: MP3, WAV, FLAC, OGG, AAC, M4A</p>
            {!publisherName && (
              <p className="upload-flow__warning">
                ⚠️ A registered Qortium name is required to publish resources.
              </p>
            )}
            {state.error && <p className="form-error">{state.error}</p>}
            <button
              className="button button--primary"
              type="button"
              onClick={handleSelectAudio}
              disabled={!publisherName}
            >
              Select Audio File
            </button>
          </div>
        )}

        {state.step === 'metadata' && (
          <div className="upload-flow__metadata">
            <div className="upload-flow__file-info">
              <strong>File:</strong>{' '}
              {state.audioSource && !state.audioSource.canceled
                ? `${state.audioSource.fileName} (${(state.audioSource.size / 1024 / 1024).toFixed(1)} MB)`
                : 'Not selected'}
              <br />
              <strong>Duration:</strong> Resolved after publish
            </div>

            <label className="form-field">
              Title
              <TitleInput
                value={state.title}
                onChange={(value) => setState((s) => ({ ...s, title: value }))}
                artistValue={state.artist}
                placeholder="Track title"
              />
            </label>

            <label className="form-field">
              Artist
              <ArtistInput
                value={state.artist}
                onChange={(value) => setState((s) => ({ ...s, artist: value }))}
                placeholder="Artist name"
              />
            </label>

            <label className="form-field">
              Album
              <AlbumInput
                value={state.album}
                onChange={(value) => setState((s) => ({ ...s, album: value }))}
                artistValue={state.artist}
                placeholder="Optional album name"
              />
            </label>

            <label className="form-field">
              Release date
              <ReleaseDateInput
                value={state.releaseDate}
                onChange={(value) => setState((s) => ({ ...s, releaseDate: value }))}
                placeholder="1991-08-12"
              />
            </label>

            <label className="form-field">
              Description
              <textarea
                value={state.description}
                onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
                placeholder="Track description"
                rows={2}
              />
            </label>

            <label className="form-field">
              Genres
              <TaxonomyInput
                kind="genres"
                value={state.genres}
                onChange={(value) => setState((s) => ({ ...s, genres: value }))}
                placeholder="Rock, Electronic, Jazz"
              />
            </label>

            <label className="form-field">
              Tags
              <TaxonomyInput
                kind="tags"
                value={state.tags}
                onChange={(value) => setState((s) => ({ ...s, tags: value }))}
                placeholder="chill, upbeat, instrumental"
              />
            </label>

            <div className="form-field">
              <label>Cover Image (optional, max 2 MB)</label>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCoverSelected(file);
                }}
              />
              {state.coverBase64 && (
                <img
                  src={state.coverBase64}
                  alt="Cover preview"
                  className="upload-flow__cover-preview"
                />
              )}
            </div>

            {state.error && <p className="form-error">{state.error}</p>}

            <div className="form-actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    step: 'select',
                    audioSource: null,
                    durationMs: null,
                    error: null,
                  }))
                }
              >
                Back
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={handlePublish}
                disabled={!state.title || !publisherName}
              >
                Publish Track
              </button>
            </div>
          </div>
        )}
      </>
    </Modal>
  );
}
