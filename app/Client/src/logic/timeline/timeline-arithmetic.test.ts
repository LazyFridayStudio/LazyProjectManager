import { describe, expect, it } from 'vitest';

import { addDays, describeLoad, formatHours } from './timeline-arithmetic.js';

describe('GIVEN a day with hours on it', () => {
  describe('WHEN the day is read for trouble', () => {
    it('THEN an empty day is idle rather than comfortable', () => {
      // Nought and four hours out of eight are different states, and colouring
      // both green loses the one a producer is looking for.
      expect(describeLoad(0, 8)).toBe('idle');
    });

    it('THEN a day with room is within capacity', () => {
      expect(describeLoad(4, 8)).toBe('within');
    });

    it('THEN a day nearly full says so before it overflows', () => {
      // Seven of eight. One interruption from being over, which is worth
      // knowing the day before rather than the day it slips.
      expect(describeLoad(7, 8)).toBe('near');
    });

    it('THEN a full day is near rather than over, because it still fits', () => {
      expect(describeLoad(8, 8)).toBe('near');
    });

    it('THEN an hour past the day is over', () => {
      expect(describeLoad(8.5, 8)).toBe('over');
    });
  });

  describe('WHEN the person has no capacity at all', () => {
    it('THEN work assigned to them is over, not fine', () => {
      // A bot or somebody on leave. Hours here are hours in time nobody has.
      expect(describeLoad(3, 0)).toBe('over');
    });

    it('THEN no work is still idle', () => {
      expect(describeLoad(0, 0)).toBe('idle');
    });
  });
});

describe('GIVEN a number of hours to print in a grid column', () => {
  describe('WHEN it is written out', () => {
    it('THEN a whole number spends no characters on a decimal', () => {
      expect(formatHours(8)).toBe('8h');
    });

    it('THEN a part hour keeps one place', () => {
      expect(formatHours(2.5)).toBe('2.5h');
    });

    it('THEN a third of an hour does not print its whole binary expansion', () => {
      expect(formatHours(1 / 3)).toBe('0.3h');
    });
  });
});

describe('GIVEN the fortnight buttons', () => {
  describe('WHEN the window is moved', () => {
    it('THEN it steps a fortnight forward across a month end', () => {
      expect(addDays('2026-08-24', 14)).toBe('2026-09-07');
    });

    it('THEN it steps back the same distance it stepped forward', () => {
      expect(addDays(addDays('2026-08-24', 14), -14)).toBe('2026-08-24');
    });

    it('THEN the clocks changing does not lose a day', () => {
      // Australia moves its clocks on the first Sunday in October. In local
      // time this fortnight would be a fortnight and an hour.
      expect(addDays('2026-09-28', 14)).toBe('2026-10-12');
    });
  });
});
