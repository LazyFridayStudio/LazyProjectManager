/**
 * Estimates, read and written the way people say them.
 *
 * `2d 4h`, `3h`, `45m`, or a bare number meaning hours. Carried as minutes,
 * because every arithmetic on an estimate — a list's total, a burndown — is
 * addition, and adding `2d 4h` to `90m` in any other unit is a bug waiting.
 *
 * Shared rather than server-side: the field parses as it is typed, and the
 * command carries the minutes it produced. Both sides have to agree on what
 * `2d` means.
 */

/**
 * A day is eight hours, not twenty-four.
 *
 * An estimate is working time. "Two days" from somebody planning a milestone
 * means two days of work, and reading it as forty-eight hours would triple every
 * number on the board.
 */
export const MINUTES_PER_WORKING_DAY = 8 * 60;

const MINUTES_PER_HOUR = 60;

/** Nothing anybody would estimate is longer than this, and it catches a typo. */
export const MAXIMUM_ESTIMATE_MINUTES = 100 * MINUTES_PER_WORKING_DAY;

const DAYS = /(\d+(?:\.\d+)?)\s*d/;
const HOURS = /(\d+(?:\.\d+)?)\s*h/;
const MINUTES = /(\d+(?:\.\d+)?)\s*m/;

/**
 * The result of reading what somebody typed.
 *
 * A result rather than an exception, because both sides need to handle a bad
 * estimate and only one of them has a domain error class to throw.
 */
export type ParsedDuration =
  /** `minutes` is null for an empty field, which is "no estimate" rather than zero. */
  | { readonly ok: true; readonly minutes: number | null }
  | { readonly ok: false; readonly reason: string };

/**
 * Reads a duration a person typed.
 *
 * An empty field is no estimate — a card nobody has estimated and a card
 * estimated at nothing are different things. Anything unreadable is refused
 * rather than quietly treated as empty, because silently dropping `tomorrow`
 * loses what somebody meant to say.
 */
export function parseDuration(input: string): ParsedDuration {
  const text = input.trim().toLowerCase();

  if (text === '') {
    return { ok: true, minutes: null };
  }

  const days = readUnit(text, DAYS);
  const hours = readUnit(text, HOURS);
  const minutes = readUnit(text, MINUTES);

  const total =
    days === null && hours === null && minutes === null
      ? readBareHours(text)
      : (days ?? 0) * MINUTES_PER_WORKING_DAY + (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0);

  if (total === null) {
    return { ok: false, reason: 'Try 2d 4h, 3h or 45m.' };
  }

  if (total > MAXIMUM_ESTIMATE_MINUTES) {
    return { ok: false, reason: 'That is too long to be an estimate.' };
  }

  return { ok: true, minutes: Math.round(total) };
}

/**
 * Writes a duration back the way it would be said: `2h 30m`, `3h`, `45m`.
 *
 * Never in days, even though it reads them. A card saying `1d 2h` and a card
 * saying `10h` are the same card, and one of those is easier to compare against
 * the one next to it.
 */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const wholeHours = Math.floor(total / MINUTES_PER_HOUR);
  const remainder = total % MINUTES_PER_HOUR;

  if (wholeHours > 0 && remainder > 0) {
    return `${String(wholeHours)}h ${String(remainder)}m`;
  }

  return wholeHours > 0 ? `${String(wholeHours)}h` : `${String(remainder)}m`;
}

function readUnit(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);

  return match?.[1] === undefined ? null : Number(match[1]);
}

/** A bare number means hours, which is how most people write a short estimate. */
function readBareHours(text: string): number | null {
  const hours = Number(text);

  return Number.isFinite(hours) && hours >= 0 ? hours * MINUTES_PER_HOUR : null;
}
