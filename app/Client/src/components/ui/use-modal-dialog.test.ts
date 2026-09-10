import { describe, expect, it } from 'vitest';

import { isAPressOnTheBackdrop } from './use-modal-dialog.js';

/**
 * Stand-ins for the things a press can land on.
 *
 * Identity is the whole question — the rule compares targets against the dialog
 * element and never reads anything off them — so plain objects say it without a
 * document to hang them in.
 */
const dialog = {} as HTMLDialogElement;
const textField = {} as EventTarget;
const button = {} as EventTarget;

describe('GIVEN a modal dialog somebody is clicking around', () => {
  describe('WHEN they press the backdrop and let go on it', () => {
    it('THEN it closes, which is what pressing beside a dialog means', () => {
      expect(isAPressOnTheBackdrop(dialog, dialog, dialog)).toBe(true);
    });
  });

  describe('WHEN they press inside it and let go over the backdrop', () => {
    it('THEN it stays open, because the press says where they meant to click', () => {
      // Selecting the text in a field and running past the edge of the dialog
      // arrives here as a click reported against the dialog itself, and used to
      // throw the form away mid-sentence.
      expect(isAPressOnTheBackdrop(dialog, textField, dialog)).toBe(false);
    });
  });

  describe('WHEN both ends are inside it', () => {
    it('THEN it stays open', () => {
      expect(isAPressOnTheBackdrop(dialog, button, button)).toBe(false);
    });
  });

  describe('WHEN the click arrives with no press behind it', () => {
    it('THEN it stays open, so a keyboard cannot inherit an earlier press', () => {
      expect(isAPressOnTheBackdrop(dialog, null, dialog)).toBe(false);
    });
  });

  describe('WHEN the dialog is not on the screen any more', () => {
    it('THEN there is nothing to close', () => {
      expect(isAPressOnTheBackdrop(null, null, null)).toBe(false);
    });
  });
});
