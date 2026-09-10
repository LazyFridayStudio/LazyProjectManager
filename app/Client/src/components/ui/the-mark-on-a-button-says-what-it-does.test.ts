import { describe, expect, it } from 'vitest';

import { buttons } from './buttons-in-the-source.test-support.js';

/**
 * A bin removes, a pencil edits, a plus adds.
 *
 * The sibling of the colour rule, and forgotten the same way. Colour says a
 * control is dangerous; the mark says what kind of dangerous, and it is the
 * half somebody reads first — a row of three buttons is recognised before it is
 * read, or it is read every time.
 *
 * Read off the source rather than from a list somebody keeps up to date, so the
 * next bare Delete written anywhere in the client is caught the same way.
 */

/**
 * The verb alone, not the sentence.
 *
 * A button whose whole label is the verb is a row action, repeated wherever its
 * row is, and the word on it is chrome. A button labelled with a verb and its
 * object — `Delete card`, `Create project`, `Remove team` — is nearly always
 * the primary in a dialog footer beside Cancel, and there the words are the
 * sentence saying what is about to happen. Taking those away would remove the
 * one thing a confirmation is for, so the rule deliberately stops at the verb.
 */
const MARK_FOR_VERB: Readonly<Record<string, string>> = {
  Add: 'PlusIcon',
  Edit: 'PencilIcon',
  Delete: 'TrashIcon',
  Remove: 'TrashIcon',
};

/**
 * What mark a label calls for, whether or not it is obliged to carry one.
 *
 * `Upload` adds a thing — a picture onto a sheet — so it takes the plus. It is
 * here rather than in the map above because the verb is not what the button
 * says, and a rule that reads the first word would have to be told about every
 * synonym a studio uses.
 */
const MARKS = [
  // `Put it back` adds a thing that was there before, which is what the bin's
  // whole promise is. `Upload` adds a picture to a sheet, and `New something`
  // makes one. None of them says the verb the map above is keyed on, which is
  // why the requirement reads bare labels and this reads a prefix.
  { verb: /^(Add|Upload|Put it back|Record|New)\b/, mark: 'PlusIcon' },
  { verb: /^Edit\b/, mark: 'PencilIcon' },
  { verb: /^(Delete|Remove)\b/, mark: 'TrashIcon' },
] as const;

const markFor = (label: string): string | undefined =>
  MARKS.find((entry) => entry.verb.test(label))?.mark;

const ALL_MARKS = ['PlusIcon', 'PencilIcon', 'TrashIcon'];

const marked = (): ReturnType<typeof buttons> =>
  buttons().filter((button) => MARK_FOR_VERB[button.label] !== undefined);

/** Every button that draws a mark, whatever its label is. */
const carryingAMark = (): ReturnType<typeof buttons> =>
  buttons().filter((button) => ALL_MARKS.some((mark) => button.inside.includes(`<${mark}`)));

describe('GIVEN the buttons of the web client', () => {
  describe('WHEN one of them is labelled with a bare verb', () => {
    it('THEN it carries the mark for that verb rather than the word', () => {
      const wrong = marked()
        .filter((button) => !button.inside.includes(`<${MARK_FOR_VERB[button.label] ?? ''}`))
        .map((button) => `${button.where}: ${button.label} is drawn as "${button.inside}"`);

      expect(wrong).toEqual([]);
    });

    it('THEN it still says its name, so it is not a mark nobody can read', () => {
      // The words move to `aria-label`, which is what a screen reader says and
      // what a hover shows. A button with a mark and no name is worse than the
      // word it replaced.
      const nameless = marked()
        .filter((button) => button.label === button.inside)
        .map((button) => button.where);

      expect(nameless).toEqual([]);
    });

    it('THEN there are some to check, so a sweep that found nothing fails', () => {
      expect(marked().length).toBeGreaterThan(0);
    });
  });

  describe('WHEN a button carries a mark at all', () => {
    it('THEN it is the mark for what the button does, whatever its label says', () => {
      // Wider than the rule that *requires* a mark. `Delete card` and `Upload`
      // are not obliged to carry one — they are not bare verbs — but a button
      // that does carry one has to carry the right one. A plus on a Delete is
      // worse than no mark at all: it is a mark that lies.
      const crossed = carryingAMark()
        .filter((button) => {
          const wanted = markFor(button.label);

          return wanted !== undefined && !button.inside.includes(`<${wanted}`);
        })
        .map((button) => `${button.where}: ${button.label} is drawn as "${button.inside}"`);

      expect(crossed).toEqual([]);
    });

    it('THEN there are some to check, so a sweep that found nothing fails', () => {
      expect(carryingAMark().length).toBeGreaterThan(0);
    });
  });
});
