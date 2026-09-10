import { describe, expect, it } from 'vitest';

import { closingStampFor } from './closing.js';

const NOW = new Date('2026-09-08T10:00:00.000Z');
const EARLIER = new Date('2026-09-01T09:00:00.000Z');

describe('GIVEN a card that has landed in a list', () => {
  describe('WHEN the list is the one the board finishes on', () => {
    it('THEN an open card is stamped with the moment it arrived', () => {
      expect(closingStampFor({ isFinishingList: true, closedAt: null, now: NOW })).toEqual(NOW);
    });

    it('THEN a card that was already closed keeps the stamp it had', () => {
      // Dragged up the Done column rather than finished a second time.
      expect(closingStampFor({ isFinishingList: true, closedAt: EARLIER, now: NOW })).toEqual(
        EARLIER,
      );
    });
  });

  describe('WHEN the list is any other', () => {
    it('THEN an open card stays open', () => {
      expect(closingStampFor({ isFinishingList: false, closedAt: null, now: NOW })).toBeNull();
    });

    it('THEN a card taken back out of the finishing list is opened again', () => {
      expect(closingStampFor({ isFinishingList: false, closedAt: EARLIER, now: NOW })).toBeNull();
    });
  });
});
