import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, hoursForCard, placeCard, sumByDay } from './schedule-timeline.js';

const FIRST_DAY = '2026-08-24';

function card(
  overrides: Partial<Parameters<typeof placeCard>[0]> = {},
): Parameters<typeof placeCard>[0] {
  return {
    cardId: '00000000-0000-4000-8000-000000000001',
    cardKey: 'DRWN-ART-12',
    title: 'Retopologise the watchtower',
    dueOn: '2026-08-27',
    estimateMinutes: null,
    points: null,
    listName: 'In progress',
    listColor: '#f0de8a',
    ...overrides,
  };
}

describe('GIVEN a card that has to be somewhere on the timeline', () => {
  describe('WHEN it says how long it takes', () => {
    it('THEN an estimate in minutes is used as given', () => {
      expect(hoursForCard(card({ estimateMinutes: 150 }))).toBe(2.5);
    });

    it('THEN points stand in for a missing estimate, at the studio rate', () => {
      expect(hoursForCard(card({ points: 5 }))).toBe(20);
    });

    it('THEN an estimate wins over points, because somebody looked at it', () => {
      expect(hoursForCard(card({ estimateMinutes: 60, points: 5 }))).toBe(1);
    });

    it('THEN a card with neither is nought rather than a guess', () => {
      // Inventing a day for every unestimated card is how a chart comes to say a
      // week is full when nobody knows whether it is.
      expect(hoursForCard(card())).toBe(0);
    });
  });

  describe('WHEN it is placed against a working day', () => {
    it('THEN it ends on its due date and runs backwards from there', () => {
      // Three days of work due on the fourth column starts on the second.
      const placed = placeCard(
        card({ estimateMinutes: 24 * 60, dueOn: '2026-08-27' }),
        8,
        FIRST_DAY,
      );

      expect(placed?.bar.startIndex).toBe(1);
      expect(placed?.bar.spanDays).toBe(3);
    });

    it('THEN its hours are spread evenly across the days it covers', () => {
      const placed = placeCard(
        card({ estimateMinutes: 24 * 60, dueOn: '2026-08-27' }),
        8,
        FIRST_DAY,
      );

      expect(placed?.hoursByDay.slice(0, 5)).toEqual([0, 8, 8, 8, 0]);
    });

    it('THEN a slower day makes the same work take longer', () => {
      const placed = placeCard(
        card({ estimateMinutes: 24 * 60, dueOn: '2026-08-29' }),
        4,
        FIRST_DAY,
      );

      expect(placed?.bar.spanDays).toBe(6);
      expect(placed?.hoursByDay[0]).toBe(4);
    });

    it('THEN an unestimated card still shows on the day it is due', () => {
      const placed = placeCard(card({ dueOn: '2026-08-26' }), 8, FIRST_DAY);

      expect(placed?.bar).toMatchObject({ startIndex: 2, spanDays: 1, estimated: false, hours: 0 });
    });
  });

  describe('WHEN the work began before the window', () => {
    it('THEN the bar is cut off at the first day and says so', () => {
      const placed = placeCard(
        card({ estimateMinutes: 40 * 60, dueOn: '2026-08-25' }),
        8,
        FIRST_DAY,
      );

      expect(placed?.bar).toMatchObject({ startIndex: 0, spanDays: 2, startsEarlier: true });
    });

    it('THEN only the hours inside the window are counted against those days', () => {
      const placed = placeCard(
        card({ estimateMinutes: 40 * 60, dueOn: '2026-08-25' }),
        8,
        FIRST_DAY,
      );

      // Five days of eight hours, of which the window sees the last two.
      expect(placed?.hoursByDay.slice(0, 3)).toEqual([8, 8, 0]);
    });
  });

  describe('WHEN it falls outside the window entirely', () => {
    it('THEN a card already finished with is left off', () => {
      expect(placeCard(card({ dueOn: '2026-08-23' }), 8, FIRST_DAY)).toBeUndefined();
    });

    it('THEN a card whose work has not started yet is left off', () => {
      expect(placeCard(card({ dueOn: '2026-09-20' }), 8, FIRST_DAY)).toBeUndefined();
    });

    it('THEN one due beyond the window but already under way is kept', () => {
      // Due a day past the window, but eighty hours of it means it is already
      // under way, and the bar runs to the right-hand edge rather than off it.
      const placed = placeCard(
        card({ estimateMinutes: 80 * 60, dueOn: '2026-09-08' }),
        8,
        FIRST_DAY,
      );

      expect(placed?.bar).toMatchObject({ startIndex: 6, spanDays: 8, startsEarlier: false });
    });
  });

  describe('WHEN the person has no capacity at all', () => {
    it('THEN it sits on its due date rather than dividing by nought', () => {
      const placed = placeCard(
        card({ estimateMinutes: 8 * 60, dueOn: '2026-08-26' }),
        0,
        FIRST_DAY,
      );

      expect(placed?.bar).toMatchObject({ startIndex: 2, spanDays: 1 });
      expect(placed?.hoursByDay[2]).toBe(8);
    });
  });
});

describe('GIVEN several cards on one person', () => {
  describe('WHEN their days are added up', () => {
    it('THEN each column holds the hours that fell on it', () => {
      const first = placeCard(
        card({ estimateMinutes: 16 * 60, dueOn: '2026-08-25' }),
        8,
        FIRST_DAY,
      );
      const second = placeCard(
        card({ estimateMinutes: 4 * 60, dueOn: '2026-08-25' }),
        8,
        FIRST_DAY,
      );

      const total = sumByDay([first?.hoursByDay ?? [], second?.hoursByDay ?? []]);

      expect(total.slice(0, 3)).toEqual([8, 12, 0]);
    });

    it('THEN a column of thirds is a number somebody can read', () => {
      const spread = placeCard(card({ estimateMinutes: 60, dueOn: '2026-08-27' }), 0.25, FIRST_DAY);

      // A third of an hour fourteen times over is 2.9999999999999996 unrounded.
      for (const hours of sumByDay([spread?.hoursByDay ?? []])) {
        expect(String(hours).length).toBeLessThan(6);
      }
    });
  });
});

describe('GIVEN two calendar dates', () => {
  describe('WHEN the distance between them is measured', () => {
    it('THEN it counts whole days either way', () => {
      expect(daysBetween('2026-08-24', '2026-08-27')).toBe(3);
      expect(daysBetween('2026-08-27', '2026-08-24')).toBe(-3);
    });

    it('THEN a month boundary is not a special case', () => {
      expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3);
    });

    it('THEN the clocks going back does not shorten a day', () => {
      // Australia moves its clocks on the first Sunday in October. Measured in
      // local time this would be 3 days and one hour, which rounds the same way
      // by luck and the wrong way as soon as the hour lands differently.
      expect(daysBetween('2026-10-03', '2026-10-06')).toBe(3);
    });
  });

  describe('WHEN a window is walked forward', () => {
    it('THEN it crosses a month end without arithmetic of its own', () => {
      expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
    });

    it('THEN it walks backwards too, which is the previous fortnight button', () => {
      expect(addDays('2026-09-02', -14)).toBe('2026-08-19');
    });
  });
});
