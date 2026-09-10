import { DATE_LOCALE } from '../../lib/display-locale.js';

/**
 * How a card's date is written in the space a card has for it.
 *
 * The board shows short forms — `Aug 24` — because a card is scanned, not read.
 * Today is the exception: it is the one date somebody needs to see rather than
 * work out, so it says so in words.
 */
export function formatShortDate(calendarDate: string, today: Date = new Date()): string {
  if (calendarDate === toCalendarDay(today)) {
    return 'today';
  }

  const day = parseCalendarDate(calendarDate);

  if (day === null) {
    return calendarDate;
  }

  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(day);
}

/** Whether a due date has already gone by. Today is not yet overdue. */
export function isOverdue(calendarDate: string, today: Date = new Date()): boolean {
  // Both sides are fixed-width `YYYY-MM-DD`, so comparing them as strings is
  // exact and needs no timezone.
  return calendarDate < toCalendarDay(today);
}

/** The day an instant falls on, in UTC, as `YYYY-MM-DD`. */
function toCalendarDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

function parseCalendarDate(calendarDate: string): Date | null {
  const [year, month, day] = calendarDate.split('-').map(Number);

  if (year === undefined || month === undefined || day === undefined || Number.isNaN(year)) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
}
