/* ============================================================
 * NodeFM Station — Schedule Event Editor Modal
 *
 * Creates/edits a concrete UTC ScheduleEvent using station-local
 * wall-clock fields. Failed validation or publication keeps the
 * modal open; success closes it intentionally.
 * ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useStation } from '../../station';
import { usePlaylists } from '../../../hooks/usePlaylists';
import { useScheduler } from '../hooks/useScheduler';
import type { ScheduleEvent } from '../../../types/domain';
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

export function ScheduleEventEditorModal({
  mode,
  event,
  initialDate,
  initialStartTime,
  initialEndTime,
  onClose,
}: ScheduleEventEditorModalProps) {
  const { station } = useStation();
  const { playlists, getVersions } = usePlaylists();
  const { createEvent, updateEvent, deleteEvent } = useScheduler();
  const timeZone = station?.timezone ?? '';

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('12:00');
  const [endTime, setEndTime] = useState('13:00');
  const [playlistId, setPlaylistId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!timeZone) {
      return;
    }

    if (event) {
      setTitle(event.title ?? '');
      setDate(toDateInput(Date.parse(event.startUtc), timeZone));
      setStartTime(toTimeInput(Date.parse(event.startUtc), timeZone));
      setEndTime(toTimeInput(Date.parse(event.endUtc), timeZone));

      if (event.source.type === 'playlist') {
        setPlaylistId(event.source.playlistId);
        setVersionId(event.source.playlistVersionId);
      }
      return;
    }

    setDate(initialDate ?? toDateInput(Date.now(), timeZone));
    setStartTime(initialStartTime ?? '12:00');
    setEndTime(initialEndTime ?? '13:00');
    setPlaylistId('');
    setVersionId('');
  }, [event, initialDate, initialEndTime, initialStartTime, timeZone]);

  const versions = useMemo(
    () => (playlistId ? getVersions(playlistId) : []),
    [getVersions, playlistId],
  );

  const isDynamicUnsupported = event?.source.type === 'dynamic-program';

  const handleSave = async () => {
    if (!timeZone) {
      setError('Station timezone is not configured.');
      return;
    }

    if (!playlistId || !versionId) {
      setError('Select a playlist and an immutable published version.');
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

      const source = {
        type: 'playlist' as const,
        playlistId,
        playlistVersionId: versionId,
      };

      setSaving(true);
      setError(null);

      if (mode === 'create') {
        await createEvent({
          title: title.trim() || undefined,
          startUtc: new Date(startUtcMs).toISOString(),
          endUtc: new Date(endUtcMs).toISOString(),
          source,
        });
      } else if (event) {
        await updateEvent(event.eventId, {
          title: title.trim() || undefined,
          startUtc: new Date(startUtcMs).toISOString(),
          endUtc: new Date(endUtcMs).toISOString(),
          source,
        });
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
      {isDynamicUnsupported ? (
        <div className="schedule-editor__unsupported">
          Dynamic program events are not editable in Phase 4.
        </div>
      ) : (
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
              disabled={saving || !playlistId || !versionId || !timeZone}
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Schedule Program' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
