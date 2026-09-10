/**
 * The colours somebody can put on a thing they made.
 *
 * A list's bar, a category's dot — the colours that are *content* rather than
 * chrome, chosen by a studio and stored in the database beside the thing they
 * belong to. They are not theme tokens: nothing in the app is drawn in them
 * unless somebody picked them.
 *
 * There were two lists of these, one on the board and one in the library, and
 * they had already drifted — amber was offered for a list and never for a
 * category, purple for a category and never for a list. One list, offered by
 * everything that asks the question.
 *
 * **Grey first, then round the wheel.** Grey is what a thing starts as, so it
 * is where the eye starts; after that the order is the order a rainbow runs in,
 * because a grid of sixteen colours is scanned rather than read and hue is the
 * only ordering anybody can follow without a legend.
 *
 * They sit at one tone — roughly three-quarters saturated, two-thirds light —
 * which is the tone the six originals were drawn at. That is what keeps them
 * legible on both themes at once, and it is the reason this is a list rather
 * than a wheel: a colour picked at any lightness is a category somebody cannot
 * see on the screen it exists for. Anything outside the list is still reachable
 * — `ColorPicker` offers the browser's own picker beside them — but it is a
 * deliberate step off the path rather than the first thing on offer.
 */
export interface PickableColor {
  /** Lower-case six-digit hex, which is what the command schemas accept. */
  readonly value: string;
  /** What it is called out loud, which is what a screen reader says. */
  readonly name: string;
}

export const PICKABLE_COLORS: readonly PickableColor[] = [
  { value: '#adadad', name: 'Grey' },
  { value: '#eb7d73', name: 'Red' },
  { value: '#eda363', name: 'Orange' },
  { value: '#cf9556', name: 'Amber' },
  { value: '#f0de8a', name: 'Yellow' },
  { value: '#d8e873', name: 'Olive' },
  { value: '#b1e873', name: 'Lime' },
  { value: '#63eba3', name: 'Green' },
  { value: '#73e8d1', name: 'Teal' },
  { value: '#73d5e8', name: 'Cyan' },
  { value: '#63aeeb', name: 'Blue' },
  { value: '#7382e8', name: 'Indigo' },
  { value: '#9e73e8', name: 'Violet' },
  { value: '#c79bf0', name: 'Purple' },
  { value: '#e873e8', name: 'Magenta' },
  { value: '#e873a2', name: 'Pink' },
];

/**
 * What a thing is drawn in until somebody chooses otherwise.
 *
 * Grey, and read off the head of the list rather than written down again, so
 * the default cannot become a colour the picker does not offer.
 */
export const DEFAULT_PICKABLE_COLOR = PICKABLE_COLORS[0]?.value ?? '#adadad';

/**
 * The name of a colour, or the hex itself when it is one somebody mixed.
 *
 * What a swatch is called out loud. "Teal" is a colour; `#3f7d5a` is a colour
 * too, and reading the six digits is better than calling it "custom" — two
 * things somebody mixed would then have the same name.
 */
export function nameOfPickableColor(value: string): string {
  const known = PICKABLE_COLORS.find((color) => color.value === value.toLowerCase());

  return known?.name ?? value.toLowerCase();
}

/** Whether a colour is one of the offered ones, rather than one somebody mixed. */
export function isAPickableColor(value: string): boolean {
  return PICKABLE_COLORS.some((color) => color.value === value.toLowerCase());
}
