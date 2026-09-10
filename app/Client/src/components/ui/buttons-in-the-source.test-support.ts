import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every `<Button>` the client draws, read off the source.
 *
 * Two rules are held to this list — what colour a control is, and what mark it
 * carries — and they were reading the markup with two copies of the same parser
 * until this. One reader means the two rules cannot come to disagree about what
 * a button is or what it is called, which is the sort of drift that ends with a
 * rule quietly covering half of what it says it does.
 *
 * Read off the source rather than from a list somebody keeps up to date, so the
 * next Delete written anywhere in the client is caught the same way.
 */
const components = fileURLToPath(new URL('..', import.meta.url));

export interface FoundButton {
  /** Where it is, relative to `components`, with forward slashes. */
  readonly where: string;
  /** What it is called: its `aria-label` if it has one, otherwise its markup. */
  readonly label: string;
  /** What is between the tags, which is where a mark would be. */
  readonly inside: string;
  readonly isRed: boolean;
  readonly isGreen: boolean;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);

    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

/**
 * Where the opening tag actually ends.
 *
 * Not the first `>`, which on any button with a handler is the arrow inside
 * `onClick={() => {`. Counting braces is the whole difference between reading
 * the attributes and reading half of one.
 */
function endOfOpeningTag(text: string, from: number): number {
  let depth = 0;

  for (let index = from; index < text.length; index += 1) {
    const character = text[index];

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    } else if (character === '>' && depth === 0) {
      return index;
    }
  }

  return -1;
}

/**
 * `aria-label` wins over what is between the tags, because a button holding an
 * icon has its words there instead — a bin with `aria-label="Delete"` is a
 * Delete however little text it contains, and reading the markup inside it
 * would let exactly the loudest kind of button slip the rule by having no words
 * in it.
 */
export function buttons(): FoundButton[] {
  return sourceFiles(components).flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    const where = path.slice(components.length).replaceAll('\\', '/');
    const found: FoundButton[] = [];

    for (const match of text.matchAll(/<Button\b/g)) {
      const opens = endOfOpeningTag(text, match.index + '<Button'.length);
      const closes = text.indexOf('</Button>', opens);

      if (opens === -1 || closes === -1) {
        continue;
      }

      const attributes = text.slice(match.index, opens);
      const named = /aria-label="([^"]*)"/.exec(attributes);
      const inside = text
        .slice(opens + 1, closes)
        .split(/\s+/)
        .join(' ')
        .trim();

      found.push({
        where,
        label: named?.[1] ?? inside,
        inside,
        isRed: attributes.includes('tone="stop"'),
        isGreen: attributes.includes('tone="go"'),
      });
    }

    return found;
  });
}
