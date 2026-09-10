import { describe, expect, it } from 'vitest';

import { DEFAULT_POLICY, isRateLimited, readRateLimitTarget } from './rate-limit-policy.js';

describe('GIVEN a request arriving at the server', () => {
  describe('WHEN it is for something worth counting', () => {
    it('THEN every API path is', () => {
      expect(isRateLimited('/api/c/identity.signIn')).toBe(true);
      expect(isRateLimited('/api/q/board.view?slug=saltmarsh')).toBe(true);
      expect(isRateLimited('/api/f/018f0000')).toBe(true);
      expect(isRateLimited('/webhooks/scm/018f0000')).toBe(true);
    });

    it('THEN the health check is not, because a 429 there restarts the container', () => {
      expect(isRateLimited('/health')).toBe(false);
    });

    it('THEN the web client is not, because its files are the page rather than the API', () => {
      expect(isRateLimited('/')).toBe(false);
      expect(isRateLimited('/assets/index-4hGL3.css')).toBe(false);
      expect(isRateLimited('/p/saltmarsh')).toBe(false);
    });
  });

  describe('WHEN it is a command', () => {
    it('THEN it counts against its own name, not against every command at once', () => {
      // Otherwise a busy board would spend the budget that guards sign-in.
      expect(readRateLimitTarget('/api/c/board.moveCard').bucket).toBe('c:board.moveCard');
      expect(readRateLimitTarget('/api/c/identity.signIn').bucket).toBe('c:identity.signIn');
    });

    it('THEN signing in is held to far fewer tries than anything else', () => {
      const signIn = readRateLimitTarget('/api/c/identity.signIn').policy;

      expect(signIn.max).toBeLessThan(DEFAULT_POLICY.max);
      // Over a long enough window that a list is not worth working through.
      expect(signIn.windowMs).toBeGreaterThan(DEFAULT_POLICY.windowMs);
    });

    it('THEN claiming an install is held tighter still', () => {
      expect(readRateLimitTarget('/api/c/identity.completeSetup').policy.max).toBeLessThanOrEqual(
        readRateLimitTarget('/api/c/identity.signIn').policy.max,
      );
    });

    it('THEN a command nobody has singled out gets the ordinary allowance', () => {
      expect(readRateLimitTarget('/api/c/board.createCard').policy).toEqual(DEFAULT_POLICY);
    });
  });

  describe('WHEN it is a query', () => {
    it('THEN they share one allowance between them', () => {
      // Splitting them per name would give each its own budget, which is a
      // larger total rather than a smaller one.
      expect(readRateLimitTarget('/api/q/board.view').bucket).toBe('q');
      expect(readRateLimitTarget('/api/q/board.cardDetail').bucket).toBe('q');
    });

    it('THEN its parameters are not part of what it counts against', () => {
      expect(readRateLimitTarget('/api/q/board.view?slug=a').bucket).toBe(
        readRateLimitTarget('/api/q/board.view?slug=b').bucket,
      );
    });

    it('THEN reading is allowed more often than writing, because screens read by the dozen', () => {
      /*
       * A studio behind one address shares this. One screen draws itself with a
       * dozen queries and refetches them all on every invalidation frame, so a
       * ceiling shared with writes is one a few people reach between them — and
       * the person who reaches it did nothing but open a page.
       */
      expect(readRateLimitTarget('/api/q/board.view').policy.max).toBeGreaterThan(
        DEFAULT_POLICY.max,
      );
    });

    it('THEN the tighter limits are untouched by that, because they guard something else', () => {
      const reads = readRateLimitTarget('/api/q/board.view').policy.max;

      // Guessing a password is what the limiter is really for, and it is held
      // to ten tries a quarter of an hour whatever a screen is allowed to read.
      expect(readRateLimitTarget('/api/c/identity.signIn').policy.max).toBeLessThan(reads);
      expect(readRateLimitTarget('/api/c/files.requestUpload').policy.max).toBeLessThan(reads);
    });
  });

  describe('WHEN it is a delivery from a repository', () => {
    it('THEN it counts against the connection rather than the address it came from', () => {
      // A forge posts from a pool of addresses that changes, so limiting it by
      // one would either be useless or refuse a legitimate delivery.
      const target = readRateLimitTarget('/webhooks/scm/018f0000-0000-7000-8000-000000000000');

      expect(target.perAddress).toBe(false);
      expect(target.bucket).toBe('hook:018f0000-0000-7000-8000-000000000000');
    });

    it('THEN two repositories do not share an allowance', () => {
      expect(readRateLimitTarget('/webhooks/scm/one').bucket).not.toBe(
        readRateLimitTarget('/webhooks/scm/two').bucket,
      );
    });
  });

  describe('WHEN it is anything else on the API', () => {
    it('THEN it is counted per address, like the rest', () => {
      expect(readRateLimitTarget('/api/f/018f0000').perAddress).toBe(true);
    });
  });
});
