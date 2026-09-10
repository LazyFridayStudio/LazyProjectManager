import { DATE_LOCALE, MONEY_LOCALE } from '../../lib/display-locale.js';

const MINOR_UNITS_PER_MAJOR = 100;

/** Budgets are read at a glance and compared; cents are noise at that size. */
export function formatMoney(minorUnits: number | null, currency: string): string {
  if (minorUnits === null) {
    return 'No budget set';
  }

  return new Intl.NumberFormat(MONEY_LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minorUnits / MINOR_UNITS_PER_MAJOR);
}

/**
 * Whole dollars typed into a form, as the minor units a command carries.
 *
 * An empty field is "no budget" rather than zero: a project with a budget of
 * nothing and a project nobody has budgeted yet are different things.
 */
export function toMinorUnits(majorUnits: string): number | null {
  const trimmed = majorUnits.trim();

  if (trimmed === '') {
    return null;
  }

  const amount = Number(trimmed);

  return Number.isFinite(amount) ? Math.round(amount * MINOR_UNITS_PER_MAJOR) : null;
}

/** A calendar day as `5 Jan 2026`. Takes the `YYYY-MM-DD` the server sends. */
export function formatCalendarDate(calendarDate: string | null): string {
  if (calendarDate === null) {
    return '—';
  }

  const [year, month, day] = calendarDate.split('-').map(Number);

  if (year === undefined || month === undefined || day === undefined) {
    return calendarDate;
  }

  // Built in UTC and read back in UTC: a date with no time must not be shifted
  // by the reader's offset on the way to being formatted.
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * The day an instant fell on, as `16 Aug 2026`.
 *
 * The reader's own day rather than UTC's. `formatCalendarDate` above takes a
 * date with no time in it, which must not be shifted by anybody's offset; this
 * takes a moment, which must be. Reading one as the other is how an edit made
 * at nine in the evening comes to be dated the day before.
 */
export function formatInstantDate(isoTimestamp: string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(isoTimestamp));
}

const SECONDS_PER = {
  minute: 60,
  hour: 60 * 60,
  day: 60 * 60 * 24,
  week: 60 * 60 * 24 * 7,
  month: 60 * 60 * 24 * 30,
  year: 60 * 60 * 24 * 365,
} as const;

/**
 * How long ago something happened, as `20 minutes ago` or `yesterday`.
 *
 * `numeric: 'auto'` is what turns "1 day ago" into "yesterday", which is how a
 * person would say it.
 */
export function formatTimeAgo(isoTimestamp: string, now: Date = new Date()): string {
  const elapsedSeconds = (now.getTime() - new Date(isoTimestamp).getTime()) / 1000;

  if (elapsedSeconds < SECONDS_PER.minute) {
    return 'just now';
  }

  const formatter = new Intl.RelativeTimeFormat(DATE_LOCALE, { numeric: 'auto' });

  for (const unit of ['year', 'month', 'week', 'day', 'hour', 'minute'] as const) {
    const size = SECONDS_PER[unit];

    if (elapsedSeconds >= size) {
      return formatter.format(-Math.floor(elapsedSeconds / size), unit);
    }
  }

  return 'just now';
}
