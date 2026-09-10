import { z } from 'zod';

/**
 * The colours a person picks, which is not the ninety the app draws with.
 *
 * `renderCssCustomProperties` emits around ninety custom properties and almost
 * all of them are derived — the text tones are percentages of the text colour,
 * the hairline is a percentage of the divider, the prose headings are three
 * steps of the accent ramp. What somebody actually chooses is the small set at
 * the root of that, and everything else follows for free. That is the payoff for
 * the token work: nothing in the client has to change for a theme to exist.
 *
 * **The three grounds are a rule, not three colours.** `background` → `panel` →
 * `surface`, each a step further from the ground, is how depth is read
 * everywhere in the app without a shadow. Three unrelated colours break that on
 * every screen at once, so one ground is chosen and the other two are derived.
 *
 * `textOnAccent` is not here either, for the reason the tokens already document:
 * dark puts `#242424` on its orange and light puts white on its, so a fixed
 * value gives somebody an unreadable button the moment they pick a pale accent.
 * It is worked out from the accent.
 */
export const themeColorsSchema = z.object({
  /** The ground everything sits on. Panel and surface are steps away from it. */
  background: hexColor(),
  text: hexColor(),
  accent: hexColor(),
  secondary: hexColor(),
  tertiary: hexColor(),
  danger: hexColor(),
  warning: hexColor(),
  success: hexColor(),
  /**
   * Whether the browser should draw its own controls dark or light.
   *
   * Asked rather than inferred, because `color-scheme` is what makes a
   * checkbox, a date picker and a scrollbar match — and the browser cannot work
   * it out from a hex. The panel offers what the ground suggests; this is the
   * answer, and somebody may disagree with the suggestion.
   */
  scheme: z.enum(['dark', 'light']),
});

export type ThemeColors = z.infer<typeof themeColorsSchema>;

/** `#rgb` or `#rrggbb`, which is how anybody writes one. */
function hexColor(): z.ZodString {
  return z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u, 'Write a colour as #rrggbb.');
}

/** The names in the order the panel asks for them. */
export const THEME_COLOR_NAMES = [
  'background',
  'text',
  'accent',
  'secondary',
  'tertiary',
  'danger',
  'warning',
  'success',
] as const satisfies readonly (keyof ThemeColors)[];

export type ThemeColorName = (typeof THEME_COLOR_NAMES)[number];
