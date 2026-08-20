/* ============================================================
 * NodeFM Station — Schedule Event Editor Modal
 *
 * Creates/edits a concrete UTC ScheduleEvent using station-local
 * wall-clock fields. Supports immutable playlist sources and
 * Request Show dynamic-program sources.
 * ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useStation, useStationIdentity } from '../../station';
import { usePlaylists } from '../../../hooks/usePlaylists';
import { useLibrary } from '../../../hooks/useLibrary';
import { useLikes } from '../../likes/useLikes';
import { useRequestShow } from '../../dynamic-programs/request-show/useRequestShow';
import { materializeRequestShowOccurrenceAction } from '../../dynamic-programs/request-show/requestShowStore';
import { useScheduler } from '../hooks/useScheduler';
import type { ScheduleEvent, Track } from '../../../types/domain';
import { isValidDurationMs } from '../../../utils/duration';
import {
  parseLocalDateInput,
  parseLocalTimeInput,
  requireUnambiguousZonedUtcMs,
} from '../services/timezone';

export type ScheduleEventEditorModalProps = {
  mode: 'create' | 'edit';
  event?: ScheduleEvent;
  initialDate?: string;
  initialStartTime?: string;
  initialEndTime?: string;
  onClose: () => void;
};

function toDateInput(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(utcMs))
    .replace(/-/g, '-');
}

function toTimeInput(utcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(utcMs));
}

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

export function ScheduleEventEditorModal({
  mode,
  event,
  initialDate,
  initialStartTime,
  initialEndTime,
  onClose,
}: ScheduleEventEditorModalProps) {
  const { station } = useStation();
  const { publisherName } = useStationIdentity();
  const { playlists, getVersions } = usePlaylists();
  const { createEvent, updateEvent, deleteEvent } = useScheduler();
  const { tracks: libraryTracks, loaded: libraryLoaded, loading: libraryLoading } = useLibrary();
  const { definitions, loaded: requestShowLoaded, loading: requestShowLoading } = useRequestShow();
  const timeZone = station?.timezone ?? '';

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('12:00');
  const [endTime, setEndTime] = useState('13:00');
  const [sourceType, setSourceType] = useState<'playlist' | 'dynamic-program'>('playlist');
  const [playlistId, setPlaylistId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [programDefinitionId, setProgramDefinitionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!timeZone) {
      return;
    }

    if (event) {
      setTitle(event.title ?? '');
      setDate(toDateInput(Date.parse(event.startUtc), timeZone));
      setStartTime(toTimeInput(Date.parse(event.startUtc), timeZone));
      setEndTime(toTimeInput(Date.parse(event.endUtc), timeZone));
      setSourceType(event.source.type);

      if (event.source.type === 'playlist') {
        setPlaylistId(event.source.playlistId);
        setVersionId(event.source.playlistVersionId);
        setProgramDefinitionId('');
      } else {
        setPlaylistId('');
        setVersionId('');
        setProgramDefinitionId(event.source.programDefinitionId);
      }
      return;
    }

    setDate(initialDate ?? toDateInput(Date.now(), timeZone));
    setStartTime(initialStartTime ?? '12:00');
    setEndTime(initialEndTime ?? '13:00');
    setSourceType('playlist');
    setPlaylistId('');
    setVersionId('');
    setProgramDefinitionId('');
  }, [event, initialDate, initialEndTime, initialStartTime, timeZone]);

  const versions = useMemo(
    () => (playlistId ? getVersions(playlistId) : []),
    [getVersions, playlistId],
  );

  const handleSave = async () => {
    if (!timeZone) {
      setError('Station timezone is not configured.');
      return;
    }

    if (sourceType === 'playlist' && (!playlistId || !versionId)) {
      setError('Select a playlist and an immutable published version.');
      return;
    }

    if (sourceType === 'dynamic-program' && !programDefinitionId) {
      setError('Select a Request Show definition.');
      return;
    }

    try {
      const dateParts = parseLocalDateInput(date);
      const startParts = parseLocalTimeInput(startTime);
      const endParts = parseLocalTimeInput(endTime);
      const startUtcMs = requireUnambiguousZonedUtcMs({ ...dateParts, ...startParts }, timeZone);
      const endUtcMs = requireUnambiguousZonedUtcMs({ ...dateParts, ...endParts }, timeZone);

      if (endUtcMs <= startUtcMs) {
        setError('End time must be later than start time.');
        return;
      }

      const source =
        sourceType === 'playlist'
          ? ({ type: 'playlist', playlistId, playlistVersionId: versionId } as const)
          : ({ type: 'dynamic-program', programDefinitionId } as const);

      setSaving(true);
      setError(null);

      const savedEvent =
        mode === 'create'
          ? await createEvent({
              title: title.trim() || undefined,
              startUtc: new Date(startUtcMs).toISOString(),
              endUtc: new Date(endUtcMs).toISOString(),
              source,
            })
          : event
            ? await updateEvent(event.eventId, {
                title: title.trim() || undefined,
                startUtc: new Date(startUtcMs).toISOString(),
                endUtc: new Date(endUtcMs).toISOString(),
                source,
              })
            : null;

      if (sourceType === 'dynamic-program' && savedEvent) {
        const definition = definitions.find(
          (candidate) => candidate.programDefinitionId === programDefinitionId,
        );

        if (!definition) {
          throw new Error('Selected Request Show definition is no longer available.');
        }

        if (!publisherName) {
          throw new Error('A registered Qortium name is required to materialize Request Show.');
        }

        if (!libraryLoaded) {
          throw new Error('Station library is not ready. Wait for library loading to finish.');
        }

        if (!requestShowLoaded) {
          throw new Error('Request Show configuration is not ready.');
        }

        if (!likesReady) {
          throw new Error('Like records are not ready. Wait for Like loading to finish.');
        }

        try {
          await materializeRequestShowOccurrenceAction(
            savedEvent,
            definition,
            eligibleTracks,
            rankFromAggregates(eligibleTracks, aggregates),
            new Date().toISOString(),
            publisherName,
            { reuseExisting: mode === 'create' },
          );
        } catch (materializeError) {
          if (mode === 'create') {
            try {
              await deleteEvent(savedEvent.eventId);
            } catch {
              // The original event may remain as a recoverable partial state.
            }
          }

          throw materializeError;
        }
      }

      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save schedule event.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event || !window.confirm('Delete this scheduled program?')) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await deleteEvent(event.eventId);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to delete schedule event.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={mode === 'create' ? 'Schedule Program' : 'Edit Program'} onClose={onClose}>
      <div className="schedule-editor">
        <label className="form-field">
          Program title
          <input
            type="text"
            value={title}
            onChange={(changeEvent) => setTitle(changeEvent.target.value)}
            placeholder="Evening Rock"
          />
        </label>

        <label className="form-field">
          Source type
          <select
            value={sourceType}
            onChange={(changeEvent) =>
              setSourceType(changeEvent.target.value as 'playlist' | 'dynamic-program')
            }
          >
            <option value="playlist">Immutable playlist</option>
            <option value="dynamic-program">Request Show</option>
          </select>
        </label>

        <label className="form-field">
          Local date ({timeZone || 'station timezone'})
          <input
            type="date"
            value={date}
            onChange={(changeEvent) => setDate(changeEvent.target.value)}
          />
        </label>

        <div className="schedule-editor__time-row">
          <label className="form-field">
            Start time
            <input
              type="time"
              value={startTime}
              onChange={(changeEvent) => setStartTime(changeEvent.target.value)}
            />
          </label>
          <label className="form-field">
            End time
            <input
              type="time"
              value={endTime}
              onChange={(changeEvent) => setEndTime(changeEvent.target.value)}
            />
          </label>
        </div>

        {sourceType === 'playlist' ? (
          <>
            <label className="form-field">
              Playlist
              <select
                value={playlistId}
                onChange={(changeEvent) => {
                  setPlaylistId(changeEvent.target.value);
                  setVersionId('');
                }}
              >
                <option value="">Select a playlist</option>
                {playlists.map((playlist) => (
                  <option key={playlist.playlistId} value={playlist.playlistId}>
                    {playlist.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field">
              Immutable playlist version
              <select
                value={versionId}
                onChange={(changeEvent) => setVersionId(changeEvent.target.value)}
                disabled={!playlistId}
              >
                <option value="">Select a published version</option>
                {versions.map((version) => (
                  <option key={version.versionId} value={version.versionId}>
                    v{version.versionNumber} — {version.tracks.length} tracks
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className="form-field">
            Request Show definition
            <select
              value={programDefinitionId}
              onChange={(changeEvent) => setProgramDefinitionId(changeEvent.target.value)}
            >
              <option value="">Select a Request Show definition</option>
              {definitions.map((definition) => (
                <option key={definition.programDefinitionId} value={definition.programDefinitionId}>
                  {definition.title}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
          {mode === 'edit' && event && (
            <button
              className="button button--secondary"
              type="button"
              onClick={handleDelete}
              disabled={saving}
            >
              Delete
            </button>
          )}
          <button
            className="button button--secondary"
            type="button"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={handleSave}
            disabled={
              saving ||
              !timeZone ||
              (sourceType === 'playlist' && (!playlistId || !versionId)) ||
              (sourceType === 'dynamic-program' &&
                (!programDefinitionId || !libraryLoaded || !requestShowLoaded || !likesReady))
            }
          >
            {saving
              ? 'Saving…'
              : mode === 'create'
                ? sourceType === 'dynamic-program'
                  ? 'Schedule & Generate'
                  : 'Schedule Program'
                : 'Save Changes'}
          </button>
        </div>
        {sourceType === 'dynamic-program' &&
        (libraryLoading || requestShowLoading || likesLoading || likesIncomplete) ? (
          <p className="schedule-editor__unsupported">
            Waiting for station library and Like records before generating the lineup…
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
