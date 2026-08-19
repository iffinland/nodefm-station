/* ============================================================
 * NodeFM Station — Request Show Admin Panel
 *
 * Minimal owner controls for the Request Show dynamic program:
 * create/update the definition and materialize missing canonical
 * occurrences for already-scheduled dynamic events.
 * ============================================================ */

import { useMemo, useState } from 'react';
import { LoadingState } from '../../../components/LoadingState';
import { ErrorState } from '../../../components/ErrorState';
import { useAuth } from '../../../app/providers/authContext';
import { useLibrary } from '../../../hooks/useLibrary';
import { useLikes } from '../../likes/useLikes';
import { useRequestShow } from './useRequestShow';
import { materializeRequestShowOccurrenceAction } from './requestShowStore';
import type { ScheduleEvent, Track } from '../../../types/domain';
import { isValidDurationMs } from '../../../utils/duration';

export type RequestShowAdminPanelProps = {
  events: readonly ScheduleEvent[];
};

function rankFromAggregates(
  tracks: readonly Track[],
  aggregates: Record<string, { count: number }>,
) {
  return tracks
    .filter((track) => (aggregates[track.trackId]?.count ?? 0) > 0)
    .map((track) => ({
      trackId: track.trackId,
      likeCount: aggregates[track.trackId]?.count ?? 0,
      likerAddresses: [] as string[],
    }))
    .sort((left, right) => {
      if (right.likeCount !== left.likeCount) {
        return right.likeCount - left.likeCount;
      }

      return left.trackId.localeCompare(right.trackId);
    });
}

