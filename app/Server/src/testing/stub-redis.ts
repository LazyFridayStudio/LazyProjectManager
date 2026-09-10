import type { Redis } from 'ioredis';

/**
 * A Redis that lives in this process.
 *
 * The server needs one for three things — publishing invalidation frames,
 * subscribing to them, and counting rate limits — and a test that had to run a
 * real Redis to sign in would be a test nobody runs. This does enough of all
 * three to drive the server through `inject`, in memory, per test.
 *
 * Written once here rather than per suite: there were seven copies of it, each
 * of which had to be found and taught the next method the server started using.
 */

interface Counter {
  count: number;
  /** When the window ends, in milliseconds since the epoch. */
  expiresAt: number;
}

/** What the rate limiter's store expects back: how many, and how long left. */
type RateLimitCallback = (error: Error | null, result: [number, number]) => void;

export interface StubRedis extends Redis {
  /**
   * The two commands the rate limiter defines as Lua on a real server.
   *
   * Declared here as well as implemented below, because `Redis` types an
   * unknown command as `any` — which would make every call to them in a test
   * unchecked.
   */
  rateLimit(
    key: string,
    timeWindow: number,
    max: number,
    continueExceeding: boolean,
    exponentialBackoff: boolean,
    callback: RateLimitCallback,
  ): void;
  rateLimitRead(key: string, callback: RateLimitCallback): void;

  /** What has been published, so a test can assert an invalidation went out. */
  readonly published: readonly { channel: string; message: string }[];
  /**
   * Empties it, as `truncateAllTables` empties the database.
   *
   * A suite that builds its server once and signs in per test would otherwise
   * spend the sign-in allowance on its eleventh test and fail every one after
   * it — which is the limiter working, in a place nobody meant to test it.
   */
  forgetEverything(): void;
}

export function createStubRedis(): StubRedis {
  const counters = new Map<string, Counter>();
  const published: { channel: string; message: string }[] = [];

  const stub = {
    published,
    forgetEverything: () => {
      counters.clear();
      published.length = 0;
    },
    ping: () => Promise.resolve('PONG'),
    on: () => stub,
    subscribe: () => Promise.resolve(0),
    publish: (channel: string, message: string) => {
      published.push({ channel, message });
      return Promise.resolve(1);
    },
    quit: () => Promise.resolve('OK'),
    disconnect: () => undefined,
    // Every connection is the same store, which is what a real Redis is.
    duplicate: () => stub,

    /**
     * The rate limiter defines its counters as Lua and calls them by name.
     *
     * Emulated rather than run: what the two scripts do is increment a key with
     * an expiry and read it back, and doing that in a Map is both shorter than
     * a Lua interpreter and enough for the limit to actually apply in a test.
     */
    defineCommand: () => undefined,

    // The order and count below are the rate limiter's calling convention.
    // eslint-disable-next-line max-params -- fixed by the caller, not by us
    rateLimit: (
      key: string,
      timeWindow: number,
      _max: number,
      _continueExceeding: boolean,
      _exponentialBackoff: boolean,
      callback: RateLimitCallback,
    ) => {
      const now = Date.now();
      const existing = counters.get(key);
      const counter =
        existing === undefined || existing.expiresAt <= now
          ? { count: 0, expiresAt: now + timeWindow }
          : existing;

      counter.count += 1;
      counters.set(key, counter);

      callback(null, [counter.count, Math.max(0, counter.expiresAt - now)]);
    },

    rateLimitRead: (key: string, callback: RateLimitCallback) => {
      const now = Date.now();
      const counter = counters.get(key);

      callback(
        null,
        counter === undefined || counter.expiresAt <= now
          ? [0, 0]
          : [counter.count, counter.expiresAt - now],
      );
    },
  };

  return stub as unknown as StubRedis;
}
