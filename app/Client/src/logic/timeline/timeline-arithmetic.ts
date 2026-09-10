/**
 * How full a day is, in the three words the design colours it by.
 *
 * Near rather than a second shade of fine: a day at nine tenths is one
 * interruption away from being over, and a producer who can only see green and
 * red finds out on the day it slips.
 */
export function describeLoad(hours: number, capacity: number): 'idle' | 'within' | 'near' | 'over' {
  if (hours === 0) return 'idle';

  // Any hours at all against no capacity is over: somebody has been given work
  // in time they do not have, which is the whole point of saying they have none.
  if (capacity === 0) return 'over';

  const NEAR_ENOUGH = 0.85;

  if (hours > capacity) return 'over';

  return hours >= capacity * NEAR_ENOUGH ? 'near' : 'within';
}

/**
 * Hours as somebody would say them.
 *
 * Whole hours have no decimal, because `8.0h` in a grid of fourteen columns is
 * two characters spent saying nothing.
 */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;

  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}h`;
}

/** The calendar date `offset` days from `from`, which is the fortnight buttons. */
export function addDays(from: string, offset: number): string {
  const MILLISECONDS_PER_DAY = 86_400_000;
  // Parsed as UTC on purpose: in local time a fortnight across a daylight saving
  // change is a fortnight and an hour, and lands on the wrong day.
  const moved = new Date(Date.parse(`${from}T00:00:00Z`) + offset * MILLISECONDS_PER_DAY);

  return moved.toISOString().slice(0, 10);
}
