import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ScmProvider } from '@lpm/shared';

/**
 * Decides whether a delivery really came from the repository it claims to.
 *
 * The whole webhook endpoint is unauthenticated — it has to be, because a forge
 * has no session — so this is the only thing standing between the repository and
 * anybody who knows the URL. Everything else about the request is attacker
 * controlled, including the body.
 *
 * Compared in constant time. A byte-at-a-time comparison leaks how much of a
 * guess was right, which is enough to find the rest one byte at a time.
 */

/** GitHub and Gitea both sign the body; GitLab sends the secret back verbatim. */
const SIGNATURE_HEADERS = {
  github: 'x-hub-signature-256',
  gitea: 'x-hub-signature-256',
  gitlab: 'x-gitlab-token',
} as const satisfies Record<ScmProvider, string>;

const SIGNATURE_PREFIX = 'sha256=';

export interface DeliveryProof {
  readonly provider: ScmProvider;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The bytes as they arrived, before anything parsed them. */
  readonly body: Buffer;
  readonly secret: string;
}

export function isDeliveryAuthentic({ provider, headers, body, secret }: DeliveryProof): boolean {
  const offered = readHeader(headers, SIGNATURE_HEADERS[provider]);

  if (offered === null) {
    return false;
  }

  return provider === 'gitlab'
    ? matches(offered, secret)
    : matches(
        offered,
        `${SIGNATURE_PREFIX}${createHmac('sha256', secret).update(body).digest('hex')}`,
      );
}

/** What the provider called this delivery: `push`, `pull_request`, and so on. */
export function readEventName(
  provider: ScmProvider,
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  return readHeader(headers, provider === 'gitlab' ? 'x-gitlab-event' : 'x-github-event');
}

/**
 * The provider's own id for this delivery, which is what makes a retry safe.
 *
 * GitLab does not send one, so its deliveries are identified by what they say
 * instead — see `readDeliveryId` in the route, which falls back to a digest of
 * the body.
 */
export function readDeliveryId(
  provider: ScmProvider,
  headers: Readonly<Record<string, string | string[] | undefined>>,
): string | null {
  return readHeader(headers, provider === 'gitlab' ? 'x-gitlab-event-uuid' : 'x-github-delivery');
}

function readHeader(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | null {
  const value = headers[name];

  if (Array.isArray(value)) {
    // A header sent twice is a header somebody is playing with.
    return null;
  }

  return value === undefined || value === '' ? null : value;
}

function matches(offered: string, expected: string): boolean {
  const left = Buffer.from(offered, 'utf8');
  const right = Buffer.from(expected, 'utf8');

  // `timingSafeEqual` throws on a length mismatch, and the length of a signature
  // is not a secret.
  return left.length === right.length && timingSafeEqual(left, right);
}
