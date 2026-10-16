import { describe, expect, it } from 'vitest';

import {
  countFilters,
  isFiltering,
  togglePhase,
  toggleTag,
  toQueryParams,
  NO_FILTERS,
} from './asset-filters.js';

describe('GIVEN the library filter', () => {
  describe('WHEN nothing has been chosen', () => {
    it('THEN the library is not narrowed and asks for nothing in particular', () => {
      expect(isFiltering(NO_FILTERS)).toBe(false);
      // An absent parameter rather than an empty one, so a request for the
      // whole library is the same request every time and the cache knows it.
      expect(toQueryParams(NO_FILTERS)).toEqual({});
    });
  });

  describe('WHEN a chip is pressed', () => {
    it('THEN pressing it again takes it off, because that is what anybody expects', () => {
      const chosen = toggleTag(NO_FILTERS, 'act-1');

      expect(chosen.tags).toEqual(['act-1']);
      expect(toggleTag(chosen, 'act-1').tags).toEqual([]);
    });

    it('THEN tags and phases are counted together, since both narrow', () => {
      const both = togglePhase(toggleTag(NO_FILTERS, 'act-1'), 'dev');

      expect(countFilters(both)).toBe(2);
      expect(isFiltering(both)).toBe(true);
    });

    it('THEN a search counts as one however long it is', () => {
      expect(countFilters({ ...NO_FILTERS, search: 'ruined watchtower' })).toBe(1);
    });
  });

  describe('WHEN it is sent to the server', () => {
    it('THEN lists travel as one parameter, because a parameter is a primitive', () => {
      const filters = togglePhase(toggleTag(toggleTag(NO_FILTERS, 'act-1'), 'modular'), 'dev');

      expect(toQueryParams({ ...filters, search: 'crane' })).toEqual({
        search: 'crane',
        tags: 'act-1,modular',
        phases: 'dev',
      });
    });
  });
});
