/**
 * How often one caller may do one thing.
 *
 * Deliberately not one number for the whole API. The rate that protects a
 * password from being guessed would make the board unusable, and the rate the
 * board needs would let somebody try ten thousand passwords an hour — so the
 * limit is chosen per thing being asked for, and the reasoning for each sits
 * next to it.
 *
 * Pure, and keyed off the request path rather than off Fastify's parsed route,
 * so the policy can be read and tested as a string in and a decision out.
 */

export interface RateLimitPolicy {
  readonly max: number;
  readonly windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * What an ordinary signed-in session does.
 *
 * Generous, because a board that refetches on every invalidation frame is meant
 * to. This is here to stop a script, not to shape traffic.
 */
export const DEFAULT_POLICY: RateLimitPolicy = { max: 300, windowMs: MINUTE };

/**
 * Reads, which are counted together and are the bulk of everything.
 *
 * Four times the writes, for two reasons. One screen makes a dozen queries to
 * draw itself and refetches them all on every invalidation frame, so the ratio
 * of reads to writes is not close to even. The other is the address this is
 * counted against: behind a tunnel or an office router the whole studio arrives
 * as one, and a ceiling five people can reach between them is a ceiling that
 * refuses the sixth for doing nothing wrong.
 *
 * It is still a ceiling. What the limiter is really for — guessing a password,
 * claiming an install, minting upload URLs — is held far tighter than this and
 * separately, so raising the read allowance does not loosen any of it.
 */
const QUERY_POLICY: RateLimitPolicy = { max: 1200, windowMs: MINUTE };

/**
 * The commands worth guarding harder than the rest, and why.
 *
 * Every one of these is either reachable without a session or expensive to be
 * wrong about. Anything absent gets the default.
 */
const POLICY_BY_COMMAND: Readonly<Record<string, RateLimitPolicy>> = {
  // Guessing a password is the attack this whole file exists for. Ten tries a
  // quarter of an hour is far more than a person mistypes and far less than a
  // list is worth working through.
  'identity.signIn': { max: 10, windowMs: 15 * MINUTE },
  // Claiming an unclaimed install. It succeeds once, so anything past the first
  // few is somebody watching for a new install to take.
  'identity.completeSetup': { max: 5, windowMs: HOUR },
  // Each one signs a URL somebody can upload to. Enough for dragging in a
  // folder of art, not enough to mint them in bulk.
  'files.requestUpload': { max: 120, windowMs: MINUTE },
  // Connecting a repository writes a secret. Nobody does it twenty times an
  // hour except by mistake.
  'scm.connect': { max: 20, windowMs: HOUR },
};

/**
 * Files, which are now every picture on every screen.
 *
 * They used to be a redirect to the object store, so the browser counted one
 * request here and fetched the bytes somewhere else. Since #172 the bytes come
 * through this route, and a board of forty thumbnails is forty requests to it
 * — against an address that behind a tunnel is the whole studio.
 *
 * Its own bucket rather than a bigger default, so raising what a page of
 * pictures costs does not raise what anything else may do.
 */
const FILE_POLICY: RateLimitPolicy = { max: 1200, windowMs: MINUTE };

/**
 * The webhook, which is limited by connection rather than by address.
 *
 * A forge posts from a pool of addresses that changes, so limiting it by one
 * would either be useless or would refuse a legitimate delivery. Per connection
 * it bounds what any single repository can cost us.
 */
const WEBHOOK_POLICY: RateLimitPolicy = { max: 600, windowMs: MINUTE };

export interface RateLimitTarget {
  /** What is being counted, which becomes part of the key. */
  readonly bucket: string;
  readonly policy: RateLimitPolicy;
  /**
   * Whether the count is per caller address.
   *
   * False for the webhook: the caller there is a repository, identified by the
   * connection it posts to.
   */
  readonly perAddress: boolean;
}

const COMMAND_PREFIX = '/api/c/';
const QUERY_PREFIX = '/api/q/';
const FILE_PREFIX = '/api/f/';
const WEBHOOK_PREFIX = '/webhooks/scm/';

/**
 * Paths that are never limited.
 *
 * The health check is polled by the container runtime, and a health check that
 * gets a 429 is a container that restarts in a loop. The web client's own files
 * are cached immutably, and counting them would spend the budget on a page load
 * rather than on the API behind it.
 */
export function isRateLimited(path: string): boolean {
  const withoutQuery = readPath(path);

  return withoutQuery.startsWith('/api/') || withoutQuery.startsWith(WEBHOOK_PREFIX);
}

/** What this request counts against, and how much of it there is. */
export function readRateLimitTarget(path: string): RateLimitTarget {
  const withoutQuery = readPath(path);

  if (withoutQuery.startsWith(WEBHOOK_PREFIX)) {
    return {
      bucket: `hook:${withoutQuery.slice(WEBHOOK_PREFIX.length)}`,
      policy: WEBHOOK_POLICY,
      perAddress: false,
    };
  }

  if (withoutQuery.startsWith(FILE_PREFIX)) {
    // One bucket for all of them, reads and uploads together. Splitting would
    // give each its own budget, which is a larger total rather than a smaller.
    return { bucket: 'f', policy: FILE_POLICY, perAddress: true };
  }

  if (withoutQuery.startsWith(COMMAND_PREFIX)) {
    const name = withoutQuery.slice(COMMAND_PREFIX.length);

    return {
      bucket: `c:${name}`,
      policy: POLICY_BY_COMMAND[name] ?? DEFAULT_POLICY,
      perAddress: true,
    };
  }

  // Every query shares one bucket. They are reads a signed-in screen makes by
  // the dozen, and splitting them per name would give each one its own budget —
  // which is a larger total, not a smaller one.
  const isQuery = withoutQuery.startsWith(QUERY_PREFIX);

  return {
    bucket: isQuery ? 'q' : 'api',
    policy: isQuery ? QUERY_POLICY : DEFAULT_POLICY,
    perAddress: true,
  };
}

function readPath(path: string): string {
  return path.split('?')[0] ?? path;
}
