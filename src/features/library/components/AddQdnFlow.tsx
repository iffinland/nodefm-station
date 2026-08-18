/* ============================================================
 * NodeFM Station — Add QDN Flow
 *
 * Wizard for adding an existing QDN audio resource to the
 * station library without duplicating the media.
 * ============================================================ */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import {
  searchQdnResources,
  getQdnResourceUrl,
  ensureQdnResourceReady,
} from '../../../qortium/qdn';
import { useLibrary } from '../../../hooks/useLibrary';
import { useAuth } from '../../../app/providers/authContext';
import {
  resolveAudioDurationFromUrl,
  formatDurationMs,
  isValidDurationMs,
} from '../../../utils/duration';
import type { QdnResourceInfo } from '../../../qortium/qdn';

type Step = 'search' | 'confirm' | 'metadata' | 'importing' | 'done' | 'error';

type State = {
  step: Step;
  searchQuery: string;
  results: QdnResourceInfo[];
  searching: boolean;
  searchError: string | null;
  selected: QdnResourceInfo | null;
  durationMs: number | null;
  durationResolving: boolean;
  title: string;
  artist: string;
  description: string;
  genres: string;
  tags: string;
  error: string | null;
};

export function AddQdnFlow({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const { createTrack } = useLibrary();
  const { auth } = useAuth();
  const ownerAddress = auth.status === 'authenticated' ? auth.address : null;

  const [state, setState] = useState<State>({
    step: 'search',
    searchQuery: '',
    results: [],
    searching: false,
    searchError: null,
    selected: null,
    durationMs: null,
    durationResolving: false,
    title: '',
    artist: '',
    description: '',
    genres: '',
    tags: '',
    error: null,
  });

  const handleSearch = useCallback(async () => {
    if (!state.searchQuery.trim()) return;

    setState((s) => ({ ...s, searching: true, searchError: null, results: [] }));

    try {
      const results = await searchQdnResources({
        service: 'AUDIO',
        query: state.searchQuery.trim(),
        limit: 20,
        includeMetadata: true,
        includeStatus: true,
      });

      setState((s) => ({ ...s, results, searching: false }));
    } catch (error) {
      setState((s) => ({
        ...s,
        searching: false,
        searchError: error instanceof Error ? error.message : 'Search failed.',
      }));
    }
  }, [state.searchQuery]);

  const handleSelect = useCallback(async (resource: QdnResourceInfo) => {
    setState((s) => ({
      ...s,
      step: 'confirm',
      selected: resource,
      durationResolving: true,
      title: resource.metadata?.title ?? resource.name ?? '',
      artist: '',
      durationMs: null,
    }));

    // Resolve duration
    try {
      const ref = {
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
      };

      await ensureQdnResourceReady(ref);
      const url = await getQdnResourceUrl(ref);
      const durationMs = await resolveAudioDurationFromUrl(url);
      setState((s) => ({ ...s, durationMs, durationResolving: false }));
    } catch {
      setState((s) => ({
        ...s,
        durationResolving: false,
        error: 'Unable to resolve audio duration. The resource may not be playable.',
      }));
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!state.selected || !ownerAddress) return;

    if (state.durationMs === null || !isValidDurationMs(state.durationMs)) {
      setState((s) => ({
        ...s,
        step: 'error',
        error:
          'Cannot add this track because its audio duration could not be resolved or is invalid.',
      }));
      return;
    }

    setState((s) => ({ ...s, step: 'importing', error: null }));

    try {
      const genres = state.genres
        ? state.genres
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean)
        : undefined;
      const tags = state.tags
        ? state.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined;

      await createTrack({
        title: state.title || state.selected.name || 'Untitled',
        artist: state.artist || state.selected.metadata?.title || undefined,
        description: state.description || undefined,
        audio: {
          service: state.selected.service,
          name: state.selected.name,
          identifier: state.selected.identifier || 'default',
        },
        durationMs: state.durationMs,
        genres,
        tags,
        source: 'qdn-existing',
        ownerAddress,
      });

      setState((s) => ({ ...s, step: 'done' }));
    } catch (error) {
      setState((s) => ({
        ...s,
        step: 'error',
        error: error instanceof Error ? error.message : 'Import failed.',
      }));
    }
  }, [
    state.selected,
    state.title,
    state.artist,
    state.description,
    state.genres,
    state.tags,
    state.durationMs,
    ownerAddress,
    createTrack,
  ]);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">Add from QDN</h2>
          <button className="modal__close" type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal__body">
          {state.step === 'search' && (
            <div className="add-qdn__search">
              <p>Search for existing QDN audio resources to add to your library.</p>
              <div className="add-qdn__search-bar">
                <input
                  type="text"
                  value={state.searchQuery}
                  onChange={(e) => setState((s) => ({ ...s, searchQuery: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search QDN audio…"
                />
                <button
                  className="button button--primary"
                  type="button"
                  onClick={handleSearch}
                  disabled={state.searching || !state.searchQuery.trim()}
                >
                  Search
                </button>
              </div>

              {state.searching && <LoadingState message="Searching QDN…" />}

              {state.searchError && (
                <ErrorState
                  message="Search failed"
                  detail={state.searchError}
                  onRetry={handleSearch}
                />
              )}

              {!state.searching && state.results.length > 0 && (
                <div className="add-qdn__results">
                  {state.results.map((r) => (
                    <div
                      key={`${r.service}-${r.name}`}
                      className="add-qdn__result-item"
                      onClick={() => handleSelect(r)}
                    >
                      <div className="add-qdn__result-info">
                        <strong>{r.metadata?.title ?? r.name}</strong>
                        {r.metadata?.description && (
                          <span className="add-qdn__result-desc">{r.metadata.description}</span>
                        )}
                        <span className="add-qdn__result-service">{r.service}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!state.searching && state.results.length === 0 && !state.searchError && (
                <p className="add-qdn__empty">Enter a search query to find QDN audio resources.</p>
              )}
            </div>
          )}

          {state.step === 'confirm' && state.selected && (
            <div className="add-qdn__confirm">
              <h3>Selected Resource</h3>
              <div className="add-qdn__resource-detail">
                <p>
                  <strong>Name:</strong> {state.selected.metadata?.title ?? state.selected.name}
                </p>
                <p>
                  <strong>Service:</strong> {state.selected.service}
                </p>
                {state.selected.metadata?.description && (
                  <p>
                    <strong>Description:</strong> {state.selected.metadata.description}
                  </p>
                )}
                <p>
                  <strong>Duration:</strong>{' '}
                  {state.durationResolving
                    ? 'Resolving…'
                    : state.durationMs !== null
                      ? formatDurationMs(state.durationMs)
                      : 'Unknown'}
                </p>
              </div>

              {state.error && <p className="form-error">{state.error}</p>}

              <div className="form-actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setState((s) => ({ ...s, step: 'search' }))}
                >
                  Back to Search
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => setState((s) => ({ ...s, step: 'metadata' }))}
                  disabled={
                    state.durationResolving ||
                    state.durationMs === null ||
                    !isValidDurationMs(state.durationMs)
                  }
                >
                  Add Metadata
                </button>
              </div>
            </div>
          )}

          {state.step === 'metadata' && (
            <div className="add-qdn__metadata">
              <h3>Track Metadata</h3>

              <label className="form-field">
                Title
                <input
                  type="text"
                  value={state.title}
                  onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
                />
              </label>

              <label className="form-field">
                Artist
                <input
                  type="text"
                  value={state.artist}
                  onChange={(e) => setState((s) => ({ ...s, artist: e.target.value }))}
                />
              </label>

              <label className="form-field">
                Description
                <textarea
                  value={state.description}
                  onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
                  rows={2}
                />
              </label>

              <label className="form-field">
                Genres (comma-separated)
                <input
                  type="text"
                  value={state.genres}
                  onChange={(e) => setState((s) => ({ ...s, genres: e.target.value }))}
                  placeholder="Rock, Electronic"
                />
              </label>

              <label className="form-field">
                Tags (comma-separated)
                <input
                  type="text"
                  value={state.tags}
                  onChange={(e) => setState((s) => ({ ...s, tags: e.target.value }))}
                />
              </label>

              <div className="form-actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setState((s) => ({ ...s, step: 'confirm' }))}
                >
                  Back
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={handleImport}
                  disabled={
                    !state.title ||
                    state.durationMs === null ||
                    !isValidDurationMs(state.durationMs)
                  }
                >
                  Add to Library
                </button>
              </div>
            </div>
          )}

          {state.step === 'importing' && <LoadingState message="Adding track to library…" />}

          {state.step === 'done' && (
            <div className="upload-flow__done">
              <p className="upload-flow__success">✅ Track added to library!</p>
              <div className="form-actions">
                <button className="button button--primary" type="button" onClick={onComplete}>
                  Done
                </button>
              </div>
            </div>
          )}

          {state.step === 'error' && (
            <ErrorState
              message="Import failed"
              detail={state.error ?? undefined}
              onRetry={() =>
                setState((s) => ({
                  ...s,
                  step: state.selected ? 'confirm' : 'search',
                  error: null,
                }))
              }
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
