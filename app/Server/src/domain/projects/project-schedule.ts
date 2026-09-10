import { InvariantViolatedError } from '../errors/domain-error.js';

export interface ProjectSchedule {
  readonly startsOn?: string | null;
  readonly shipsOn?: string | null;
}

/**
 * Rejects a project that ships before it starts.
 *
 * Dates are compared as strings, which is exact for `YYYY-MM-DD`: the format is
 * fixed-width and its lexical order is its chronological order. Parsing them
 * into Dates would introduce a timezone for no gain.
 */
export function assertProjectScheduleIsOrdered(schedule: ProjectSchedule): void {
  const { startsOn, shipsOn } = schedule;

  if (startsOn == null || shipsOn == null) {
    return;
  }

  if (shipsOn < startsOn) {
    throw new InvariantViolatedError('A project cannot ship before it starts.', {
      shipsOn: 'This is before the start date.',
    });
  }
}
