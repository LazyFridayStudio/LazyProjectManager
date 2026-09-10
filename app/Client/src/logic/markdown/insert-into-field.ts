/** A blank line between what was there and what is being added, when one is needed. */
const PARAGRAPH_BREAK = '\n\n';

/**
 * Appends a block of markdown to a field.
 *
 * At the end rather than at the cursor: a file is dropped onto the box, not
 * into a position in it, and guessing where somebody meant it to go is how an
 * image lands in the middle of a sentence.
 */
export function appendBlock(existing: string, block: string): string {
  const needsBreak = existing !== '' && !existing.endsWith('\n');

  return `${existing}${needsBreak ? PARAGRAPH_BREAK : ''}${block}\n`;
}
