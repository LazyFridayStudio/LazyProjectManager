import { describe, expect, it } from 'vitest';

import { formatShortDate, isOverdue } from './format-card-values.js';

const TODAY = new Date('2026-08-18T09:30:00.000Z');

describe('GIVEN a due date in the space a card has for one', () => {
  describe('WHEN it is some other day', () => {
    it('THEN it reads as a short day and month', () => {
      expect(formatShortDate('2026-08-24', TODAY)).toBe('24 Aug');
      expect(formatShortDate('2026-09-02', TODAY)).toBe('2 Sept');
    });

    it('THEN the year is left off, because a card is scanned rather than read', () => {
      expect(formatShortDate('2027-01-05', TODAY)).not.toContain('2027');
    });
  });

  describe('WHEN it is today', () => {
    it('THEN it says so in words, which is the one date worth not working out', () => {
      expect(formatShortDate('2026-08-18', TODAY)).toBe('today');
    });

    it('THEN the time of day does not move it', () => {
      // A card due today must read "today" at 9am and at 11pm alike.
      expect(formatShortDate('2026-08-18', new Date('2026-08-18T23:59:00.000Z'))).toBe('today');
    });
  });

  describe('WHEN it is not a date at all', () => {
    it('THEN it is passed through rather than rendered as Invalid Date', () => {
      expect(formatShortDate('soon', TODAY)).toBe('soon');
    });
  });
});

describe('GIVEN a due date being checked against today', () => {
  describe('WHEN it has already gone by', () => {
    it('THEN it is overdue', () => {
      expect(isOverdue('2026-08-17', TODAY)).toBe(true);
      expect(isOverdue('2025-12-31', TODAY)).toBe(true);
    });
  });

  describe('WHEN it is today or later', () => {
    it('THEN it is not overdue, because a card due today still has the day', () => {
      expect(isOverdue('2026-08-18', TODAY)).toBe(false);
      expect(isOverdue('2026-08-19', TODAY)).toBe(false);
    });
  });

  describe('WHEN the dates straddle a year boundary', () => {
    it('THEN the comparison still holds', () => {
      // Compared as strings, which is exact only because the format is
      // fixed-width. This is the case worth pinning down.
      expect(isOverdue('2025-12-31', new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
      expect(isOverdue('2026-01-01', new Date('2025-12-31T00:00:00.000Z'))).toBe(false);
    });
  });
});
