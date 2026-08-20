/* ============================================================
 * NodeFM Station — Submit Music Form
 *
 * Public listener-facing submission flow. The listener selects audio
 * once through SELECT_QDN_PUBLISH_SOURCE, then NodeFM publishes the
 * listener-owned AUDIO and JSON submission proposal. No submission
 * metadata is published until a positive duration is resolved.
 * ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../app/providers/authContext';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import { selectPublishSource, type SelectPublishSourceResult } from '../../../qortium/qdn';
import { generateId } from '../../../utils/id';
import type { ListenerTrackSubmission, QdnResourceRef } from '../../../types/domain';
import { publishListenerSubmission, publishSubmissionMetadata } from '../services/submissionStore';
import { TaxonomyInput, useTaxonomy, getCanonicalTaxonomyValues } from '../../taxonomy';

const COVER_INLINE_MAX_BYTES = 2 * 1024 * 1024;

type Step = 'form' | 'publishing' | 'done' | 'partial' | 'error';

type FormState = {
  step: Step;
  audioSource: Exclude<SelectPublishSourceResult, { canceled: true }> | null;
  title: string;
  artist: string;
  description: string;
  genres: string;
  tags: string;
  coverFile: File | null;
  coverBase64: string | null;
  audioRef: QdnResourceRef | null;
  coverRef: QdnResourceRef | null;
  submissionDraft: ListenerTrackSubmission | null;
  partialReason: string | null;
  error: string | null;
};

function initialFormState(overrides: Partial<FormState> = {}): FormState {
  return {
    step: 'form',
    audioSource: null,
    title: '',
    artist: '',
    description: '',
    genres: '',
    tags: '',
    coverFile: null,
    coverBase64: null,
    audioRef: null,
    coverRef: null,
    submissionDraft: null,
    partialReason: null,
    error: null,
    ...overrides,
  };
}

export function SubmitMusicForm() {
  const { auth } = useAuth();
  const { remember, genres: genreSuggestions, tags: tagSuggestions } = useTaxonomy();
  const submissionIdRef = useRef(generateId());
  const [state, setState] = useState<FormState>(initialFormState);

  const submitterName = auth.status === 'authenticated' ? auth.name?.trim() || null : null;
  const submitterAddress = auth.status === 'authenticated' ? auth.address : null;
  const identityKey = `${submitterAddress ?? ''}\u0000${submitterName ?? ''}`;
  const identityKeyRef = useRef(identityKey);
  identityKeyRef.current = identityKey;
  const lastIdentityKeyRef = useRef<string | null>(null);

  const resetForNewSubmission = useCallback(() => {
    submissionIdRef.current = generateId();
    setState(initialFormState());
  }, []);

  useEffect(() => {
    if (lastIdentityKeyRef.current === null) {
      lastIdentityKeyRef.current = identityKey;
      return;
    }

    if (lastIdentityKeyRef.current !== identityKey) {
      lastIdentityKeyRef.current = identityKey;
      resetForNewSubmission();
    }
  }, [identityKey, resetForNewSubmission]);

  const handleSelectAudio = useCallback(async () => {
    const startedIdentity = identityKeyRef.current;

    if (!submitterName) {
      setState((current) => ({
        ...current,
        error: 'A registered Qortium name is required to submit music.',
      }));
      return;
    }

    setState((current) => ({ ...current, error: null }));

    try {
      const source = await selectPublishSource('file');

      if (source.canceled) {
        return;
      }

      if (identityKeyRef.current !== startedIdentity) {
        return;
      }

      setState((current) => ({
        ...current,
        audioSource: source,
        title: current.title || source.fileName.replace(/\.[^/.]+$/, ''),
        error: null,
      }));
    } catch (selectError) {
      setState((current) => ({
        ...current,
        error: selectError instanceof Error ? selectError.message : 'Failed to open audio picker.',
      }));
    }
  }, [submitterName]);

  const handleCoverSelected = useCallback(async (file: File) => {
    if (file.size > COVER_INLINE_MAX_BYTES) {
      setState((current) => ({
        ...current,
        error: `Cover image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 2 MB.`,
      }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setState((current) => ({
        ...current,
        coverFile: file,
        coverBase64: reader.result as string,
        error: null,
      }));
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSubmit = useCallback(async () => {
    const startedIdentity = identityKeyRef.current;

    if (!submitterName || !submitterAddress || !state.audioSource) {
      setState((current) => ({
        ...current,
        error: !submitterName
          ? 'A registered Qortium name is required to submit music.'
          : !submitterAddress
            ? 'An authenticated account is required to submit music.'
            : 'Select an audio file before submitting.',
      }));
      return;
    }

    if (!state.title.trim()) {
      setState((current) => ({ ...current, error: 'Title is required.' }));
      return;
    }

    setState((current) => ({ ...current, step: 'publishing', error: null }));

    const genres = state.genres.trim()
      ? getCanonicalTaxonomyValues(state.genres, genreSuggestions)
      : undefined;
    const tags = state.tags.trim()
      ? getCanonicalTaxonomyValues(state.tags, tagSuggestions)
      : undefined;

    const result = await publishListenerSubmission({
      submissionId: submissionIdRef.current,
      submitterName,
      submitterAddress,
      title: state.title,
      artist: state.artist || undefined,
      description: state.description || undefined,
      genres,
      tags,
      audioSource: state.audioSource,
      cover:
        state.coverFile && state.coverBase64
          ? {
              fileName: state.coverFile.name,
              data64: state.coverBase64.split(',')[1],
            }
          : undefined,
    });

    if (identityKeyRef.current !== startedIdentity) {
      return;
    }

    if (result.status === 'published') {
      remember('genres', genres ?? []);
      remember('tags', tags ?? []);
      setState((current) => ({
        ...current,
        step: 'done',
        error: null,
        audioRef: null,
        coverRef: null,
        submissionDraft: null,
      }));
      return;
    }

    if (result.status === 'partial') {
      setState((current) => ({
        ...current,
        step: 'partial',
        audioRef: result.audio,
        coverRef: result.cover ?? null,
        submissionDraft: result.submissionDraft ?? null,
        partialReason: result.reason,
        error: null,
      }));
      return;
    }

    setState((current) => ({ ...current, step: 'error', error: result.reason }));
  }, [
    state.artist,
    state.audioSource,
    state.coverBase64,
    state.coverFile,
    state.description,
    state.genres,
    state.tags,
    state.title,
    submitterAddress,
    submitterName,
    genreSuggestions,
    tagSuggestions,
    remember,
  ]);

  const handleRetryMetadata = useCallback(async () => {
    if (!state.submissionDraft || !submitterName) {
      return;
    }

    setState((current) => ({ ...current, step: 'publishing', error: null }));

    try {
      await publishSubmissionMetadata(state.submissionDraft, submitterName);
      setState((current) => ({
        ...current,
        step: 'done',
        audioRef: null,
        coverRef: null,
        submissionDraft: null,
        error: null,
      }));
    } catch (metadataError) {
      setState((current) => ({
        ...current,
        step: 'partial',
        error: metadataError instanceof Error ? metadataError.message : 'Metadata retry failed.',
      }));
    }
  }, [state.submissionDraft, submitterName]);

  if (auth.status === 'loading') {
    return <LoadingState message="Checking Qortium identity…" />;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <ErrorState
        message="Sign in to submit music"
        detail="Select a Qortium account in Home before submitting music to NodeFM."
      />
    );
  }

  if (!submitterName) {
    return (
      <ErrorState
        message="A registered Qortium name is required"
        detail="Your selected account does not have a registered Qortium name, which is required to publish QDN resources."
      />
    );
  }

  if (state.step === 'publishing') {
    return <LoadingState message="Publishing your submission to QDN…" />;
  }

  if (state.step === 'done') {
    return (
      <div className="submit-music__done">
        <h2>Submission sent</h2>
        <p>
          Your music was published to QDN and sent to the station owner for review. If accepted, it
          can become a normal NodeFM Station Track.
        </p>
        <div className="form-actions">
          <button className="button button--primary" type="button" onClick={resetForNewSubmission}>
            Submit Another
          </button>
        </div>
      </div>
    );
  }

  if (state.step === 'partial') {
    return (
      <div className="submit-music__partial">
        <h2>Submission is incomplete</h2>
        <p>
          {state.partialReason ??
            'Your media published, but the submission could not be completed.'}
        </p>
        {state.audioRef ? (
          <p className="submit-music__hint">
            Audio is already published and will be reused if you retry the metadata step.
          </p>
        ) : null}
        {state.error ? <p className="form-error">{state.error}</p> : null}
        <div className="form-actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={resetForNewSubmission}
          >
            Start New Submission
          </button>
          {state.submissionDraft ? (
            <button className="button button--primary" type="button" onClick={handleRetryMetadata}>
              Retry Submission
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (state.step === 'error') {
    return (
      <ErrorState
        message="Submission failed"
        detail={state.error ?? undefined}
        onRetry={() => setState((current) => ({ ...current, step: 'form', error: null }))}
      />
    );
  }

  return (
    <form
      className="submit-music"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="submit-music__intro">
        <p>
          Submit music for possible inclusion in NodeFM Station. Your audio stays published under
          your Qortium name. The station owner reviews each submission before it can enter the
          station library.
        </p>
      </div>

      <div className="form-field">
        <span>Audio file</span>
        <div className="submit-music__audio">
          {state.audioSource ? (
            <span className="submit-music__file">
              {state.audioSource.fileName} ({(state.audioSource.size / 1024 / 1024).toFixed(1)} MB)
            </span>
          ) : (
            <span className="submit-music__file">No audio selected.</span>
          )}
          <button
            className="button button--secondary"
            type="button"
            onClick={handleSelectAudio}
            disabled={!submitterName}
          >
            {state.audioSource ? 'Select Different Audio' : 'Select Audio File'}
          </button>
        </div>
        <p className="submit-music__hint">Supported formats: MP3, WAV, FLAC, OGG, AAC, M4A</p>
      </div>

      <label className="form-field">
        Title
        <input
          type="text"
          value={state.title}
          onChange={(event) => setState((current) => ({ ...current, title: event.target.value }))}
          placeholder="Track title"
        />
      </label>

      <label className="form-field">
        Artist
        <input
          type="text"
          value={state.artist}
          onChange={(event) => setState((current) => ({ ...current, artist: event.target.value }))}
          placeholder="Artist name"
        />
      </label>

      <label className="form-field">
        Description
        <textarea
          value={state.description}
          onChange={(event) =>
            setState((current) => ({ ...current, description: event.target.value }))
          }
          placeholder="Optional description"
          rows={3}
        />
      </label>

      <label className="form-field">
        Genres
        <TaxonomyInput
          kind="genres"
          value={state.genres}
          onChange={(value) => setState((current) => ({ ...current, genres: value }))}
          placeholder="Rock, Electronic, Jazz"
        />
      </label>

      <label className="form-field">
        Tags
        <TaxonomyInput
          kind="tags"
          value={state.tags}
          onChange={(value) => setState((current) => ({ ...current, tags: value }))}
          placeholder="chill, upbeat, instrumental"
        />
      </label>

      <div className="form-field">
        <label>Cover Image (optional, max 2 MB)</label>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleCoverSelected(file);
            }
          }}
        />
        {state.coverBase64 ? (
          <img src={state.coverBase64} alt="Cover preview" className="upload-flow__cover-preview" />
        ) : null}
      </div>

      {state.error ? <p className="form-error">{state.error}</p> : null}

      <div className="form-actions">
        <button
          className="button button--primary"
          type="submit"
          disabled={!state.audioSource || !state.title.trim() || !submitterName}
        >
          Submit Music
        </button>
      </div>
    </form>
  );
}
