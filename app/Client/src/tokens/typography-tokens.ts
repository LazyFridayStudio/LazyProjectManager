/**
 * Type tokens. The scale is fixed — density is expressed through spacing, never
 * by nudging a font size, so these eight values are the complete set the app may
 * use. A screen that reaches for an eighth is a screen that has stopped
 * agreeing with every other one.
 */

/*
 * One typeface, everywhere.
 *
 * Helvetica rather than a pair of downloaded families: this is a tool somebody
 * runs on their own machine, and a stylesheet that fetches its type from Google
 * is a screen that draws in the wrong font until a third party answers — or, on
 * a studio machine behind a firewall, never draws in the right one at all.
 *
 * Headings and body are still separate names for the same stack. What separates
 * a heading from a paragraph here is its size and its weight, and the two names
 * are the seam where that could stop being true without every stylesheet in the
 * app being edited to find out.
 */
const HELVETICA = 'Helvetica, "Helvetica Neue", Arial, sans-serif';

export const fontFamilies = {
  heading: HELVETICA,
  body: HELVETICA,
  /*
   * Not Helvetica: this is the one place the typeface is doing a job rather
   * than setting a tone. Ticket keys, ids and figures in a column line up
   * because every character is the same width, and setting them in a
   * proportional face is what makes a column of numbers stop being a column.
   */
  monospace: 'ui-monospace, Menlo, monospace',
} as const;

/**
 * The scale, in pixels.
 *
 * Every step is two larger than it started. This is a tool somebody reads all
 * day on a monitor at arm's length, and the scale it began with was taken from
 * a design drawn to be looked at rather than worked in — body text at fourteen
 * and a ten-pixel label are legible in a screenshot and tiring by four in the
 * afternoon.
 *
 * It was four for a version, and four was too much. The type got easier to read
 * and the screens got smaller: a board is a room full of controls with a fixed
 * budget of space, and every step spending more of it meant fewer cards in a
 * list and a sidebar that had to be narrowed to its icons to leave room for the
 * work. Two buys most of the legibility for a fraction of the room.
 *
 * A flat two on each step rather than a multiplier, which is the deliberate
 * part: it lifts the small end hardest, and the small end is where the reading
 * actually hurt. `micro` gains a fifth and `display` a twentieth, so the steps
 * sit closer together than they used to — a heading is a little less shouted
 * and a label a little less whispered, which is the trade being made.
 */
export const fontSizesPx = {
  /**
   * The subject of a panel that exists to show one thing.
   *
   * A card's title, where the whole dialog is that card. Nothing that shares a
   * screen with a sibling uses this.
   */
  display: 38,
  /**
   * The one thing a screen is about, and the only size that is bold.
   *
   * There was an `h1` at this size too, which meant every screen had two names
   * for its own title and picked whichever the last one had used — so the
   * launcher's was 24 and light, and the board's was 24 and bold. One name, one
   * decision: an `<h1>` is a title and gets this.
   */
  title: 26,
  h2: 20,
  h3: 18,
  /** Body text, controls, and anything not otherwise qualified. */
  base: 16,
  /** Secondary and meta text: hints, tile meta lines, filter chips. */
  small: 14,
  /** Uppercase micro-labels, and every monospace run — ticket keys and ids. */
  micro: 12,
} as const;

/** A title is bold; headings below it are not. Only the weight separates them. */
export const titleFontWeight = 700;
export const headingFontWeight = 600;
export const headingLineHeight = 1.2;
export const baseLineHeight = 1.5;
