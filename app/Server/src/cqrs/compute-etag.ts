import { createHash } from 'node:crypto';

/**
 * Derives a strong ETag from a rendered view model.
 *
 * The board view is refetched on every WebSocket invalidation and is the largest
 * payload in the app, so letting an unchanged view answer 304 is the cheapest
 * bandwidth win available. Hashing the serialised view — rather than tracking
 * row versions — keeps that correct with no bookkeeping.
 */
export function computeEtag(view: unknown): string {
  const digest = createHash('sha1').update(serialiseForHashing(view)).digest('base64url');
  return `"${digest}"`;
}

/**
 * `JSON.stringify` is declared as returning `string` but actually returns
 * `undefined` for `undefined` input, which would throw inside `update()`. This
 * closes that gap rather than relying on a caller never passing one.
 */
function serialiseForHashing(view: unknown): string {
  return view === undefined ? 'undefined' : JSON.stringify(view);
}

/**
 * Whether the client already holds this exact view.
 *
 * `If-None-Match` may carry a comma-separated list, and a proxy is allowed to
 * weaken a tag by prefixing `W/`, so both are handled here rather than at the
 * call site.
 */
export function matchesClientEtag(ifNoneMatchHeader: string | undefined, etag: string): boolean {
  if (ifNoneMatchHeader === undefined) {
    return false;
  }

  return ifNoneMatchHeader
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .includes(etag);
}
