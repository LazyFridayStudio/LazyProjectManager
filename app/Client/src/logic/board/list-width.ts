/**
 * How wide the board's columns are, as a number and the rules about it.
 *
 * The width is one person's preference and never leaves their machine, so
 * nothing here talks to the server. What it does hold is every decision about
 * the number — where it starts, how far it may go, and what a key press does to
 * it — in one place a test can reach without a browser.
 */

/**
 * What every board was until this could be changed.
 *
 * Kept as the value somebody returns to rather than as a lower bound: it is a
 * fine width and nobody's favourite, which is the whole reason for the setting.
 */
export const DEFAULT_LIST_WIDTH = 262;

/**
 * Narrow enough to fit twelve columns on a wide screen, and no narrower.
 *
 * Below about this a card's title wraps after two words and the board stops
 * being readable, which is a state somebody can drag themselves into and then
 * has to drag themselves back out of.
 */
export const NARROWEST_LIST_WIDTH = 180;

/** Wide enough for the longest asset name a studio has, and no wider. */
export const WIDEST_LIST_WIDTH = 520;

/** How far one arrow press moves the edge. */
const KEYBOARD_STEP = 16;

/** Holds a width inside what is useful, and to whole pixels. */
export function keepListWidthUsable(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_LIST_WIDTH;

  return Math.round(Math.min(Math.max(width, NARROWEST_LIST_WIDTH), WIDEST_LIST_WIDTH));
}

/**
 * What was in storage, or the default.
 *
 * Storage is a string somebody could have edited, an old value from a version
 * with different bounds, or missing entirely. All three answer the same way,
 * because a width that cannot be trusted is not worth a message about — the
 * board opens at the width everybody else's does and nothing is lost.
 */
export function readListWidth(stored: string | null): number {
  if (stored === null) return DEFAULT_LIST_WIDTH;

  const width = Number(stored);

  // `Number('')` is 0 and `Number(' ')` is 0, so an empty value would otherwise
  // clamp to the narrowest column rather than fall back.
  if (stored.trim() === '' || !Number.isFinite(width)) return DEFAULT_LIST_WIDTH;

  return keepListWidthUsable(width);
}

/**
 * What a key press does to the width, or `null` for a key this does not answer.
 *
 * `Home` is the way back to the default rather than the way to the narrowest.
 * A mouse gets that by pressing the edge twice; without it, somebody who
 * dragged to 301 could arrow in sixteens forever and never land on 262 again.
 */
export function listWidthAfterKey(width: number, key: string): number | null {
  if (key === 'ArrowLeft') return keepListWidthUsable(width - KEYBOARD_STEP);
  if (key === 'ArrowRight') return keepListWidthUsable(width + KEYBOARD_STEP);
  if (key === 'Home') return DEFAULT_LIST_WIDTH;
  if (key === 'End') return WIDEST_LIST_WIDTH;

  return null;
}
