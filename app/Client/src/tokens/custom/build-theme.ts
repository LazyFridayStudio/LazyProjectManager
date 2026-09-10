import type { ThemeColors } from '@lpm/shared';

import {
  categoryInkPercent,
  listTintOverPercent,
  listTintPercent,
} from '../interaction-state-tokens.js';
import { buildRamp, textOn } from './build-ramp.js';
import { lightnessOf, mix, oklabToRgb, parseHex, rgbToOklab, toHex } from './oklab.js';

/**
 * Eight colours in, the whole palette out.
 *
 * This is the layer the token work was for. Every custom property the build
 * emits is either one of the eight somebody chose, or derived from them by the
 * same rules the shipped themes already follow — so nothing in the client has
 * to change for a theme to exist, and a stylesheet that read a real token
 * yesterday reads a real token today.
 *
 * The derivations are the rules the tokens document, not new ones:
 *
 * - **Panel and surface are steps off the ground**, because that is how depth
 *   is read everywhere in the app without a shadow. Three unrelated colours
 *   would break it on every screen at once.
 * - **The text tones are percentages of the text colour**, declared once rather
 *   than per theme — a theme that redefines the text redefines all of them for
 *   free, which is the point of them being percentages.
 * - **The prose headings are three steps of the accent ramp**, warm because the
 *   body text is not.
 * - **`textOnAccent` is worked out from the accent**, which is the trap the
 *   tokens document: a fixed value gives an unreadable button the moment
 *   somebody picks a pale one.
 */
export function buildThemeProperties(colors: ThemeColors): readonly (readonly [string, string])[] {
  const ground = colors.background;
  const accent = buildRamp(colors.accent, ground);
  const secondary = buildRamp(colors.secondary, ground);
  const tertiary = buildRamp(colors.tertiary, ground);

  if (accent === null || secondary === null || tertiary === null) {
    return [];
  }

  const away = (amount: number): string => step(ground, colors.text, amount);
  const isDark = colors.scheme === 'dark';

  return [
    ['--color-bg', ground],
    // Each a step further from the ground, in the direction of the text — which
    // is up on a dark theme and down on a light one, without asking which.
    ['--color-panel', away(0.06)],
    ['--color-surface', away(0.1)],
    ['--color-page-title-header-background', away(0.03)],
    ['--color-control', away(isDark ? 0.13 : -0.06)],
    ['--color-control-border', `color-mix(in srgb, ${colors.text} 26%, transparent)`],
    ['--color-control-border-hover', `color-mix(in srgb, ${colors.text} 42%, transparent)`],
    ['--color-text', colors.text],
    ['--color-label', away(0.62)],
    ['--color-divider', `color-mix(in srgb, ${colors.text} 16%, transparent)`],
    ['--color-text-on-accent', textOn(colors.accent, '#242424', '#ffffff') ?? '#ffffff'],
    // The scrim is black under any theme, so what reads on it is too.
    ['--color-text-on-scrim', '#f2f2f2'],
    ['--color-prose-heading-1', accent[800]],
    ['--color-prose-heading-2', accent[700]],
    ['--color-prose-heading-3', accent[600]],
    ['--color-accent', accent[600]],
    ['--color-accent-100', accent[100]],
    ['--color-accent-200', accent[200]],
    ['--color-accent-300', accent[300]],
    ['--color-accent-400', accent[400]],
    ['--color-accent-500', accent[500]],
    ['--color-accent-700', accent[700]],
    ['--color-accent-800', accent[800]],
    ['--color-accent-900', accent[900]],
    ['--color-secondary', secondary[600]],
    ['--color-tertiary', tertiary[600]],
    ['--color-danger', colors.danger],
    ['--color-danger-500', step(colors.danger, ground, 0.28)],
    ['--color-danger-200', step(colors.danger, ground, 0.82)],
    ['--color-warn', colors.warning],
    ['--color-warn-500', step(colors.warning, ground, 0.28)],
    ['--color-warn-200', step(colors.warning, ground, 0.82)],
    ['--color-ok', colors.success],
    ['--color-ok-500', step(colors.success, ground, 0.28)],
    /*
     * The list tint follows the scheme rather than the ground's own lightness.
     *
     * A bright ground shows a hue far more readily than a dark one, so the six
     * per cent that is barely there over `#333` is a wash over `#eeeff1` — and
     * four saturated columns side by side stop reading as panels with a
     * coloured edge and start reading as coloured panels. Which of the two a
     * custom theme is has already been answered, by the person who chose it.
     */
    ['--list-tint', `${String(listTintPercent[colors.scheme])}%`],
    ['--category-ink', `${String(categoryInkPercent[colors.scheme])}%`],
    ['--list-tint-over', `${String(listTintOverPercent[colors.scheme])}%`],
    ['color-scheme', colors.scheme],
  ];
}

/** One colour moved toward another, or back away from it for a negative amount. */
function step(fromHex: string, towardHex: string, amount: number): string {
  const from = parseHex(fromHex);
  const toward = parseHex(towardHex);

  if (from === null || toward === null) {
    return fromHex;
  }

  return toHex(oklabToRgb(mix(rgbToOklab(from), rgbToOklab(toward), amount)));
}

/**
 * Whether a palette can be read, which is the thing to say before it is saved.
 *
 * Not a full contrast audit: the one pairing that makes a theme unusable is
 * text on its own ground, and the one that makes a button unusable is a label
 * on the accent — and the second is derived, so it is already as good as it can
 * be. This answers the first.
 *
 * The number is a lightness difference in OKLab rather than a WCAG ratio,
 * because OKLab lightness is already the question being asked and a ratio
 * computed from sRGB luminance disagrees with the eye on exactly the mid-tones
 * somebody is most likely to pick.
 */
export function isReadable(colors: Pick<ThemeColors, 'background' | 'text'>): boolean {
  const ground = lightnessOf(colors.background);
  const text = lightnessOf(colors.text);

  return ground !== null && text !== null && Math.abs(ground - text) >= 0.4;
}
