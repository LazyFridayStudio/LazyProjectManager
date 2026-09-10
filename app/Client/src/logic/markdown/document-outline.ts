/**
 * A heading in a document, and the anchor that reaches it.
 *
 * Levels one to three. Deeper than that is a heading nobody navigates by, and a
 * contents list with five levels of indent is one nobody reads.
 */
export interface OutlineEntry {
  readonly level: 1 | 2 | 3;
  readonly text: string;
  /** The `id` on the heading, which is what a link scrolls to. */
  readonly slug: string;
}

export interface RenderedDocument {
  readonly html: string;
  readonly outline: readonly OutlineEntry[];
}

const OUTLINE_LEVELS = 'h1, h2, h3';

/**
 * Puts an anchor on every heading, and reads the contents list off the same
 * pass.
 *
 * One pass rather than two: an outline built by re-reading the markdown would
 * have to guess at what the renderer made of `## **Bold** heading`, and the
 * first time it guessed differently the contents list would scroll to nothing.
 * Taking both from the rendered document makes disagreeing impossible.
 */
export function readOutline(html: string): RenderedDocument {
  const container = document.createElement('div');
  container.innerHTML = html;

  const taken = new Map<string, number>();
  const outline: OutlineEntry[] = [];

  for (const heading of container.querySelectorAll(OUTLINE_LEVELS)) {
    const text = heading.textContent.trim();

    if (text === '') continue;

    const slug = uniqueSlug(text, taken);

    heading.setAttribute('id', slug);
    outline.push({ level: levelOf(heading.tagName), text, slug });
  }

  return { html: container.innerHTML, outline };
}

function levelOf(tagName: string): 1 | 2 | 3 {
  if (tagName === 'H1') return 1;

  return tagName === 'H2' ? 2 : 3;
}

/**
 * A readable anchor, and never the same one twice.
 *
 * Two sections called "Overview" is normal in a long document, and the second
 * one has to be reachable — so a repeat gets a number rather than quietly
 * pointing at the first.
 */
function uniqueSlug(text: string, taken: Map<string, number>): string {
  const base = slugify(text);
  const seen = taken.get(base) ?? 0;

  taken.set(base, seen + 1);

  return seen === 0 ? base : `${base}-${String(seen + 1)}`;
}

/** Lower case, words joined by hyphens, and nothing that needs escaping. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  // A heading of nothing but punctuation still needs somewhere to point.
  return slug === '' ? 'section' : slug;
}
