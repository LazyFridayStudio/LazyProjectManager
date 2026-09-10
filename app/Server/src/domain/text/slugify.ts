/**
 * Turns a name into a URL-safe slug.
 *
 * Deliberately lossy in a predictable way: two things with the same name produce
 * the same slug, and the caller resolves the collision with something meaningful
 * rather than this function silently inventing a number.
 */
export function slugify(value: string, options: SlugifyOptions): string {
  const slug = value
    .normalize('NFKD')
    // Strip diacritics so "Ötzi" becomes "otzi" rather than losing the vowel.
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, options.maximumLength)
    // Slicing can leave a trailing separator behind.
    .replace(/-+$/, '');

  return slug === '' ? options.fallback : slug;
}

export interface SlugifyOptions {
  /** Used when the name has no characters a URL can carry, such as "★★★". */
  readonly fallback: string;
  readonly maximumLength: number;
}
