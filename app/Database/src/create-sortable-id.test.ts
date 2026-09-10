import { describe, expect, it } from 'vitest';

import { createSortableId } from './create-sortable-id.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('GIVEN an identifier generated for a domain event', () => {
  describe('WHEN one is created', () => {
    it('THEN it is a well-formed UUID with version 7 and the RFC 4122 variant', () => {
      expect(createSortableId()).toMatch(UUID_PATTERN);
    });
  });

  describe('WHEN several are created at different times', () => {
    it('THEN sorting them by text puts them back in creation order', () => {
      const early = createSortableId(1_700_000_000_000);
      const middle = createSortableId(1_700_000_001_000);
      const late = createSortableId(1_800_000_000_000);

      // The worker drains the outbox in id order, so this ordering is the
      // property the whole scheme exists for.
      expect([late, early, middle].sort()).toEqual([early, middle, late]);
    });
  });

  describe('WHEN the timestamp exceeds what fits in 32 bits', () => {
    it('THEN it still sorts after an earlier id, and stays well-formed', () => {
      // 48 bits of milliseconds runs to the year 10889. Shifting with `>>>`
      // would wrap here and break ordering for every id after 1970.
      const farFuture = createSortableId(2 ** 45);
      const now = createSortableId(Date.now());

      expect(farFuture > now).toBe(true);
      expect(farFuture).toMatch(UUID_PATTERN);
    });
  });

  describe('WHEN a thousand are created within the same millisecond', () => {
    it('THEN every one is distinct', () => {
      const sameMillisecond = 1_700_000_000_000;
      const ids = new Set(Array.from({ length: 1000 }, () => createSortableId(sameMillisecond)));

      expect(ids.size).toBe(1000);
    });
  });
});
