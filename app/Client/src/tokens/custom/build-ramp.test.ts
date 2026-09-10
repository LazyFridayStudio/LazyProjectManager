import { describe, expect, it } from 'vitest';

import { accentRamp, secondaryRamp, tertiaryRamp, darkThemeColors } from '../color-tokens.js';
import { buildRamp, textOn } from './build-ramp.js';
import { parseHex, rgbToOklab } from './oklab.js';

/** How far apart two colours look, which is the only useful way to compare them. */
function apart(one: string, other: string): number {
  const first = rgbToOklab(parseHex(one) ?? { r: 0, g: 0, b: 0 });
  const second = rgbToOklab(parseHex(other) ?? { r: 0, g: 0, b: 0 });

  return Math.hypot(first.l - second.l, first.a - second.a, first.b - second.b);
}

const STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

describe('GIVEN a ramp built from one colour and a ground', () => {
  describe('WHEN it is built from the colours the product already ships', () => {
    /*
     * The real test of the generator: it has to land near nine values somebody
     * chose by hand. Close rather than equal — a hand-chosen ramp has judgement
     * in it that arithmetic does not — but near enough that a studio picking the
     * product's own orange gets the product's own ramp back.
     */
    it.each([
      ['accent', '#eda363', accentRamp],
      ['secondary', '#63aeeb', secondaryRamp],
      ['tertiary', '#63eba3', tertiaryRamp],
    ])('THEN the %s ramp is close to the one chosen by hand', (_name, seed, shipped) => {
      const built = buildRamp(seed, darkThemeColors.background);

      expect(built).not.toBeNull();

      for (const step of STEPS) {
        expect(apart(built?.[step] ?? '', shipped[step])).toBeLessThan(0.08);
      }
    });

    it('THEN the chosen colour is kept exactly, not approximated', () => {
      // Whatever the arithmetic does either side of it, 600 is what somebody
      // typed in and has to come back unchanged.
      expect(buildRamp('#eda363', '#242424')?.[600]).toBe('#eda363');
    });
  });

  describe('WHEN the ground changes', () => {
    it('THEN the dark steps follow it, because a step is a distance from the ground', () => {
      const onDark = buildRamp('#eda363', '#242424');
      const onLight = buildRamp('#eda363', '#e4e5e7');

      // The same colour at 600 and different colours at 100, which is what
      // makes a ramp mean the same thing on either theme.
      expect(onDark?.[600]).toBe(onLight?.[600]);
      expect(apart(onDark?.[100] ?? '', onLight?.[100] ?? '')).toBeGreaterThan(0.3);
    });

    it('THEN it does not pass through grey on the way, which is what sRGB does', () => {
      const built = buildRamp('#eda363', '#242424');
      const middle = rgbToOklab(parseHex(built?.[300] ?? '') ?? { r: 0, g: 0, b: 0 });

      // Mixing an orange toward near-black in sRGB desaturates through the
      // middle. In OKLab the browns keep their hue, which is what the
      // hand-chosen ramp does too.
      expect(Math.hypot(middle.a, middle.b)).toBeGreaterThan(0.02);
    });
  });

  describe('WHEN the colour is not a colour', () => {
    it('THEN it says so rather than guessing', () => {
      expect(buildRamp('not a colour', '#242424')).toBeNull();
      expect(buildRamp('#eda363', 'nonsense')).toBeNull();
      expect(buildRamp('#gggggg', '#242424')).toBeNull();
    });

    it('THEN three digits are a colour, because that is how people write them', () => {
      expect(buildRamp('#fa3', '#242424')?.[600]).toBe('#ffaa33');
    });
  });

  describe('WHEN deciding what to write on a colour', () => {
    it('THEN a pale accent takes dark text and a deep one takes light', () => {
      // The trap the tokens document: a fixed value gives somebody an unreadable
      // button the moment they pick a pale accent.
      expect(textOn('#fbe3cc', '#242424', '#ffffff')).toBe('#242424');
      expect(textOn('#4a3520', '#242424', '#ffffff')).toBe('#ffffff');
    });

    it('THEN the product’s own orange takes the dark text it already uses', () => {
      expect(textOn('#eda363', '#242424', '#ffffff')).toBe('#242424');
    });
  });
});
