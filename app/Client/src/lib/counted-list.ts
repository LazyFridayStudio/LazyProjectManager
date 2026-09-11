/**
 * How many of something there are, in words — or null for none.
 *
 * Null rather than "0 comments", because a sentence saying what goes with a
 * thing leaves out what is not there rather than listing it.
 */
export function countOf(many: number, one: string, several: string): string | null {
  return many === 0 ? null : `${String(many)} ${many === 1 ? one : several}`;
}

/** `a`, `a and b`, `a, b and c`. */
export function asList(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0] ?? '';

  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}
