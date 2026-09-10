import { describe, expect, it } from 'vitest';

import { keepWithin } from './keep-within.js';

/** A strip 400 wide and 200 tall, with a picture sitting near its top left. */
const STRIP = { top: 100, left: 100, right: 500, bottom: 300 };
const PICTURE = { top: 100, left: 100, right: 200, bottom: 180 };

describe('GIVEN a picture being dragged inside a strip', () => {
  describe('WHEN it is still inside', () => {
    it('THEN it goes exactly where the pointer took it', () => {
      expect(keepWithin(PICTURE, STRIP, { x: 50, y: 40 })).toEqual({ x: 50, y: 40 });
    });

    it('THEN sitting flush against an edge is inside', () => {
      // Right edge: 200 + 300 = 500, which is the strip's right.
      expect(keepWithin(PICTURE, STRIP, { x: 300, y: 0 })).toEqual({ x: 300, y: 0 });
    });
  });

  describe('WHEN it is carried past an edge', () => {
    it('THEN it stops at the bottom rather than travelling over the buttons', () => {
      // Past the bottom is where the drag used to scroll the page away under
      // itself, because the transform extends the panel's scrollable overflow.
      expect(keepWithin(PICTURE, STRIP, { x: 0, y: 900 })).toEqual({ x: 0, y: 120 });
    });

    it('THEN it stops at the top', () => {
      expect(keepWithin(PICTURE, STRIP, { x: 0, y: -900 })).toEqual({ x: 0, y: 0 });
    });

    it('THEN it stops at the left and the right', () => {
      expect(keepWithin(PICTURE, STRIP, { x: -900, y: 0 }).x).toBe(0);
      expect(keepWithin(PICTURE, STRIP, { x: 900, y: 0 }).x).toBe(300);
    });
  });

  describe('WHEN it is dragged along an edge', () => {
    it('THEN the axis that still fits keeps moving', () => {
      // Held at the bottom, but still free to travel sideways: clamping both
      // axes together would stick it in the corner.
      expect(keepWithin(PICTURE, STRIP, { x: 120, y: 900 })).toEqual({ x: 120, y: 120 });
    });
  });

  describe('WHEN the picture is larger than the strip', () => {
    it('THEN it rests against the top left rather than hanging off the far side', () => {
      const huge = { top: 100, left: 100, right: 900, bottom: 700 };

      // No offset fits, and the low bound is the one that reads as "against the
      // edge it started at" rather than "off the other one".
      expect(keepWithin(huge, STRIP, { x: 50, y: 50 })).toEqual({ x: 0, y: 0 });
    });
  });
});
