import { CARD_SEQUENCE_PREFIXES } from '@lpm/shared';

/**
 * Finds the cards a piece of writing is about.
 *
 * A commit message is prose, not a form. People write `LPMT-ART-12`, `fixes
 * lpmt-bug-3`, and both in the same paragraph — so this reads the whole text and
 * takes every key it finds, rather than looking only where a convention says one
 * ought to be.
 *
 * Scoped to one project's code on purpose. A repository can be mentioned in
 * another project's ticket, and a key that is not this project's is not this
 * project's card.
 */

/**
 * A key is the project code, a type, and a number.
 *
 * The number is what keeps `LPMT-TASK` out — that is a label somebody wrote, not
 * a card. The word boundaries keep `XLPMT-ART-1` and `LPMT-ART-1a` out too:
 * a key that is part of a longer token is a different token.
 */
function buildPattern(projectCode: string): RegExp {
  return new RegExp(
    String.raw`\b${escapeForRegExp(projectCode)}-(?:${CARD_SEQUENCE_PREFIXES.join('|')})-\d+\b`,
    'gi',
  );
}

/**
 * Every card key in the text, uppercased and in the order it first appears.
 *
 * Deduplicated because a message that names the same card twice is one link, not
 * two — and ordered because the first key mentioned is usually the subject.
 */
export function findCardKeys(text: string, projectCode: string): readonly string[] {
  if (text === '' || projectCode === '') {
    return [];
  }

  const found = new Set<string>();

  for (const match of text.matchAll(buildPattern(projectCode))) {
    found.add(match[0].toUpperCase());
  }

  return [...found];
}

function escapeForRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
