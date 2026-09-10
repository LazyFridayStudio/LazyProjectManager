import { describe, expect, it } from 'vitest';

import {
  formatCalendarDate,
  formatInstantDate,
  formatMoney,
  formatTimeAgo,
  toMinorUnits,
} from './format-project-values.js';

const NOW = new Date('2026-08-18T12:00:00.000Z');

/** `NOW` minus a number of seconds, as the ISO string a view model carries. */
function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe('GIVEN a budget being written on a tile', () => {
  describe('WHEN the project has one', () => {
    it('THEN it reads in whole units, with a symbol that names the currency', () => {
      expect(formatMoney(64_000_000, 'AUD')).toBe('A$640,000');
      expect(formatMoney(64_000_000, 'USD')).toBe('$640,000');
    });

    it('THEN cents are dropped, because nobody compares budgets to the cent', () => {
      expect(formatMoney(64_000_049, 'AUD')).toBe('A$640,000');
    });
  });

  describe('WHEN it has none', () => {
    it('THEN it says so, rather than showing a zero nobody agreed to', () => {
      expect(formatMoney(null, 'AUD')).toBe('No budget set');
      expect(formatMoney(0, 'AUD')).toBe('A$0');
    });
  });
});

describe('GIVEN whole dollars typed into a budget field', () => {
  describe('WHEN an amount is entered', () => {
    it('THEN it becomes the minor units the command carries', () => {
      expect(toMinorUnits('640000')).toBe(64_000_000);
      expect(toMinorUnits(' 1250 ')).toBe(125_000);
    });
  });

  describe('WHEN the field is empty or unreadable', () => {
    it('THEN there is no budget, which is different from a budget of zero', () => {
      expect(toMinorUnits('')).toBeNull();
      expect(toMinorUnits('   ')).toBeNull();
      expect(toMinorUnits('lots')).toBeNull();
      expect(toMinorUnits('0')).toBe(0);
    });
  });
});

describe('GIVEN a calendar date from the server', () => {
  describe('WHEN it is a day the project ships on', () => {
    it('THEN it reads as a day, in the order the design writes one', () => {
      expect(formatCalendarDate('2026-08-18')).toBe('18 Aug 2026');
      expect(formatCalendarDate('2026-01-05')).toBe('5 Jan 2026');
    });

    it('THEN it is not shifted by the reader being west of the server', () => {
      // The bug this pins down renders the 1st as the 31st of the month before.
      expect(formatCalendarDate('2026-01-01')).toBe('1 Jan 2026');
    });
  });

  describe('WHEN there is no date', () => {
    it('THEN a dash holds the space rather than the word null', () => {
      expect(formatCalendarDate(null)).toBe('—');
    });
  });

  describe('WHEN it is not a date at all', () => {
    it('THEN it is passed through rather than rendered as Invalid Date', () => {
      expect(formatCalendarDate('soon')).toBe('soon');
    });
  });
});

describe('GIVEN the time since a project was last touched', () => {
  describe('WHEN it was within the last minute', () => {
    it('THEN it reads as just now', () => {
      expect(formatTimeAgo(secondsAgo(0), NOW)).toBe('just now');
      expect(formatTimeAgo(secondsAgo(59), NOW)).toBe('just now');
    });
  });

  describe('WHEN it was longer ago', () => {
    it('THEN it uses the largest unit that fits', () => {
      expect(formatTimeAgo(secondsAgo(20 * 60), NOW)).toBe('20 minutes ago');
      expect(formatTimeAgo(secondsAgo(3 * 3600), NOW)).toBe('3 hours ago');
      expect(formatTimeAgo(secondsAgo(3 * 86_400), NOW)).toBe('3 days ago');
      expect(formatTimeAgo(secondsAgo(14 * 86_400), NOW)).toBe('2 weeks ago');
      expect(formatTimeAgo(secondsAgo(60 * 86_400), NOW)).toBe('2 months ago');
      expect(formatTimeAgo(secondsAgo(400 * 86_400), NOW)).toBe('last year');
    });

    it('THEN a single day reads the way a person would say it', () => {
      expect(formatTimeAgo(secondsAgo(86_400), NOW)).toBe('yesterday');
    });
  });
});

describe('GIVEN the day a document was last written', () => {
  describe('WHEN the moment it was written is formatted', () => {
    it('THEN it reads as the design writes a date', () => {
      // Midday UTC, so the day is the same one either side of the machine this
      // runs on: the point being tested is the format, not the offset.
      expect(formatInstantDate('2026-08-16T12:00:00.000Z')).toBe('16 Aug 2026');
    });
  });
});
