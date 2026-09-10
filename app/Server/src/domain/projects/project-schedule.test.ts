import { describe, expect, it } from 'vitest';

import { InvariantViolatedError } from '../errors/domain-error.js';
import { assertProjectScheduleIsOrdered } from './project-schedule.js';

describe('GIVEN a project schedule being checked', () => {
  describe('WHEN it ships after it starts', () => {
    it('THEN it is accepted', () => {
      expect(() => {
        assertProjectScheduleIsOrdered({ startsOn: '2026-01-05', shipsOn: '2026-11-30' });
      }).not.toThrow();
    });
  });

  describe('WHEN it ships on the day it starts', () => {
    it('THEN it is accepted, because a one-day project is not a contradiction', () => {
      expect(() => {
        assertProjectScheduleIsOrdered({ startsOn: '2026-01-05', shipsOn: '2026-01-05' });
      }).not.toThrow();
    });
  });

  describe('WHEN only one of the two dates is known', () => {
    it('THEN it is accepted, since there is nothing to compare it against', () => {
      expect(() => {
        assertProjectScheduleIsOrdered({ startsOn: '2026-01-05' });
      }).not.toThrow();
      expect(() => {
        assertProjectScheduleIsOrdered({ shipsOn: '2026-01-05' });
      }).not.toThrow();
      expect(() => {
        assertProjectScheduleIsOrdered({ startsOn: null, shipsOn: null });
      }).not.toThrow();
      expect(() => {
        assertProjectScheduleIsOrdered({});
      }).not.toThrow();
    });
  });

  describe('WHEN it ships before it starts', () => {
    it('THEN it is refused, naming the field the form should highlight', () => {
      let thrown: unknown;

      try {
        assertProjectScheduleIsOrdered({ startsOn: '2026-11-30', shipsOn: '2026-01-05' });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(InvariantViolatedError);
      expect(thrown).toMatchObject({
        code: 'INVARIANT_VIOLATED',
        fields: { shipsOn: expect.any(String) as unknown },
      });
    });

    it('THEN the comparison holds across a year boundary', () => {
      // Dates are compared as strings. That is only correct because the format
      // is fixed-width, so this is the case worth pinning down.
      expect(() => {
        assertProjectScheduleIsOrdered({ startsOn: '2027-01-01', shipsOn: '2026-12-31' });
      }).toThrow(InvariantViolatedError);
    });
  });
});