export function RequestShowAdminPanel({ events }: RequestShowAdminPanelProps) {
  const { ownerName } = useAuth();
  const { tracks: libraryTracks, loading: libraryLoading } = useLibrary();
  const {
    definitions,
    occurrences,
    loaded,
    loading,
    error,
    createDefinition,
    updateDefinition,
    refresh,
  } = useRequestShow();

  const [title, setTitle] = useState('Request Show');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [editingDefinitionId, setEditingDefinitionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const eligibleTracks = useMemo(
    () => libraryTracks.filter((track) => isValidDurationMs(track.durationMs)),
    [libraryTracks],
  );
  const trackIds = useMemo(() => eligibleTracks.map((track) => track.trackId), [eligibleTracks]);
  const {
    aggregates,
    ready: likesReady,
    loading: likesLoading,
    incomplete: likesIncomplete,
  } = useLikes(trackIds);

  const dynamicEvents = events.filter((event) => event.source.type === 'dynamic-program');
  const missingOccurrences = dynamicEvents.filter(
    (event) => !occurrences.some((occurrence) => occurrence.scheduleEventId === event.eventId),
  );

  const beginEdit = (programDefinitionId: string) => {
    const definition = definitions.find(
      (candidate) => candidate.programDefinitionId === programDefinitionId,
    );
    if (!definition) {
      return;
    }

    setEditingDefinitionId(definition.programDefinitionId);
    setTitle(definition.title);
    setDurationMinutes(Math.round(definition.targetDurationMs / 60_000));
  };

  const resetForm = () => {
    setEditingDefinitionId(null);
    setTitle('Request Show');
    setDurationMinutes(30);
    setFormError(null);
  };

  const handleSaveDefinition = async () => {
    if (!ownerName) {
      setFormError('A registered Qortium name is required.');
      return;
    }

    if (!title.trim()) {
      setFormError('Title is required.');
      return;
    }

    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      setFormError('Duration must be a positive number of minutes.');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);
      setStatusMessage(null);

      const input = {
        title: title.trim(),
        targetDurationMs: durationMinutes * 60_000,
      };

      if (editingDefinitionId) {
        await updateDefinition(editingDefinitionId, input);
      } else {
        await createDefinition(input);
      }

      resetForm();
      setStatusMessage('Request Show definition saved.');
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'Failed to save definition.');
    } finally {
      setSaving(false);
    }
  };

  const handleMaterializeMissing = async () => {
    if (!ownerName) {
      setFormError('A registered Qortium name is required.');
      return;
    }

    if (!likesReady) {
      setFormError('Like records are not ready yet.');
      return;
    }

    setSaving(true);
    setFormError(null);
    setStatusMessage(null);

    try {
      const ranked = rankFromAggregates(eligibleTracks, aggregates);
      const failures: string[] = [];
      let generated = 0;

      for (const event of missingOccurrences) {
        if (event.source.type !== 'dynamic-program') {
          continue;
        }

        const programDefinitionId = event.source.programDefinitionId;
        const definition = definitions.find(
          (candidate) => candidate.programDefinitionId === programDefinitionId,
        );

        if (!definition) {
          failures.push(`${event.eventId}: missing Request Show definition`);
          continue;
        }

        try {
          await materializeRequestShowOccurrenceAction(
            event,
            definition,
            eligibleTracks,
            ranked,
            new Date().toISOString(),
            ownerName,
          );
          generated += 1;
        } catch (materializeError) {
          failures.push(
            `${event.eventId}: ${
              materializeError instanceof Error ? materializeError.message : 'unknown error'
            }`,
          );
        }
      }

      if (failures.length > 0) {
        setFormError(`Materialized ${generated} occurrence(s). ${failures.join(' | ')}`);
      } else {
        setStatusMessage(`Materialized ${generated} missing occurrence(s).`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading || libraryLoading || likesLoading) {
    return <LoadingState message="Loading Request Show configuration…" />;
  }

  if (error && !loaded) {
    return (
      <ErrorState
        message="Failed to load Request Show configuration."
        detail={error}
        onRetry={refresh}
      />
    );
  }

  return (
    <section className="request-show-admin">
      <div className="request-show-admin__form">
        <h3>
          {editingDefinitionId ? 'Edit Request Show Definition' : 'New Request Show Definition'}
        </h3>
        <label className="form-field">
          Title
          <input
            type="text"
            value={title}
            onChange={(changeEvent) => setTitle(changeEvent.target.value)}
          />
        </label>
        <label className="form-field">
          Target duration (minutes)
          <input
            type="number"
            min={1}
            step={1}
            value={durationMinutes}
            onChange={(changeEvent) => setDurationMinutes(Number(changeEvent.target.value))}
          />
        </label>
        <div className="form-actions">
          {editingDefinitionId && (
            <button
              className="button button--secondary"
              type="button"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel Edit
            </button>
          )}
          <button
            className="button button--primary"
            type="button"
            onClick={handleSaveDefinition}
            disabled={saving}
          >
            {saving ? 'Saving…' : editingDefinitionId ? 'Save Definition' : 'Create Definition'}
          </button>
        </div>
        {formError && <p className="form-error">{formError}</p>}
        {statusMessage && <p className="form-success">{statusMessage}</p>}
      </div>

      <div className="request-show-admin__definitions">
        <h3>Definitions</h3>
        {definitions.length === 0 ? (
          <p className="request-show-admin__empty">No Request Show definitions yet.</p>
        ) : (
          <ul className="request-show-admin__list">
            {definitions.map((definition) => (
              <li className="request-show-admin__item" key={definition.programDefinitionId}>
                <div>
                  <strong>{definition.title}</strong>
                  <span>
                    {Math.round(definition.targetDurationMs / 60_000)} min · Most Liked ·
                    deterministic fallback
                  </span>
                </div>
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => beginEdit(definition.programDefinitionId)}
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="request-show-admin__occurrences">
        <div className="request-show-admin__occurrence-toolbar">
          <h3>Generated Occurrences</h3>
          <button
            className="button button--primary"
            type="button"
            onClick={handleMaterializeMissing}
            disabled={
              saving ||
              missingOccurrences.length === 0 ||
              definitions.length === 0 ||
              likesIncomplete
            }
          >
            Materialize {missingOccurrences.length} missing
          </button>
        </div>

        {likesIncomplete && (
          <p className="form-error">
            Like discovery is incomplete. Materialization is disabled until all Like resources are
            available.
          </p>
        )}

        {dynamicEvents.length === 0 ? (
          <p className="request-show-admin__empty">
            No scheduled Request Show events. Use the Schedule tab to create one.
          </p>
        ) : (
          <ul className="request-show-admin__list">
            {dynamicEvents.map((event) => {
              const occurrence = occurrences.find(
                (candidate) => candidate.scheduleEventId === event.eventId,
              );

              return (
                <li className="request-show-admin__item" key={event.eventId}>
                  <div>
                    <strong>{event.title ?? 'Request Show'}</strong>
                    <span>
                      {new Date(event.startUtc).toLocaleString()} ·{' '}
                      {occurrence ? `${occurrence.tracks.length} tracks generated` : 'missing'}
                    </span>
                  </div>
                  <span
                    className={`request-show-admin__status${occurrence ? ' request-show-admin__status--ready' : ''}`}
                  >
                    {occurrence ? 'READY' : 'MISSING'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
