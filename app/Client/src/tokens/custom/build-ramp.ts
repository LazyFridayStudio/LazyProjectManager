import type { TonalRamp } from '../color-tokens.js';
import { mix, oklabToRgb, parseHex, rgbToOklab, toHex, type Oklab } from './oklab.js';

/**
 * Nine steps from one colour and the ground it sits on.
 *
 * The shipped ramps are nine hand-chosen values each, and the comment on
 * `lightAccentRamp` explains at length why the dark one reversed gives mud. So
 * this does not reverse anything: **600 is the colour somebody picked, the steps
 * above it go toward white, and the steps below it go toward the ground the
 * theme is on.** A ramp built that way means the same thing on either theme —
 * a step is a distance from the ground rather than a fixed colour — which is
 * what `lightAccentRamp`'s own comment says it was built to do.
 *
 * In OKLab, because that is the difference between a ramp and a smear: mixing
 * an orange toward a near-black in sRGB passes through grey, and mixing it in
 * OKLab passes through the browns the hand-chosen ramp actually uses.
 *
 * The steps are not evenly spaced. `600` to `900` covers less ground than `600`
 * down to `100`, because the light end is three tints of one colour and the dark
 * end has to reach all the way to something that can sit behind text.
 */
const TOWARD_WHITE: Readonly<Record<700 | 800 | 900, number>> = {
  700: 0.24,
  800: 0.48,
  900: 0.73,
};

const TOWARD_GROUND: Readonly<Record<100 | 200 | 300 | 400 | 500, number>> = {
  500: 0.28,
  400: 0.56,
  300: 0.75,
  200: 0.85,
  100: 0.92,
};

const WHITE: Oklab = { l: 1, a: 0, b: 0 };

/**
 * Builds the ramp for one chosen colour.
 *
 * Returns null for a colour that is not a colour, which is the panel's problem
 * to report rather than this one's to guess at.
 */
export function buildRamp(seedHex: string, groundHex: string): TonalRamp | null {
  const seed = parseHex(seedHex);
  const ground = parseHex(groundHex);

  if (seed === null || ground === null) {
    return null;
  }

  const from = rgbToOklab(seed);
  const toGround = rgbToOklab(ground);
  const step = (target: Oklab, amount: number): string =>
    toHex(oklabToRgb(mix(from, target, amount)));

  return {
    100: step(toGround, TOWARD_GROUND[100]),
    200: step(toGround, TOWARD_GROUND[200]),
    300: step(toGround, TOWARD_GROUND[300]),
    400: step(toGround, TOWARD_GROUND[400]),
    500: step(toGround, TOWARD_GROUND[500]),
    600: toHex(seed),
    700: step(WHITE, TOWARD_WHITE[700]),
    800: step(WHITE, TOWARD_WHITE[800]),
    900: step(WHITE, TOWARD_WHITE[900]),
  };
}

/**
 * Which of black or white to put on a colour.
 *
 * `textOnAccent` is the trap the tokens already document: dark puts `#242424`
 * on its orange and light puts white on its, so a fixed value gives somebody an
 * unreadable button the moment they pick a pale accent. OKLab's lightness is a
 * better judge of that than a luminance sum, because it is already the thing
 * being asked about — how light does this look.
 */
export function textOn(hex: string, dark: string, light: string): string | null {
  const rgb = parseHex(hex);

  return rgb === null ? null : rgbToOklab(rgb).l > 0.62 ? dark : light;
}
