import { slugify } from '../text/slugify.js';

const MAXIMUM_PROJECT_SLUG_LENGTH = 90;
const SLUG_FALLBACK = 'project';

/** The address a project is opened at: "Harbour Night" becomes `harbour-night`. */
export function deriveProjectSlug(projectName: string): string {
  return slugify(projectName, {
    fallback: SLUG_FALLBACK,
    maximumLength: MAXIMUM_PROJECT_SLUG_LENGTH,
  });
}

/**
 * Resolves a slug already taken by another project in the same account.
 *
 * Appends the code rather than a counter, because the code is unique within the
 * account and so this always succeeds on the first try — and `kiln-kiln2` still
 * tells you which project you are looking at, where `kiln-2` does not.
 */
export function disambiguateProjectSlug(slug: string, code: string): string {
  const suffix = `-${code.toLowerCase()}`;

  return `${slug.slice(0, MAXIMUM_PROJECT_SLUG_LENGTH - suffix.length)}${suffix}`;
}
