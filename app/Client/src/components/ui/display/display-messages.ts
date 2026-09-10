/**
 * The list of messages on screen, and the rules for what happens to it.
 *
 * Pure, and separate from the React that renders it, because these are the
 * parts worth being sure about: that a loop reporting the same failure fifty
 * times does not bury the screen, and that the newest message is the one
 * somebody sees.
 */

/**
 * What kind of thing is being said.
 *
 * Three, and the three a person already knows how to read: something worth
 * knowing, something worth looking at, and something that went wrong. Any
 * further tone anybody invents turns out to be one of these wearing a different
 * colour, which is why there is no fourth.
 *
 * The order matters as much as the count — a warning is not a small error, it
 * is a thing that worked and might not have been what you meant.
 */
export type DisplayTone = 'info' | 'warning' | 'error';

export interface DisplayMessage {
  readonly id: string;
  readonly tone: DisplayTone;
  readonly text: string;
}

/**
 * How many are shown at once.
 *
 * A cap rather than a scroll. Something failing in a loop should not be able to
 * take the screen, and nobody reads the fourth message in a stack anyway.
 */
export const MAXIMUM_SHOWN = 3;

/**
 * How long each kind stays before it goes on its own, in milliseconds.
 *
 * Longer the worse it is: an error has to be read and probably acted on, a
 * warning has to be read, and a note has already done its job by appearing.
 */
const LIFETIME_BY_TONE: Readonly<Record<DisplayTone, number>> = {
  error: 10_000,
  warning: 8_000,
  info: 6_000,
};

export function lifetimeOf(tone: DisplayTone): number {
  return LIFETIME_BY_TONE[tone];
}

/**
 * Adds a message, and keeps the list to its cap.
 *
 * The same words said twice replace the first rather than stacking under it:
 * dropping four source files onto the reference sheet is one thing that
 * happened, not four, and four identical lines would read as a fault in the
 * product rather than a note about the drop.
 *
 * Replacing puts it at the end, so its life starts again — which is what makes
 * a repeated message stay on screen while it keeps happening.
 */
export function addMessage(
  shown: readonly DisplayMessage[],
  message: DisplayMessage,
): readonly DisplayMessage[] {
  const withoutRepeat = shown.filter(
    (other) => other.text !== message.text || other.tone !== message.tone,
  );

  return [...withoutRepeat, message].slice(-MAXIMUM_SHOWN);
}

export function dismissMessage(
  shown: readonly DisplayMessage[],
  id: string,
): readonly DisplayMessage[] {
  return shown.filter((message) => message.id !== id);
}
