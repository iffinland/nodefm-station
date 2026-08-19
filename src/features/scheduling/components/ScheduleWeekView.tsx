/* ============================================================
 * NodeFM Station — Schedule Week View
 *
 * Seven-day local wall-clock calendar fed by canonical UTC
 * ScheduleEvent records. This component does not own schedule
 * state; it only renders events and reports interactions.
 * ============================================================ */

import { useMemo, useState } from 'react';
import type { ScheduleEvent } from '../../../types/domain';
import {
  addDaysToLocalDate,
  formatZonedDateInput,
  getLocalDayBoundsUtcMs,
  getZonedWallTime,
  parseLocalDateInput,
  requireUnambiguousZonedUtcMs,
} from '../services/timezone';

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Segment = {
  event: ScheduleEvent;
  day: string;
  topPercent: number;
  heightPercent: number;
  startLabel: string;
  endLabel: string;
};

function minutesIntoLocalDay(utcMs: number, timeZone: string): number {
  const wall = getZonedWallTime(utcMs, timeZone);
  return wall.hour * 60 + wall.minute;
}

function formatHourMinute(utcMs: number, timeZone: string): string {
  const wall = getZonedWallTime(utcMs, timeZone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

export type ScheduleWeekViewProps = {
  events: ScheduleEvent[];
  timeZone: string;
  selectedDate: string;
  nowUtcMs: number;
  onSlotClick: (date: string, startHour: number) => void;
  onEventClick: (event: ScheduleEvent) => void;
  onEventMove: (event: ScheduleEvent, newStartUtcMs: number) => void;
  onEventResize: (event: ScheduleEvent, newEndUtcMs: number) => void;
};

type DragState =
  { mode: 'move'; event: ScheduleEvent } | { mode: 'resize'; event: ScheduleEvent } | null;

function getMondayDate(dateString: string): string {
  const { year, month, day } = parseLocalDateInput(dateString);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = (weekday + 6) % 7;
  return addDaysToLocalDate(dateString, -mondayOffset);
}

function buildSegments(event: ScheduleEvent, weekDays: string[], timeZone: string): Segment[] {
  const startMs = Date.parse(event.startUtc);
  const endMs = Date.parse(event.endUtc);
  const segments: Segment[] = [];

  for (const day of weekDays) {
    const bounds = getLocalDayBoundsUtcMs(day, timeZone);
    const segmentStart = Math.max(startMs, bounds.startUtcMs);
    const segmentEnd = Math.min(endMs, bounds.endUtcMs);

    if (segmentStart >= segmentEnd) {
      continue;
    }

    const startMinutes = minutesIntoLocalDay(segmentStart, timeZone);
    const endMinutes = minutesIntoLocalDay(segmentEnd, timeZone);

    segments.push({
      event,
      day,
      topPercent: (startMinutes / (24 * 60)) * 100,
      heightPercent: Math.max(((endMinutes - startMinutes) / (24 * 60)) * 100, 0.7),
      startLabel: formatHourMinute(segmentStart, timeZone),
      endLabel: formatHourMinute(segmentEnd, timeZone),
    });
  }

  return segments;
}

export function ScheduleWeekView({
  events,
  timeZone,
  selectedDate,
  nowUtcMs,
  onSlotClick,
  onEventClick,
  onEventMove,
  onEventResize,
}: ScheduleWeekViewProps) {
  const [dragState, setDragState] = useState<DragState>(null);
  const weekDays = useMemo(() => {
    const monday = getMondayDate(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDaysToLocalDate(monday, index));
  }, [selectedDate]);

  const segmentsByDay = useMemo(() => {
    const byDay = new Map<string, Segment[]>();

    for (const day of weekDays) {
      byDay.set(day, []);
    }

    for (const event of events) {
      for (const segment of buildSegments(event, weekDays, timeZone)) {
        byDay.get(segment.day)?.push(segment);
      }
    }

    return byDay;
  }, [events, timeZone, weekDays]);

  const today = formatZonedDateInput(nowUtcMs, timeZone);

  const handleDropOnDay = (day: string, clientY: number, columnElement: HTMLElement) => {
    if (!dragState) {
      return;
    }

    const rect = columnElement.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const rawMinutes = (y / rect.height) * 24 * 60;
    const snappedMinutes = Math.max(0, Math.min(24 * 60 - 1, Math.round(rawMinutes / 15) * 15));
    const hour = Math.floor(snappedMinutes / 60);
    const minute = snappedMinutes % 60;

    try {
      const { year, month, day: dayNumber } = parseLocalDateInput(day);
      const targetMs = requireUnambiguousZonedUtcMs(
        { year, month, day: dayNumber, hour, minute },
        timeZone,
      );

      if (dragState.mode === 'move') {
        onEventMove(dragState.event, targetMs);
      } else {
        const start = Date.parse(dragState.event.startUtc);
        if (targetMs > start) {
          onEventResize(dragState.event, targetMs);
        }
      }
    } catch (error) {
      // Ambiguous/nonexistent drop times are surfaced by the page handler
      // or by this explicit local-time diagnostic.
      window.alert(error instanceof Error ? error.message : 'Invalid local drop time.');
    }
  };

  return (
    <div className="schedule-week">
      <div className="schedule-week__grid">
        <div className="schedule-week__corner" />
        {weekDays.map((day) => (
          <div
            className={`schedule-week__day-header${day === today ? ' schedule-week__day-header--today' : ''}`}
            key={day}
          >
            <strong>{WEEKDAY_LABELS[weekDays.indexOf(day)]}</strong>
            <span>{day.slice(5)}</span>
          </div>
        ))}

        <div className="schedule-week__time-axis">
          {HOURS.map((hour) => (
            <div className="schedule-week__hour" key={hour}>
              {String(hour).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {weekDays.map((day) => (
          <div
            className="schedule-week__day-column"
            key={day}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDropOnDay(day, event.clientY, event.currentTarget)}
          >
            {HOURS.map((hour) => (
              <button
                className="schedule-week__slot"
                type="button"
                key={hour}
                onClick={() => onSlotClick(day, hour)}
                aria-label={`Create event on ${day} at ${String(hour).padStart(2, '0')}:00`}
              >
                <span className="sr-only">{hour}</span>
              </button>
            ))}
            {segmentsByDay.get(day)?.map((segment) => (
              <div
                className={`schedule-event-block${segment.event.recurrenceId ? ' schedule-event-block--recurring' : ''}`}
                key={`${segment.day}-${segment.event.eventId}-${segment.startLabel}`}
                style={{
                  top: `${segment.topPercent}%`,
                  height: `${segment.heightPercent}%`,
                }}
                role="button"
                tabIndex={0}
                draggable
                onClick={() => onEventClick(segment.event)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    onEventClick(segment.event);
                  }
                }}
                onDragStart={(event) => {
                  setDragState({ mode: 'move', event: segment.event });
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragState(null)}
                title={`${segment.event.title ?? 'Untitled program'} ${segment.startLabel}–${segment.endLabel}`}
              >
                <span className="schedule-event-block__time">
                  {segment.startLabel}–{segment.endLabel}
                </span>
                <span className="schedule-event-block__title">
                  {segment.event.title ?? 'Untitled program'}
                </span>
                <span
                  className="schedule-event-block__resize"
                  draggable
                  role="button"
                  tabIndex={-1}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    setDragState({ mode: 'resize', event: segment.event });
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={(event) => {
                    event.stopPropagation();
                    setDragState(null);
                  }}
                  title="Resize"
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
