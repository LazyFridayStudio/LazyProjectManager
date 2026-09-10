import type { ScmProvider } from '@lpm/shared';

/** Where GitHub's own API lives, as opposed to an Enterprise install's. */
const GITHUB_API = 'https://api.github.com';

/**
 * The API root for a connection.
 *
 * `endpoint` is where the forge is, which for an Enterprise install is a host
 * of the studio's own; GitHub's API lives somewhere other than its website, so
 * the two are not the same string and cannot be treated as one.
 *
 * A trailing slash is taken off, because every caller joins with one.
 */
export function resolveApiBaseUrl(provider: ScmProvider, endpoint: string | null): string {
  if (endpoint === null || endpoint.trim() === '') {
    return GITHUB_API;
  }

  const root = endpoint.trim().replace(/\/+$/, '');

  // GitHub Enterprise serves its API under `/api/v3`; a studio pastes the host
  // they visit, which is the one they know.
  return provider === 'github' && !root.endsWith('/api/v3') ? `${root}/api/v3` : root;
}
