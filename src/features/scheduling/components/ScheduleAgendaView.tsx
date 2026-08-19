/* ============================================================
 * NodeFM Station — Schedule Agenda View
 *
 * Chronological list of the same canonical events shown by the
 * week view. No independent schedule state is maintained here.
 * ============================================================ */

import { useMemo } from 'react';
import type { ScheduleEvent } from '../../../types/domain';
import { formatZonedDateInput, formatZonedTimeInput } from '../services/timezone';

export type ScheduleAgendaViewProps = {
  events: ScheduleEvent[];
  timeZone: string;
  onEventClick: (event: ScheduleEvent) => void;
};

export function ScheduleAgendaView({ events, timeZone, onEventClick }: ScheduleAgendaViewProps) {
  const sorted = useMemo(
    () =>
      [...events].sort((left, right) => {
        const startDelta = Date.parse(left.startUtc) - Date.parse(right.startUtc);
        return startDelta !== 0 ? startDelta : Date.parse(left.endUtc) - Date.parse(right.endUtc);
      }),
    [events],
  );

  if (sorted.length === 0) {
    return <p className="schedule-agenda__empty">No scheduled programs in this view.</p>;
  }

  return (
    <ol className="schedule-agenda">
      {sorted.map((event) => (
        <li key={event.eventId}>
          <button
            className="schedule-agenda__item"
            type="button"
            onClick={() => onEventClick(event)}
          >
            <span className="schedule-agenda__date">
              {formatZonedDateInput(Date.parse(event.startUtc), timeZone)}
            </span>
            <span className="schedule-agenda__time">
              {formatZonedTimeInput(Date.parse(event.startUtc), timeZone)}–
              {formatZonedTimeInput(Date.parse(event.endUtc), timeZone)}
            </span>
            <span className="schedule-agenda__title">
              {event.title ?? 'Untitled program'}
              {event.recurrenceId ? ' · recurring' : ''}
            </span>
            <span className="schedule-agenda__source">
              {event.source.type === 'playlist' ? 'Playlist version' : 'Dynamic program'}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
