/* ============================================================
 * NodeFM Station — Upload Flow
 *
 * Step-by-step wizard for uploading local audio.
 * Uses the proven Qortium large-file flow:
 * 1. SELECT_QDN_PUBLISH_SOURCE (native picker — once)
 * 2. Collect/edit metadata
 * 3. Optionally select cover (browser File → base64)
 * 4. Publish AUDIO via QDN (sourceToken)
 * 5. Resolve audio duration post-publish
 * 6. Publish cover (optional)
 * 7. Create & publish Track metadata
 * ============================================================ */

import { useState, useCallback, useRef } from 'react';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import { Modal } from '../../../components/Modal';
import {
  publishResource,
  selectPublishSource,
  getQdnResourceUrl,
  ensureQdnResourceReady,
  type SelectPublishSourceResult,
} from '../../../qortium/qdn';
import { useLibrary } from '../../../hooks/useLibrary';
import { useStationIdentity } from '../../station';
import { TaxonomyInput, useTaxonomy, getCanonicalTaxonomyValues } from '../../taxonomy';
import {
  AlbumInput,
  ArtistInput,
  ReleaseDateInput,
  TitleInput,
  isValidReleaseDateValue,
} from '../../metadata-intelligence';
import { publishTrackCoverImage, readCoverFile } from '../services/coverService';
import { resolveAudioDurationFromUrl } from '../../../utils/duration';
import { getAudioQdnIdentifier } from '../../tracks/services/trackService';

type Step = 'select' | 'metadata' | 'publishing' | 'resolving' | 'done' | 'error';

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
  partialResult: string | null;
};

export function UploadFlow({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const { createTrack } = useLibrary();
  const { ownerAddress, publisherName } = useStationIdentity();
  const { remember, genres: genreSuggestions, tags: tagSuggestions } = useTaxonomy();
  const coverInputRef = useRef<HTMLInputElement>(null);

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
    partialResult: null,
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
        step: 'error',
        error: 'A registered Qortium name is required to publish NodeFM resources.',
      }));
      return;
    }

    setState((s) => ({ ...s, step: 'publishing', error: null, partialResult: null }));

    let audioIdentifier: string | null = null;
    const partialMessages: string[] = [];

    try {
      // 1. Publish audio via sourceToken
      audioIdentifier = getAudioQdnIdentifier();

      const audioResult = await publishResource({
        service: 'AUDIO',
        name: publisherName,
        identifier: audioIdentifier,
        sourceToken: state.audioSource.sourceToken,
        title: state.title,
        filename: state.audioSource.fileName,
      });

      if (!audioResult.accepted) {
        throw new Error('Audio publication was not accepted.');
      }

      // 2. Publish cover (optional, non-fatal)
      let coverRef: { service: string; name: string; identifier?: string } | undefined;

      if (state.coverFile && state.coverBase64) {
        try {
          coverRef = await publishTrackCoverImage({
            publisherName,
            title: state.title,
            file: state.coverFile,
            data64: state.coverBase64.split(',')[1] ?? '',
          });
        } catch {
          partialMessages.push('Cover publication failed. You can add a cover later.');
        }
      }

      // 3. Resolve audio duration post-publish
      setState((s) => ({ ...s, step: 'resolving' }));

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
      } catch {
        partialMessages.push(
          'Audio duration could not be resolved. Track metadata will not be created yet.',
        );
      }

      if (durationMs === null || !durationMs || durationMs <= 0) {
        // Audio published but no valid duration — partial success
        setState((s) => ({
          ...s,
          step: 'done',
          partialResult: [
            'Audio published successfully.',
            coverRef ? 'Cover published.' : null,
            ...partialMessages,
            'Track creation is incomplete — duration could not be resolved. You can retry from the Library.',
          ]
            .filter(Boolean)
            .join(' '),
        }));
        return;
      }

      // 4. Create & publish Track metadata
      const genres = state.genres.trim()
        ? getCanonicalTaxonomyValues(state.genres, genreSuggestions)
        : undefined;
      const tags = state.tags.trim()
        ? getCanonicalTaxonomyValues(state.tags, tagSuggestions)
        : undefined;

      await createTrack({
        title: state.title || state.audioSource.fileName.replace(/\.[^/.]+$/, ''),
        artist: state.artist || undefined,
        album: state.album || undefined,
        releaseDate: state.releaseDate || undefined,
        description: state.description || undefined,
        audio: {
          service: 'AUDIO',
          name: publisherName,
          identifier: audioIdentifier,
        },
        cover: coverRef,
        durationMs,
        genres,
        tags,
        source: 'station-upload',
        ownerAddress,
      });

      remember('genres', genres ?? []);
      remember('tags', tags ?? []);

      setState((s) => ({
        ...s,
        step: 'done',
        partialResult: partialMessages.length > 0 ? partialMessages.join(' ') : null,
      }));
    } catch (error) {
      setState((s) => ({
        ...s,
        step: 'error',
        error: error instanceof Error ? error.message : 'Upload failed.',
      }));
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
    createTrack,
    genreSuggestions,
    tagSuggestions,
    remember,
  ]);

  return (
    <Modal title="Upload Audio" onClose={onClose}>
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

      {state.step === 'publishing' && <LoadingState message="Publishing audio to QDN…" />}

      {state.step === 'resolving' && <LoadingState message="Resolving audio duration…" />}

      {state.step === 'done' && (
        <div className="upload-flow__done">
          <p className="upload-flow__success">✅ Track published!</p>
          {state.partialResult && <p className="upload-flow__partial">{state.partialResult}</p>}
          <div className="form-actions">
            <button className="button button--primary" type="button" onClick={onComplete}>
              Done
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() =>
                setState((s) => ({
                  ...s,
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
                  partialResult: null,
                }))
              }
            >
              Upload Another
            </button>
          </div>
        </div>
      )}

      {state.step === 'error' && (
        <ErrorState
          message="Upload failed"
          detail={state.error ?? undefined}
          onRetry={() =>
            setState((s) => ({
              ...s,
              step: 'metadata',
              error: null,
            }))
          }
        />
      )}
    </Modal>
  );
}
