import { PROJECT_CODE_PATTERN } from './project-vocabulary.js';

/** Codes read best at four characters: long enough to tell apart, short enough to type. */
const SUGGESTED_CODE_LENGTH = 4;

/**
 * Proposes a project code from its name, for the create form to pre-fill.
 *
 * The rule is keep the first letter, drop the vowels, take four: "Example
 * Project" becomes EXMP and "Second Project" becomes SCND. It is a suggestion
 * and nothing more — the code is the root of every ticket key the project will
 * ever issue, so a person confirms it before it is written.
 *
 * Returns an empty string when the name yields nothing usable, which is the
 * field's way of asking to be filled in by hand. It lives here rather than on
 * the server because the suggestion has to appear as the name is typed.
 */
export function suggestProjectCode(projectName: string): string {
  const letters = projectName
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const candidate = removeVowelsAfterFirstLetter(letters).slice(0, SUGGESTED_CODE_LENGTH);

  // A name that is mostly vowels squeezes down to almost nothing, and the
  // unsqueezed name is a better suggestion than a two-letter stub.
  const suggestion =
    candidate.length >= SUGGESTED_CODE_LENGTH ? candidate : letters.slice(0, SUGGESTED_CODE_LENGTH);

  return PROJECT_CODE_PATTERN.test(suggestion) ? suggestion : '';
}

function removeVowelsAfterFirstLetter(letters: string): string {
  // The first letter is kept whatever it is, so "Iowa" still starts with an I.
  return letters.charAt(0) + letters.slice(1).replace(/[AEIOU]/g, '');
}
