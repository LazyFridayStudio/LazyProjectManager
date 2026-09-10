import { describe, expect, it } from 'vitest';

import { isometricBlock, jitterFor, pixelSprite, shadeOf, svgDocument } from './voxel-drawing.js';

/** How many shapes a face is made of, and a block is three faces. */
function countShapes(drawing: string, shape: 'polygon' | 'rect'): number {
  return drawing.split(`<${shape} `).length - 1;
}

describe('GIVEN a colour being shaded', () => {
  describe('WHEN it is asked for lighter and darker', () => {
    it('THEN it comes back as six hex digits either way', () => {
      expect(shadeOf('#808080', 1.25)).toBe('#a0a0a0');
      expect(shadeOf('#808080', 0.5)).toBe('#404040');
    });
  });

  describe('WHEN the factor would take a channel past white or black', () => {
    it('THEN it stops at white and at black rather than wrapping round', () => {
      // Wrapping would turn a highlight into a black square, which is the sort
      // of thing nobody notices until it is in a screenshot.
      expect(shadeOf('#ffffff', 4)).toBe('#ffffff');
      expect(shadeOf('#0a0a0a', -3)).toBe('#000000');
    });
  });
});

describe('GIVEN the jitter a texture is shaded from', () => {
  describe('WHEN the same square is asked for twice', () => {
    it('THEN it is the same number, so a re-seeded demo is the same picture', () => {
      expect(jitterFor('grass:top', 2, 3)).toBe(jitterFor('grass:top', 2, 3));
    });
  });

  describe('WHEN two different squares are asked for', () => {
    it('THEN they differ, which is what makes a face look like a texture', () => {
      const across = new Set([0, 1, 2, 3].map((column) => jitterFor('grass:top', 0, column)));

      expect(across.size).toBeGreaterThan(1);
    });

    it('THEN every one of them is a fraction between nought and one', () => {
      for (let column = 0; column < 16; column += 1) {
        const value = jitterFor('stone:left', 1, column);

        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });
  });
});

describe('GIVEN a block being drawn', () => {
  const block = {
    x: 100,
    y: 100,
    size: 40,
    name: 'grass',
    top: '#6ab04c',
    left: '#8b6239',
    right: '#6f4c2c',
  };

  describe('WHEN it is drawn with the usual four squares to an edge', () => {
    it('THEN it is three faces of sixteen squares, and nothing behind them', () => {
      // Three, because the other three are on the far side of the cube.
      expect(countShapes(isometricBlock(block), 'polygon')).toBe(3 * 4 * 4);
    });
  });

  describe('WHEN it is drawn coarser, as the key art draws a hundred of them', () => {
    it('THEN there are fewer squares, and the picture is smaller for it', () => {
      expect(countShapes(isometricBlock({ ...block, tiles: 2 }), 'polygon')).toBe(3 * 2 * 2);
    });
  });

  describe('WHEN it is given a fringe', () => {
    it('THEN the sides wear it and the top does not, which is what grass is', () => {
      const plain = isometricBlock(block);
      const fringed = isometricBlock({ ...block, fringe: '#4d8a34' });

      expect(fringed).not.toBe(plain);
      // Both sides gain a row of it; the top face is one colour throughout.
      expect(countShapes(fringed, 'polygon')).toBe(countShapes(plain, 'polygon'));
    });
  });
});

describe('GIVEN a sprite drawn from rows of characters', () => {
  const palette = { s: '#79d454', e: '#1a1f2b' };

  describe('WHEN a row holds a run of the same character', () => {
    it('THEN the run is one rectangle rather than one per pixel', () => {
      const drawn = pixelSprite({ rows: ['ssss'], palette, x: 0, y: 0, pixel: 10 });

      expect(countShapes(drawn, 'rect')).toBe(1);
      expect(drawn).toContain('width="40"');
    });
  });

  describe('WHEN a row holds characters the palette says nothing about', () => {
    it('THEN nothing is drawn there, which is how a sprite has a shape at all', () => {
      const drawn = pixelSprite({ rows: ['.s.s.'], palette, x: 0, y: 0, pixel: 10 });

      expect(countShapes(drawn, 'rect')).toBe(2);
    });
  });

  describe('WHEN it is drawn somewhere other than the origin', () => {
    it('THEN every pixel is offset by where it was put', () => {
      const drawn = pixelSprite({ rows: ['..', 'se'], palette, x: 5, y: 7, pixel: 10 });

      expect(drawn).toContain('x="5" y="17"');
    });
  });
});

describe('GIVEN a picture being wrapped up as a document', () => {
  describe('WHEN it is written out', () => {
    it('THEN it is an svg of the size asked for, named for what it draws', () => {
      const document = svgDocument({
        width: 320,
        height: 200,
        body: '<g/>',
        title: 'A grass block',
      });

      expect(document.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(document).toContain('viewBox="0 0 320 200"');
      expect(document).toContain('aria-label="A grass block"');
      expect(document.endsWith('</svg>')).toBe(true);
    });
  });
});
