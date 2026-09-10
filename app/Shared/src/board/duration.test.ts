import { describe, expect, it } from 'vitest';

import { formatDuration, parseDuration, MINUTES_PER_WORKING_DAY } from './duration.js';

/** Unwraps a parse that is expected to have succeeded. */
function minutesOf(input: string): number | null {
  const parsed = parseDuration(input);

  if (!parsed.ok) {
    throw new Error(`Expected "${input}" to parse, got: ${parsed.reason}`);
  }

  return parsed.minutes;
}

describe('GIVEN an estimate somebody typed', () => {
  describe('WHEN it names its units', () => {
    it('THEN each unit is read', () => {
      expect(minutesOf('45m')).toBe(45);
      expect(minutesOf('3h')).toBe(180);
      expect(minutesOf('2d')).toBe(2 * MINUTES_PER_WORKING_DAY);
    });

    it('THEN units combine', () => {
      expect(minutesOf('2d 4h')).toBe(2 * MINUTES_PER_WORKING_DAY + 240);
      expect(minutesOf('1h 30m')).toBe(90);
      expect(minutesOf('1d 2h 15m')).toBe(MINUTES_PER_WORKING_DAY + 135);
    });

    it('THEN spacing and case do not matter', () => {
      expect(minutesOf('  2D4H  ')).toBe(2 * MINUTES_PER_WORKING_DAY + 240);
      expect(minutesOf('2 d 4 h')).toBe(2 * MINUTES_PER_WORKING_DAY + 240);
    });

    it('THEN fractions are accepted, because half a day is a real estimate', () => {
      expect(minutesOf('0.5d')).toBe(MINUTES_PER_WORKING_DAY / 2);
      expect(minutesOf('1.5h')).toBe(90);
    });
  });

  describe('WHEN a day is what somebody means by a day', () => {
    it('THEN it is eight working hours, not twenty-four', () => {
      // Reading a day as twenty-four hours would triple every number on the
      // board, which is the whole reason this is worth a test.
      expect(minutesOf('1d')).toBe(480);
      expect(minutesOf('1d')).toBe(minutesOf('8h'));
    });
  });

  describe('WHEN it is a bare number', () => {
    it('THEN it means hours, which is how a short estimate gets written', () => {
      expect(minutesOf('3')).toBe(180);
      expect(minutesOf('0.5')).toBe(30);
      expect(minutesOf('0')).toBe(0);
    });
  });

  describe('WHEN the field is empty', () => {
    it('THEN there is no estimate, which is not the same as an estimate of zero', () => {
      expect(minutesOf('')).toBeNull();
      expect(minutesOf('   ')).toBeNull();
      expect(minutesOf('0')).toBe(0);
    });
  });

  describe('WHEN it cannot be read at all', () => {
    it('THEN it is refused rather than quietly dropped', () => {
      // Silently reading "tomorrow" as no estimate loses what somebody meant.
      for (const input of ['tomorrow', 'a while', '-3', 'abc']) {
        expect(parseDuration(input).ok).toBe(false);
      }
    });

    it('THEN the reason is something a field can show', () => {
      const parsed = parseDuration('tomorrow');

      expect(parsed.ok).toBe(false);
      expect(parsed.ok ? '' : parsed.reason).toContain('2d 4h');
    });
  });

  describe('WHEN it is longer than anybody plans for', () => {
    it('THEN it is refused, because it is a typo rather than an estimate', () => {
      expect(parseDuration('5000d').ok).toBe(false);
    });
  });
});

describe('GIVEN a duration being written back', () => {
  describe('WHEN it has hours and minutes', () => {
    it('THEN both are shown', () => {
      expect(formatDuration(150)).toBe('2h 30m');
    });
  });

  describe('WHEN it is whole hours or under an hour', () => {
    it('THEN only the part that matters is shown', () => {
      expect(formatDuration(180)).toBe('3h');
      expect(formatDuration(45)).toBe('45m');
      expect(formatDuration(0)).toBe('0m');
    });
  });

  describe('WHEN it is longer than a working day', () => {
    it('THEN it is still written in hours, never in days', () => {
      // "1d 2h" and "10h" are the same card, and one of them is easier to
      // compare against the card next to it.
      expect(formatDuration(600)).toBe('10h');
    });
  });

  describe('WHEN it goes out and comes back', () => {
    it('THEN it survives the round trip', () => {
      for (const input of ['45m', '3h', '2h 30m', '1d', '2d 4h']) {
        const minutes = minutesOf(input);

        expect(minutes).not.toBeNull();
        expect(minutesOf(formatDuration(minutes ?? 0))).toBe(minutes);
      }
    });
  });
});
