import { describe, expect, it } from 'vitest';

import { POSITION_STEP } from '../board/default-lists.js';
import { placeAmong, type PlacedRow } from './place-among.js';

/** Three rows a person has arranged, spaced as the app spaces them. */
const ROWS: readonly PlacedRow[] = [
  { id: 'first', position: 1000 },
  { id: 'second', position: 2000 },
  { id: 'third', position: 3000 },
];

describe('GIVEN a handful of rows somebody has put in an order', () => {
  describe('WHEN one is dropped between two of them', () => {
    it('THEN it lands between the two, and nothing else moves', () => {
      const landing = placeAmong(ROWS, { before: 'third', after: 'second' });

      expect(landing.position).toBe(2500);
      expect(landing.spread).toEqual([]);
    });
  });

  describe('WHEN one is dropped at the front', () => {
    it('THEN it lands in front of the first, which is the only bound there is', () => {
      const landing = placeAmong(ROWS, { before: 'first', after: null });

      expect(landing.position).toBe(500);
      expect(landing.position).toBeLessThan(1000);
    });
  });

  describe('WHEN one is dropped at the end', () => {
    it('THEN it lands behind the last', () => {
      const landing = placeAmong(ROWS, { before: null, after: 'third' });

      expect(landing.position).toBeGreaterThan(3000);
    });
  });

  describe('WHEN nothing is said about where it goes', () => {
    it('THEN it goes on the end, which is where a new one goes too', () => {
      const landing = placeAmong(ROWS, { before: null, after: null });

      expect(landing.position).toBe(3000 + POSITION_STEP);
    });
  });

  describe('WHEN the neighbours it named disagree', () => {
    /*
     * The one it goes in front of decides. A set that has moved on under a drag
     * is likelier to have lost the one behind, and one bound with a real
     * neighbour beats two bounds with a guess.
     */
    it('THEN the one it goes in front of decides', () => {
      const landing = placeAmong(ROWS, { before: 'second', after: 'third' });

      expect(landing.position).toBe(1500);
    });
  });

  describe('WHEN neither neighbour is there any more', () => {
    it('THEN it goes on the end rather than refusing', () => {
      const landing = placeAmong(ROWS, { before: 'gone', after: 'also gone' });

      expect(landing.position).toBe(3000 + POSITION_STEP);
    });
  });

  describe('WHEN there is nothing to place it among', () => {
    it('THEN it takes the first position', () => {
      expect(placeAmong([], { before: null, after: null }).position).toBe(POSITION_STEP);
    });
  });
});

describe('GIVEN two rows dropped between often enough that the gap has closed', () => {
  /*
   * Halving a gap forty-odd times exhausts what a double can represent, and the
   * two rows either side stop having anything between them. Without the spread
   * the next drop lands *on* a neighbour, and two rows share a position — which
   * is an order that reshuffles itself every time it is read.
   */
  const tight: readonly PlacedRow[] = [
    { id: 'first', position: 1000 },
    { id: 'second', position: 1000.0000001 },
    { id: 'third', position: 3000 },
  ];

  describe('WHEN something is dropped into the closed gap', () => {
    it('THEN everything is spread back out first', () => {
      const landing = placeAmong(tight, { before: 'second', after: 'first' });

      expect(landing.spread).toEqual([
        { id: 'first', position: 1000 },
        { id: 'second', position: 2000 },
        { id: 'third', position: 3000 },
      ]);
    });

    it('THEN it lands in the room that made, clear of both neighbours', () => {
      const landing = placeAmong(tight, { before: 'second', after: 'first' });

      expect(landing.position).toBe(1500);
    });
  });

  describe('WHEN something is dropped somewhere the gap is still open', () => {
    it('THEN nothing is rewritten, because a spread costs a write per row', () => {
      const landing = placeAmong(tight, { before: 'third', after: 'second' });

      expect(landing.spread).toEqual([]);
    });
  });
});
