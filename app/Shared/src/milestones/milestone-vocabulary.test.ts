import { describe, expect, it } from 'vitest';

import { daysUntil, describeMilestoneState, readMilestoneState } from './milestone-vocabulary.js';

const MILESTONE = { startsOn: '2026-08-24', shipsOn: '2026-09-06' };

describe('GIVEN a milestone with two dates', () => {
  describe('WHEN it is asked where it stands', () => {
    it('THEN it is planned before it starts', () => {
      expect(readMilestoneState(MILESTONE, '2026-08-23')).toBe('planned');
    });

    it('THEN it is active on the day it starts', () => {
      expect(readMilestoneState(MILESTONE, '2026-08-24')).toBe('active');
    });

    it('THEN it is still active on the day it ships', () => {
      // The day something is due is a day people are working on it.
      expect(readMilestoneState(MILESTONE, '2026-09-06')).toBe('active');
    });

    it('THEN it has shipped the day after', () => {
      expect(readMilestoneState(MILESTONE, '2026-09-07')).toBe('shipped');
    });

    it('THEN a one-day milestone is active on its one day', () => {
      expect(
        readMilestoneState({ startsOn: '2026-08-24', shipsOn: '2026-08-24' }, '2026-08-24'),
      ).toBe('active');
    });
  });

  describe('WHEN the state is written out', () => {
    it('THEN each one has a word somebody would say', () => {
      expect(describeMilestoneState('planned')).toBe('Planned');
      expect(describeMilestoneState('active')).toBe('Active');
      expect(describeMilestoneState('shipped')).toBe('Shipped');
    });
  });
});

describe('GIVEN a date to count towards', () => {
  describe('WHEN the days are counted', () => {
    it('THEN a date ahead is a positive number of days', () => {
      expect(daysUntil('2026-09-06', '2026-08-24')).toBe(13);
    });

    it('THEN today is nought, not one', () => {
      expect(daysUntil('2026-08-24', '2026-08-24')).toBe(0);
    });

    it('THEN a date gone by is negative, which is how days left become days over', () => {
      expect(daysUntil('2026-08-24', '2026-09-02')).toBe(-9);
    });

    it('THEN a month end is not a special case', () => {
      expect(daysUntil('2026-09-02', '2026-08-30')).toBe(3);
    });

    it('THEN the clocks changing does not lose a day', () => {
      // Australia moves its clocks on the first Sunday in October. Measured
      // locally this would be three days and an hour.
      expect(daysUntil('2026-10-06', '2026-10-03')).toBe(3);
    });
  });
});
