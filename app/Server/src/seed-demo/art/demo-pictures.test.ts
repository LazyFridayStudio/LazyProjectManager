import { describe, expect, it } from 'vitest';

import { DEMO_LISTS, DEMO_PEOPLE } from '../demo-fixture.js';
import { DEMO_CATEGORIES } from '../demo-library.js';
import {
  DEMO_ASSET_PICTURES,
  DEMO_AVATARS,
  DEMO_CARD_SHEETS,
  DEMO_KEY_ART,
  DEMO_LOGO,
  DEMO_OWNER_AVATAR,
  type DemoPicture,
} from './demo-pictures.js';

/**
 * The pictures are hung on things by name, which is the same way the rest of
 * the seed matches everything. That works right up until somebody renames an
 * asset in the fixture and not its picture — at which point the seed quietly
 * files nothing, and nobody finds out until a screenshot is a grid of grey
 * boxes. These are the tests that find out instead.
 */

const everyPicture: readonly DemoPicture[] = [
  ...DEMO_ASSET_PICTURES,
  ...DEMO_CARD_SHEETS.map((sheet) => sheet.picture),
  ...DEMO_AVATARS.map((avatar) => avatar.picture),
  DEMO_OWNER_AVATAR,
  DEMO_KEY_ART,
  DEMO_LOGO,
];

describe('GIVEN the demo art and the demo data beside it', () => {
  describe('WHEN the library is matched up with its pictures', () => {
    it('THEN every asset has one and no picture is filed under a name nothing has', () => {
      const assets = DEMO_CATEGORIES.flatMap((category) =>
        category.assets.map((asset) => asset.name),
      );

      expect(new Set(DEMO_ASSET_PICTURES.map((picture) => picture.name))).toEqual(new Set(assets));
    });
  });

  describe('WHEN the sheets pinned to cards are matched up with the board', () => {
    it('THEN each of them names a card that is really on it', () => {
      const titles = new Set(DEMO_LISTS.flatMap((list) => list.cards.map((card) => card.title)));

      for (const sheet of DEMO_CARD_SHEETS) {
        expect(titles.has(sheet.cardTitle)).toBe(true);
      }
    });
  });

  describe('WHEN the faces are matched up with the people', () => {
    it('THEN everybody in the demo has one', () => {
      expect(DEMO_AVATARS.map((avatar) => avatar.initials).sort()).toEqual(
        DEMO_PEOPLE.map((person) => person.initials).sort(),
      );
    });

    it('THEN the owner has one of their own, which is nobody else’s', () => {
      // They reported every card and every asset in the demo, so the one set of
      // initials left on the screen would be theirs.
      const grounds = [...DEMO_AVATARS.map((avatar) => avatar.picture), DEMO_OWNER_AVATAR];

      expect(new Set(grounds.map((picture) => picture.svg)).size).toBe(grounds.length);
    });
  });
});

describe('GIVEN every picture the demo comes with', () => {
  describe('WHEN they are looked at as files', () => {
    it('THEN no two share a filename, which is what the seed matches them on', () => {
      const filenames = everyPicture.map((picture) => picture.filename);

      expect(new Set(filenames).size).toBe(filenames.length);
    });

    it('THEN each one is an svg document of the size it says it is', () => {
      for (const picture of everyPicture) {
        expect(picture.svg.startsWith('<svg ')).toBe(true);
        expect(picture.svg.endsWith('</svg>')).toBe(true);
        expect(picture.svg).toContain(
          `viewBox="0 0 ${String(picture.width)} ${String(picture.height)}"`,
        );
      }
    });

    it('THEN none of them is large enough to be worth a thumbnail', () => {
      // Nothing makes a smaller copy of these, so the original is what every
      // screen fetches. A picture that grew into the megabytes would be forty
      // of them on one library screen.
      for (const picture of everyPicture) {
        expect(Buffer.byteLength(picture.svg, 'utf8')).toBeLessThan(256 * 1024);
      }
    });
  });

  describe('WHEN a library tile draws one of them', () => {
    it('THEN it is the sixteen by nine the slot is, so nothing is letterboxed', () => {
      // Every picture slot in the product is `16 / 9` with `object-fit:
      // contain`. A square picture is drawn in the middle of the tile with the
      // tile's own background either side of it, which looks like a mistake
      // because it is one.
      for (const picture of DEMO_ASSET_PICTURES) {
        expect(picture.width / picture.height).toBeCloseTo(16 / 9);
      }
    });
  });

  describe('WHEN the launcher tile draws the key art', () => {
    it('THEN it is the sixteen-by-nine the tile crops to, and says the name', () => {
      expect(DEMO_KEY_ART.width / DEMO_KEY_ART.height).toBeCloseTo(16 / 9);
      // The tile draws the picture and nothing else, so the name has to be in it.
      expect(DEMO_KEY_ART.svg).toContain('BLOCKFALL');
    });
  });

  describe('WHEN the shell draws the project mark', () => {
    it('THEN it is square, because the slot it sits in is', () => {
      expect(DEMO_LOGO.width).toBe(DEMO_LOGO.height);
    });
  });
});
