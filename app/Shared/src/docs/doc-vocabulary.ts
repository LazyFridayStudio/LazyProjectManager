import { z } from 'zod';

/**
 * What a document is called.
 *
 * Long enough for "Audio bible — second pass", short enough that a tab stays a
 * tab. Named rather than written into the schema because an import has to cut a
 * title down to the same length, and two numbers that must agree should be one.
 */
export const DOCUMENT_TITLE_LIMIT = 80;

export const docTitleSchema = z
  .string()
  .trim()
  .min(1, 'Name the document.')
  .max(DOCUMENT_TITLE_LIMIT);

/**
 * The markdown a document holds.
 *
 * Generous, because this is a whole document rather than a field on a form: one
 * that hits a ceiling mid-sentence is one somebody keeps somewhere else instead.
 */
export const docBodySchema = z.string().max(400_000);

/** An empty document is one nobody has written in yet. */
export const EMPTY_DOCUMENT = '';

/**
 * Roughly how long a document is.
 *
 * Runs of non-space, which counts markdown punctuation as part of the word it
 * is attached to and a bare `##` as one. Close enough for a line under a title,
 * and nobody has ever checked one of these against a word processor.
 */
export function countWords(body: string): number {
  const words = body.trim().split(/\s+/u);

  return words.length === 1 && words[0] === '' ? 0 : words.length;
}

/** A file with no name to take a title from, and no heading to take one from. */
const UNTITLED = 'Imported document';

const FIRST_HEADING = /^#\s+(.+?)\s*#*\s*$/mu;

/**
 * The title to give a document read out of a file.
 *
 * Its own first `# ` heading wins. A design document that opens by naming
 * itself has said what it is called better than `gdd_FINAL_v3(2).md` ever will,
 * and that is the line a person would have copied into the box by hand.
 *
 * The file name is the fallback, with its dashes and underscores read as the
 * spaces they were standing in for. Cut to the length a tab can hold, because
 * the alternative is an import refused for a title nobody typed.
 */
export function titleFromMarkdown(fileName: string, body: string): string {
  const heading = FIRST_HEADING.exec(body)?.[1]?.trim() ?? '';
  const fromName = fileName
    .replace(/\.[^.]*$/u, '')
    .replace(/[-_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  const chosen = heading !== '' ? heading : fromName;

  return (chosen === '' ? UNTITLED : chosen).slice(0, DOCUMENT_TITLE_LIMIT).trim();
}

/**
 * What a document is called once it is a file on somebody's disk.
 *
 * Only letters and digits survive, which is what makes the name safe to write
 * on every filesystem this might be downloaded onto rather than only the one it
 * was tested on. A title that leaves nothing behind — one written entirely in a
 * script this reduction does not speak — still gets a file rather than a name
 * that begins with a dot.
 */
export function markdownFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return `${slug === '' ? 'document' : slug}.md`;
}

/** What a document is called before anybody has decided what it is. */
export const NEW_DOCUMENT_NAME = 'New doc';

/**
 * The name to give a document nobody has named.
 *
 * `New doc`, then `New doc 2`, then `New doc 3` — the same numbering the
 * document outline gives two headings that read alike, because a name that
 * repeats is a tab nobody can pick out of a row.
 *
 * The first one is bare rather than `New doc 1`. A studio with one unnamed
 * document is not counting them yet.
 *
 * Worked out from what is already there rather than from how many there are:
 * a project whose second document was renamed has `New doc` free again, and
 * skipping to `New doc 3` would be counting things nobody can see.
 */
export function nextDocumentName(taken: readonly string[]): string {
  const used = new Set(taken.map((title) => title.trim().toLowerCase()));

  if (!used.has(NEW_DOCUMENT_NAME.toLowerCase())) {
    return NEW_DOCUMENT_NAME;
  }

  let ordinal = 2;

  while (used.has(`${NEW_DOCUMENT_NAME} ${String(ordinal)}`.toLowerCase())) {
    ordinal += 1;
  }

  return `${NEW_DOCUMENT_NAME} ${String(ordinal)}`;
}
