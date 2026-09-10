import { describe, expect, it } from 'vitest';

import { buttons } from './buttons-in-the-source.test-support.js';

/**
 * A button that takes something away is red, and one that makes something is
 * green.
 *
 * The convention is easy to state and easy to forget: red for anything that
 * removes, refuses or abandons; green for anything that makes or saves; the
 * accent for the ones that do neither — Close, Done, Edit, Load more. The
 * forgetting shows up as a Delete that looks exactly like a Save, which is the
 * mistake worth making impossible.
 *
 * What each button is called comes from `buttons-in-the-source`, which the mark
 * rule reads too — so the two cannot come to disagree about what a button is.
 */

/**
 * Words that mean something is going away.
 *
 * `Revoke` stops a key working, which is taking it away from whatever was
 * using it.
 * `Remove` covers `Remove team`, `Remove list`, `Remove credentials`. `Clear`
 * is the lead being taken off a team, `Take out` is leaving a team and
 * `Take off` is leaving a project. Deliberately not `Close` or `Done`:
 * those end a dialog rather than doing anything.
 */
const TAKES_SOMETHING_AWAY =
  /^(Cancel|Delete|Remove|Revoke|Disconnect|Suspend|Take out|Take off|Take away|Clear|Stop being)\b/;

/**
 * Words that mean something is being made or kept.
 *
 * `Log` is one of them: logging an afternoon writes a row that was not there,
 * and it is what a studio calls the act — `Record work` would be this rule
 * choosing the product's words for it.
 *
 * Deliberately not `Choose`: a file picker opens a dialog and writes nothing.
 * Deliberately not `Copy`: it puts something on the clipboard.
 */
const MAKES_SOMETHING =
  /^(Add|Create|Make|New|Save|Record|Log|Connect|Upload|Comment|Sign in|Put it back|Put under|Let back in|Restore|Change password|Reset password|Check and save)\b/;

/**
 * The files these rules do not reach, and why each is out.
 *
 * A short list that has to be argued for beats a rule with holes in it.
 */
const NOT_RED: Readonly<Record<string, string>> = {
  'assets/AssetLibraryScreen.tsx':
    'Clear all filters loses nothing — it puts the library back to showing everything.',
  'ui/display/Asking.tsx':
    'Its Cancel is the safe way out of a destroy confirmation, not the destruction.',
};

describe('GIVEN the buttons of the web client', () => {
  describe('WHEN one of them takes something away', () => {
    it('THEN it is red', () => {
      const wrong = buttons().filter(
        (button) =>
          TAKES_SOMETHING_AWAY.test(button.label) &&
          !button.isRed &&
          NOT_RED[button.where] === undefined,
      );

      expect(wrong).toEqual([]);
    });

    it('THEN there are some to check, so a sweep that found nothing fails', () => {
      expect(buttons().filter((button) => button.isRed).length).toBeGreaterThan(0);
    });
  });

  describe('WHEN one of them makes or saves something', () => {
    it('THEN it is green', () => {
      const wrong = buttons().filter(
        (button) =>
          MAKES_SOMETHING.test(button.label) &&
          !button.isGreen &&
          NOT_RED[button.where] === undefined,
      );

      expect(wrong).toEqual([]);
    });
  });

  describe('WHEN one of them does neither', () => {
    it('THEN it is left the accent, so the other two still mean something', () => {
      const shouting = buttons().filter(
        (button) =>
          (button.isRed || button.isGreen) &&
          !TAKES_SOMETHING_AWAY.test(button.label) &&
          !MAKES_SOMETHING.test(button.label) &&
          !button.label.startsWith('{') &&
          NOT_RED[button.where] === undefined,
      );

      expect(shouting).toEqual([]);
    });
  });
});
