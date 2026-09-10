import { describe, expect, it } from 'vitest';

import { createStubRedis } from './stub-redis.js';

/**
 * The rate limiter's Redis store calls these two by name, having defined them as
 * Lua on a real server. The stub answers them in memory instead, so the limit
 * actually applies in a test — and if this contract ever drifts, it fails here
 * rather than as every suite quietly losing its limits.
 */
describe('GIVEN the Redis the tests run against', () => {
  describe('WHEN the rate limiter counts a request', () => {
    it('THEN each call comes back one higher, with the window it has left', () => {
      const redis = createStubRedis();
      const seen: [number, number][] = [];
      const record = (_error: Error | null, result: [number, number]): void => {
        seen.push(result);
      };

      redis.rateLimit('k', 1000, 5, false, false, record);
      redis.rateLimit('k', 1000, 5, false, false, record);

      expect(seen.map(([count]) => count)).toEqual([1, 2]);
      expect(seen[0]?.[1]).toBeGreaterThan(0);
    });

    it('THEN two keys are counted apart', () => {
      const redis = createStubRedis();
      let left = 0;
      let right = 0;

      redis.rateLimit('left', 1000, 5, false, false, (_error, [count]) => (left = count));
      redis.rateLimit('left', 1000, 5, false, false, (_error, [count]) => (left = count));
      redis.rateLimit('right', 1000, 5, false, false, (_error, [count]) => (right = count));

      expect([left, right]).toEqual([2, 1]);
    });

    it('THEN reading it does not count as a request', () => {
      const redis = createStubRedis();
      let read = -1;

      redis.rateLimit('k', 1000, 5, false, false, () => undefined);
      redis.rateLimitRead('k', (_error, [count]) => (read = count));

      expect(read).toBe(1);
    });

    it('THEN a key nothing has touched reads as a clean slate', () => {
      const redis = createStubRedis();
      let read = -1;

      redis.rateLimitRead('never', (_error, result) => (read = result[0]));

      expect(read).toBe(0);
    });

    it('THEN forgetting everything starts the counting again', () => {
      const redis = createStubRedis();
      let count = 0;

      redis.rateLimit('k', 1000, 5, false, false, () => undefined);
      redis.forgetEverything();
      redis.rateLimit('k', 1000, 5, false, false, (_error, result) => (count = result[0]));

      expect(count).toBe(1);
    });
  });
});
