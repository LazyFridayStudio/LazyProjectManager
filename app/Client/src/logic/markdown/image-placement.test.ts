import { describe, expect, it } from 'vitest';

import { listImages, setImagePlacement } from './image-placement.js';

const CRANE = '![Crane](/api/f/018f "left 0.5")';
const WELL = '![Well](/api/f/019a "center 1")';

describe('GIVEN a description with images in it', () => {
  describe('WHEN they are counted', () => {
    it('THEN each one is found, in the order it appears', () => {
      const images = listImages(`Some prose.\n\n${CRANE}\n\nMore prose.\n\n${WELL}\n`);

      expect(images.map((image) => image.altText)).toEqual(['Crane', 'Well']);
      expect(images[0]?.placement).toEqual({ alignment: 'left', scale: 0.5 });
      expect(images[1]?.url).toBe('/api/f/019a');
    });

    it('THEN one written by another editor, with no placement, still counts', () => {
      const images = listImages('![Plain](/api/f/018f)');

      expect(images).toHaveLength(1);
      expect(images[0]?.placement).toEqual({ alignment: 'center', scale: 1 });
    });

    it('THEN a link that is not an image is not one', () => {
      expect(listImages('[Not an image](/api/f/018f)')).toHaveLength(0);
    });

    it('THEN a URL wrapped in angle brackets is read without them', () => {
      expect(listImages('![Crane](</api/f/018f with space> "center 1")')[0]?.url).toBe(
        '/api/f/018f with space',
      );
    });
  });

  describe('WHEN one is resized', () => {
    it('THEN only that one changes', () => {
      const source = `${CRANE}\n\n${WELL}`;

      const after = setImagePlacement(source, 1, { alignment: 'right', scale: 0.25 });

      expect(after).toContain(CRANE);
      expect(after).toContain('![Well](/api/f/019a "right 0.25")');
    });

    it('THEN the same image twice is resized one at a time', () => {
      // By position rather than by URL: resizing one must not resize the other.
      const source = `${CRANE}\n\n${CRANE}`;

      const after = setImagePlacement(source, 0, { alignment: 'center', scale: 1 });

      expect(after).toBe(`![Crane](/api/f/018f "center 1")\n\n${CRANE}`);
    });

    it('THEN everything around it is left exactly as typed', () => {
      const source = `# Heading\n\nSome **prose**.\n\n${CRANE}\n\n- a list item\n`;

      const after = setImagePlacement(source, 0, { alignment: 'right', scale: 0.75 });

      expect(after).toBe(
        `# Heading\n\nSome **prose**.\n\n![Crane](/api/f/018f "right 0.75")\n\n- a list item\n`,
      );
    });

    it('THEN an index nothing is at leaves the source alone', () => {
      const source = `${CRANE}\n`;

      expect(setImagePlacement(source, 7, { alignment: 'left', scale: 0.1 })).toBe(source);
    });
  });

  describe('WHEN a placement goes out and comes back', () => {
    it('THEN it survives the round trip', () => {
      for (const placement of [
        { alignment: 'left', scale: 0.25 },
        { alignment: 'center', scale: 1 },
        { alignment: 'right', scale: 0.6 },
      ] as const) {
        const after = setImagePlacement(CRANE, 0, placement);

        expect(listImages(after)[0]?.placement).toEqual(placement);
      }
    });
  });
});
