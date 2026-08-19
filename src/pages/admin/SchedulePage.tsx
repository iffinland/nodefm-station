/* ============================================================
 * NodeFM Station — Schedule Page (Admin)
 *
 * Week view, agenda view, and recurring-program authoring for
 * the scheduler. All visible events come from one canonical
 * account-scoped schedule store.
 * ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { useStation } from '../../features/station';
import { usePlaylists } from '../../hooks/usePlaylists';
import { useScheduler } from '../../features/scheduling/hooks/useScheduler';
import { ScheduleWeekView } from '../../features/scheduling/components/ScheduleWeekView';
import { ScheduleAgendaView } from '../../features/scheduling/components/ScheduleAgendaView';
import { ScheduleEventEditorModal } from '../../features/scheduling/components/ScheduleEventEditorModal';
import { RecurrenceEditorModal } from '../../features/scheduling/components/RecurrenceEditorModal';
import {
  addDaysToLocalDate,
  formatZonedDateInput,
  isValidIanaTimeZone,
} from '../../features/scheduling/services/timezone';
import { validateScheduleSet } from '../../features/scheduling/services/scheduleService';
import type { ScheduleEvent, ScheduleRecurrence } from '../../types/domain';

type ViewMode = 'week' | 'agenda' | 'recurring';

type ScheduleModalState =
  | {
      kind: 'create-event';
      date: string;
      startTime: string;
      endTime: string;
    }
  | { kind: 'edit-event'; event: ScheduleEvent }
  | { kind: 'create-recurrence' }
  | { kind: 'edit-recurrence'; recurrence: ScheduleRecurrence }
  | null;

function endTimeAfterHour(hour: number): string {
  if (hour === 23) {
    return '23:59';
  }

  return `${String(hour + 1).padStart(2, '0')}:00`;
}

export default function SchedulePage() {
  const {
    station,
    loaded: stationLoaded,
    loading: stationLoading,
    error: stationError,
  } = useStation();
  const {
    loaded: schedulesLoaded,
    loading: schedulesLoading,
    error: schedulesError,
    events,
    recurrences,
    getRecurrence,
    updateEvent,
    deleteRecurrence,
    refresh: refreshSchedules,
  } = useScheduler();
  const {
    loaded: playlistsLoaded,
    loading: playlistsLoading,
    error: playlistsError,
    playlists,
  } = usePlaylists();

  const timeZone = station?.timezone ?? '';
  const timeZoneIsValid = isValidIanaTimeZone(timeZone);
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [selectedDate, setSelectedDate] = useState('');
  const [modal, setModal] = useState<ScheduleModalState>(null);

  useEffect(() => {
    if (timeZoneIsValid && timeZone && !selectedDate) {
      setSelectedDate(formatZonedDateInput(Date.now(), timeZone));
    }
  }, [selectedDate, timeZone, timeZoneIsValid]);

  const nowUtcMs = Date.now();
  const canAuthor = timeZoneIsValid && playlists.length > 0;
  const hasPlayablePlaylist = playlists.some((playlist) => playlist.latestVersionId);

  const recurrenceById = useMemo(() => {
    const map = new Map<string, ScheduleRecurrence>();
    for (const recurrence of recurrences) {
      map.set(recurrence.recurrenceId, recurrence);
    }
    return map;
  }, [recurrences]);

  const scheduleValidation = useMemo(() => validateScheduleSet(events), [events]);

  const handleEventClick = (event: ScheduleEvent) => {
    if (event.recurrenceId) {
      const recurrence =
        recurrenceById.get(event.recurrenceId) ?? getRecurrence(event.recurrenceId);
      if (recurrence) {
        setModal({ kind: 'edit-recurrence', recurrence });
        return;
      }
    }

    setModal({ kind: 'edit-event', event });
  };

  const handleDeleteRecurrence = async (recurrenceId: string) => {
    if (!window.confirm('Delete this recurring program and its future generated events?')) {
      return;
    }

    try {
      await deleteRecurrence(recurrenceId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to delete recurrence.');
    }
  };

  const handleEventMove = async (event: ScheduleEvent, newStartUtcMs: number) => {
    const duration = Date.parse(event.endUtc) - Date.parse(event.startUtc);

    try {
      await updateEvent(event.eventId, {
        startUtc: new Date(newStartUtcMs).toISOString(),
        endUtc: new Date(newStartUtcMs + duration).toISOString(),
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to move schedule event.');
    }
  };

  const handleEventResize = async (event: ScheduleEvent, newEndUtcMs: number) => {
    try {
      await updateEvent(event.eventId, {
        endUtc: new Date(newEndUtcMs).toISOString(),
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to resize schedule event.');
    }
  };

  if (stationLoading || schedulesLoading || playlistsLoading) {
    return (
      <PageShell title="Schedule">
        <LoadingState message="Loading schedule…" />
      </PageShell>
    );
  }

  if (stationError && !stationLoaded) {
    return (
      <PageShell title="Schedule">
        <ErrorState message="Failed to load station configuration." detail={stationError} />
      </PageShell>
    );
  }

  if (schedulesError && !schedulesLoaded) {
    return (
      <PageShell title="Schedule">
        <ErrorState
          message="Failed to load schedule."
          detail={schedulesError}
          onRetry={refreshSchedules}
        />
      </PageShell>
    );
  }

  if (playlistsError && !playlistsLoaded) {
    return (
      <PageShell title="Schedule">
        <ErrorState message="Failed to load playlists." detail={playlistsError} />
      </PageShell>
    );
  }

  if (!timeZoneIsValid) {
    return (
      <PageShell title="Schedule">
        <ErrorState
          message="Station timezone is not valid."
          detail="Set a valid IANA timezone (for example Europe/Helsinki) in Station settings before scheduling."
        />
      </PageShell>
    );
  }

  return (
    <PageShell title="Schedule">
      <div className="admin-schedule">
        <div className="admin-schedule__toolbar">
          <div className="admin-schedule__tabs">
            <button
              className={`button ${viewMode === 'week' ? 'button--primary' : 'button--secondary'}`}
              type="button"
              onClick={() => setViewMode('week')}
            >
              Week
            </button>
            <button
              className={`button ${viewMode === 'agenda' ? 'button--primary' : 'button--secondary'}`}
              type="button"
              onClick={() => setViewMode('agenda')}
            >
              Agenda
            </button>
            <button
              className={`button ${viewMode === 'recurring' ? 'button--primary' : 'button--secondary'}`}
              type="button"
              onClick={() => setViewMode('recurring')}
            >
              Recurring
            </button>
          </div>

          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              if (timeZoneIsValid) {
                setModal({
                  kind: 'create-event',
                  date: selectedDate || formatZonedDateInput(Date.now(), timeZone),
                  startTime: '12:00',
                  endTime: '13:00',
                });
              }
            }}
            disabled={!canAuthor || !hasPlayablePlaylist}
          >
            New Program
          </button>
        </div>

        {!hasPlayablePlaylist && playlistsLoaded && (
          <p className="admin-schedule__hint">
            Publish at least one playlist version before scheduling a program.
          </p>
        )}

        {scheduleValidation.conflicts.length > 0 && (
          <p className="form-error">
            Canonical schedule contains {scheduleValidation.conflicts.length} overlap
            {scheduleValidation.conflicts.length === 1 ? '' : 's'}. Review and edit the conflicting
            events.
          </p>
        )}

        {viewMode === 'recurring' ? (
          <section className="recurrence-list">
            <div className="recurrence-list__toolbar">
              <button
                className="button button--primary"
                type="button"
                onClick={() => setModal({ kind: 'create-recurrence' })}
                disabled={!canAuthor || !hasPlayablePlaylist}
              >
                New Recurrence
              </button>
            </div>
            {recurrences.length === 0 ? (
              <p className="schedule-agenda__empty">No recurring programs configured.</p>
            ) : (
              <div className="recurrence-list__cards">
                {recurrences.map((recurrence) => (
                  <div className="recurrence-card" key={recurrence.recurrenceId}>
                    <div className="recurrence-card__info">
                      <strong>{recurrence.title}</strong>
                      <span>
                        {recurrence.frequency === 'daily'
                          ? 'Daily'
                          : `Weekly ${(recurrence.daysOfWeek ?? []).join(', ')}`}{' '}
                        at {recurrence.localStartTime} ({recurrence.timezone})
                      </span>
                      <span>
                        From {recurrence.activeFromLocalDate}
                        {recurrence.activeUntilLocalDate
                          ? ` until ${recurrence.activeUntilLocalDate}`
                          : ''}
                      </span>
                    </div>
                    <div className="recurrence-card__actions">
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => setModal({ kind: 'edit-recurrence', recurrence })}
                      >
                        Edit
                      </button>
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() => handleDeleteRecurrence(recurrence.recurrenceId)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            <div className="admin-schedule__week-nav">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setSelectedDate((date) => addDaysToLocalDate(date, -7))}
              >
                Previous
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  if (timeZoneIsValid) setSelectedDate(formatZonedDateInput(Date.now(), timeZone));
                }}
              >
                Today
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setSelectedDate((date) => addDaysToLocalDate(date, 7))}
              >
                Next
              </button>
              <span className="admin-schedule__timezone">Timezone: {timeZone || 'not set'}</span>
            </div>

            {viewMode === 'week' ? (
              <ScheduleWeekView
                events={events}
                timeZone={timeZone}
                selectedDate={selectedDate || formatZonedDateInput(Date.now(), timeZone)}
                nowUtcMs={nowUtcMs}
                onSlotClick={(date, hour) =>
                  setModal({
                    kind: 'create-event',
                    date,
                    startTime: `${String(hour).padStart(2, '0')}:00`,
                    endTime: endTimeAfterHour(hour),
                  })
                }
                onEventClick={handleEventClick}
                onEventMove={handleEventMove}
                onEventResize={handleEventResize}
              />
            ) : (
              <ScheduleAgendaView
                events={events}
                timeZone={timeZone}
                onEventClick={handleEventClick}
              />
            )}
          </>
        )}
      </div>

      {modal?.kind === 'create-event' && (
        <ScheduleEventEditorModal
          mode="create"
          initialDate={modal.date}
          initialStartTime={modal.startTime}
          initialEndTime={modal.endTime}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'edit-event' && (
        <ScheduleEventEditorModal mode="edit" event={modal.event} onClose={() => setModal(null)} />
      )}

      {modal?.kind === 'create-recurrence' && (
        <RecurrenceEditorModal mode="create" onClose={() => setModal(null)} />
      )}

      {modal?.kind === 'edit-recurrence' && (
        <RecurrenceEditorModal
          mode="edit"
          recurrence={modal.recurrence}
          onClose={() => setModal(null)}
        />
      )}
    </PageShell>
  );
}
