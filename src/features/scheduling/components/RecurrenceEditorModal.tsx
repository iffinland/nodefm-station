/* ============================================================
 * NodeFM Station — Recurrence Editor Modal
 *
 * Authors Daily/Weekly admin intent, compiles it into concrete
 * UTC ScheduleEvents, and persists both the intent resource and
 * the canonical event resources through the scheduler store.
 * ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { useStation } from '../../station';
import { usePlaylists } from '../../../hooks/usePlaylists';
import { useScheduler } from '../hooks/useScheduler';
import type { ScheduleRecurrence } from '../../../types/domain';

const DAY_OPTIONS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const;

export type RecurrenceEditorModalProps = {
  mode: 'create' | 'edit';
  recurrence?: ScheduleRecurrence;
  onClose: () => void;
};

export function RecurrenceEditorModal({ mode, recurrence, onClose }: RecurrenceEditorModalProps) {
  const { station } = useStation();
  const { playlists, getVersions } = usePlaylists();
  const { createRecurrence, updateRecurrence } = useScheduler();
  const timeZone = station?.timezone ?? '';

  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [startTime, setStartTime] = useState('20:00');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [activeFrom, setActiveFrom] = useState('');
  const [activeUntil, setActiveUntil] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [playlistId, setPlaylistId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!timeZone) {
      return;
    }

    if (recurrence) {
      setTitle(recurrence.title);
      setFrequency(recurrence.frequency);
      setStartTime(recurrence.localStartTime);
      setDurationMinutes(Math.round(recurrence.durationMs / 60_000));
      setActiveFrom(recurrence.activeFromLocalDate);
      setActiveUntil(recurrence.activeUntilLocalDate ?? '');
      setDaysOfWeek(recurrence.daysOfWeek ?? []);

      if (recurrence.source.type === 'playlist') {
        setPlaylistId(recurrence.source.playlistId);
        setVersionId(recurrence.source.playlistVersionId);
      }
      return;
    }

    setActiveFrom(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
    );
    setDaysOfWeek([]);
  }, [recurrence, timeZone]);

  const versions = useMemo(
    () => (playlistId ? getVersions(playlistId) : []),
    [getVersions, playlistId],
  );

  const toggleDay = (day: number) => {
    setDaysOfWeek((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
    );
  };

  const handleSave = async () => {
    if (!timeZone) {
      setError('Station timezone is not configured.');
      return;
    }

    if (!playlistId || !versionId) {
      setError('Select a playlist and an immutable published version.');
      return;
    }

    if (!title.trim()) {
      setError('Program title is required.');
      return;
    }

    if (frequency === 'weekly' && daysOfWeek.length === 0) {
      setError('Select at least one weekday for weekly recurrence.');
      return;
    }

    try {
      const input = {
        title: title.trim(),
        source: {
          type: 'playlist' as const,
          playlistId,
          playlistVersionId: versionId,
        },
        timezone: timeZone,
        frequency,
        localStartTime: startTime,
        durationMs: Math.round(durationMinutes * 60_000),
        daysOfWeek: frequency === 'weekly' ? daysOfWeek : undefined,
        activeFromLocalDate: activeFrom,
        activeUntilLocalDate: activeUntil || undefined,
      };

      setSaving(true);
      setError(null);

      if (mode === 'create') {
        await createRecurrence(input);
      } else if (recurrence) {
        await updateRecurrence(recurrence.recurrenceId, input);
      }

      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save recurrence.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={mode === 'create' ? 'New Recurring Program' : 'Edit Recurring Program'}
      onClose={onClose}
      wide
    >
      <div className="recurrence-editor">
        <label className="form-field">
          Program title
          <input
            type="text"
            value={title}
            onChange={(changeEvent) => setTitle(changeEvent.target.value)}
            placeholder="Request Show"
          />
        </label>

        <label className="form-field">
          Frequency
          <select
            value={frequency}
            onChange={(changeEvent) => setFrequency(changeEvent.target.value as 'daily' | 'weekly')}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>

        {frequency === 'weekly' && (
          <div className="form-field">
            Weekdays
            <div className="recurrence-editor__days">
              {DAY_OPTIONS.map((day) => (
                <button
                  className={`recurrence-editor__day${daysOfWeek.includes(day.value) ? ' recurrence-editor__day--active' : ''}`}
                  type="button"
                  key={day.value}
                  onClick={() => toggleDay(day.value)}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="schedule-editor__time-row">
          <label className="form-field">
            Local start time ({timeZone || 'station timezone'})
            <input
              type="time"
              value={startTime}
              onChange={(changeEvent) => setStartTime(changeEvent.target.value)}
            />
          </label>
          <label className="form-field">
            Duration (minutes)
            <input
              type="number"
              min={1}
              step={1}
              value={durationMinutes}
              onChange={(changeEvent) => setDurationMinutes(Number(changeEvent.target.value))}
            />
          </label>
        </div>

        <div className="schedule-editor__time-row">
          <label className="form-field">
            Active from
            <input
              type="date"
              value={activeFrom}
              onChange={(changeEvent) => setActiveFrom(changeEvent.target.value)}
            />
          </label>
          <label className="form-field">
            Active until (optional)
            <input
              type="date"
              value={activeUntil}
              onChange={(changeEvent) => setActiveUntil(changeEvent.target.value)}
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

        <p className="recurrence-editor__hint">
          The next 8 weeks are compiled into concrete UTC schedule events. Runtime never evaluates
          recurrence rules.
        </p>

        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
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
            {saving ? 'Compiling…' : mode === 'create' ? 'Create Recurrence' : 'Save Recurrence'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
