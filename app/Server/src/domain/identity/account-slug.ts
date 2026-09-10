import { slugify } from '../text/slugify.js';

const MAXIMUM_SLUG_LENGTH = 60;

/**
 * Turns a studio name into a URL-safe slug.
 *
 * `account.slug` is unique, so this is deliberately lossy in a predictable way:
 * two studios called "Northwind" collide, and the caller resolves that by
 * appending a discriminator rather than this function inventing one silently.
 */
export function deriveAccountSlug(accountName: string): string {
  return slugify(accountName, { fallback: 'studio', maximumLength: MAXIMUM_SLUG_LENGTH });
}
