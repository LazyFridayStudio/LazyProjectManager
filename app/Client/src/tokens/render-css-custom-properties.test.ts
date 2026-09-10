import { describe, expect, it } from 'vitest';

import { accentRamp, darkThemeColors, lightThemeColors, paperThemeColors } from './color-tokens.js';
import { colorByAssetStatus } from './asset-status-colors.js';
import { colorByCardType } from './card-type-colors.js';
import { renderCssCustomProperties } from './render-css-custom-properties.js';
import { fontSizesPx, headingFontWeight, titleFontWeight } from './typography-tokens.js';

describe('GIVEN the design tokens rendered to a stylesheet', () => {
  const stylesheet = renderCssCustomProperties();

  describe('WHEN the application chrome is styled', () => {
    it('THEN a :root block carries the dark theme', () => {
      expect(stylesheet).toContain(':root {');
      expect(stylesheet).toContain(`--color-bg: ${darkThemeColors.background};`);
      expect(stylesheet).toContain(`--color-text: ${darkThemeColors.text};`);
    });
  });

  describe('WHEN a document surface is styled', () => {
    it('THEN a .lpm-paper block inverts it to the light theme', () => {
      expect(stylesheet).toContain('.lpm-paper {');
      expect(stylesheet).toContain('--color-bg: #ffffff;');
    });
  });

  describe('WHEN a tonal ramp is used', () => {
    it('THEN every step of it is emitted', () => {
      for (const [step, color] of Object.entries(accentRamp) as [string, string][]) {
        expect(stylesheet).toContain(`--color-accent-${step}: ${color};`);
      }
    });
  });

  describe('WHEN an asset is drawn anywhere in the library', () => {
    it('THEN every status has one colour, so the tile and the dashboard agree', () => {
      for (const [status, color] of Object.entries(colorByAssetStatus)) {
        expect(stylesheet).toContain(`--color-status-${status}: ${color};`);
      }
    });
  });

  describe('WHEN a card is drawn on the board', () => {
    it('THEN every card type has a chip colour', () => {
      for (const [cardType, color] of Object.entries(colorByCardType)) {
        expect(stylesheet).toContain(`--color-card-${cardType}: ${color};`);
      }
    });
  });

  describe('WHEN one thing sits on another', () => {
    it('THEN the app, its panels and the tiles on them each have a ground', () => {
      expect(stylesheet).toContain(`--color-panel: ${darkThemeColors.panel};`);
      expect(stylesheet).toContain(`--color-surface: ${darkThemeColors.surface};`);
      expect(stylesheet).toContain(`--color-panel: ${paperThemeColors.panel};`);
    });

    it('THEN each ground is a step lighter than the one it sits on', () => {
      // Depth is read from the tone rather than from a shadow, so the order
      // matters more than any of the three values does.
      const lightness = (grey: string): number => Number.parseInt(grey.slice(1), 16);

      expect(lightness(darkThemeColors.background)).toBeLessThan(lightness(darkThemeColors.panel));
      expect(lightness(darkThemeColors.panel)).toBeLessThan(lightness(darkThemeColors.surface));
    });
  });

  describe('WHEN a control is labelled', () => {
    it('THEN the label colour is emitted for both themes', () => {
      // Every uppercase micro-label reads from this one value, so a label going
      // faint is one decision rather than a search through six stylesheets.
      expect(stylesheet).toContain(`--color-label: ${darkThemeColors.label};`);
      expect(stylesheet).toContain('--color-label: #55595b;');
    });
  });

  describe('WHEN long-form prose is drawn', () => {
    /*
     * Headings had size and nothing else, and size was not enough: a `##` was
     * the same white as the paragraph under it, and a `###` was a percentage of
     * the text colour — dimmer than the prose it introduced.
     */
    it('THEN each heading level is a colour of its own, in every theme', () => {
      for (const theme of [darkThemeColors, lightThemeColors, paperThemeColors]) {
        const levels = [theme.proseHeading1, theme.proseHeading2, theme.proseHeading3];

        expect(new Set(levels).size).toBe(3);
        // And none of them is the prose, which is the whole point of them.
        expect(levels).not.toContain(theme.text);
      }
    });

    it('THEN every theme emits all three', () => {
      expect(stylesheet).toContain(`--color-prose-heading-2: ${darkThemeColors.proseHeading2};`);
      expect(stylesheet).toContain(`--color-prose-heading-2: ${lightThemeColors.proseHeading2};`);
      expect(stylesheet).toContain(`--color-prose-heading-2: ${paperThemeColors.proseHeading2};`);
    });
  });

  describe('WHEN a theme is asked for', () => {
    /** The declarations inside one rule, by custom property name. */
    const declarationsIn = (selector: string): Set<string> => {
      const rule = stylesheet.slice(stylesheet.indexOf(`${selector} {`));
      const body = rule.slice(0, rule.indexOf('}'));

      return new Set(
        [...body.matchAll(/^\s*(--[\w-]+|color-scheme):/gmu)].map(([, name]) => name ?? ''),
      );
    };

    it('THEN the light one answers for everything the dark one says', () => {
      /*
       * The failure this catches is a token the light theme forgot.
       *
       * It does not error and it is not obviously wrong on screen — the value
       * simply stays whatever `:root` said, so one control keeps its dark
       * border on a white panel and nobody notices until they do. A palette is
       * only a theme if it answers for all of it.
       */
      const dark = declarationsIn("[data-theme='dark']");
      const light = declarationsIn("[data-theme='light']");

      expect([...dark].filter((name) => !light.has(name))).toEqual([]);
    });

    it('THEN the light one says what the browser should draw for itself', () => {
      // Scrollbars, a date picker, the caret. The one part of the window a
      // stylesheet cannot reach.
      expect(declarationsIn("[data-theme='light']")).toContain('color-scheme');
    });

    it('THEN the stepped-back tones are said once, because they follow the text', () => {
      // They are percentages of `--color-text`, so a theme that redefines the
      // text redefines all of them for free. A theme restating them would be a
      // second place for the same decision.
      expect(declarationsIn("[data-theme='light']")).not.toContain('--color-text-faint');
      expect(declarationsIn(':root')).toContain('--color-text-faint');
    });

    it('THEN a document surface still wins, whichever theme the chrome is in', () => {
      /*
       * `.lpm-paper` weighs the same as the theme rules and comes last, which
       * is the whole of why it wins. If a theme were ever written with a
       * heavier selector, a design document inside a light app would quietly
       * take the chrome's palette instead of its own.
       */
      const paperAt = stylesheet.indexOf('.lpm-paper {');
      const lightAt = stylesheet.indexOf("[data-theme='light'] {");

      expect(lightAt).toBeGreaterThan(0);
      expect(paperAt).toBeGreaterThan(lightAt);
    });
  });

  describe('WHEN text is sized', () => {
    it('THEN every step of the type scale is emitted', () => {
      for (const [name, size] of Object.entries(fontSizesPx)) {
        expect(stylesheet).toContain(`--font-size-${name}: ${String(size)}px;`);
      }
    });

    it('THEN a title is the one bold step, so weight is what marks it', () => {
      expect(titleFontWeight).toBeGreaterThan(headingFontWeight);
      expect(stylesheet).toContain(`--font-title-weight: ${String(titleFontWeight)};`);
    });

    it('THEN the scale runs largest to smallest with no repeats at all', () => {
      // Two steps with the same size are two names for one decision, which is
      // how a fixed scale quietly turns back into ad-hoc sizes. It had one such
      // pair — `title` and `h1`, both 24 — and every screen chose between them
      // by looking at whichever screen was written before it.
      const steps = Object.values(fontSizesPx);

      expect(steps).toEqual([...steps].sort((left, right) => right - left));
      expect(new Set(steps).size).toBe(steps.length);
    });
  });

  describe('WHEN the accent is referenced', () => {
    it('THEN it resolves to step 600 of the accent ramp', () => {
      // The prototype's accent is the 600 step, not a separate value. If these
      // disagree, every accented surface shifts by one tone.
      expect(darkThemeColors.accent).toBe(accentRamp[600]);
      expect(stylesheet).toContain(`--color-accent: ${accentRamp[600]};`);
    });
  });
});
