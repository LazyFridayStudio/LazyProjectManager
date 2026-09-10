import type { AssetStatus } from '@lpm/shared';

/**
 * What the library has been narrowed to.
 *
 * Held as one value rather than three pieces of state, because every part of
 * the screen that cares about filtering cares about all of it: the header
 * summary, the empty state, and whether an empty category is worth drawing.
 */
export interface AssetFilters {
  readonly search: string;
  /** An asset must carry every one of them. */
  readonly tags: readonly string[];
  readonly statuses: readonly AssetStatus[];
}

export const NO_FILTERS: AssetFilters = { search: '', tags: [], statuses: [] };

export function isFiltering(filters: AssetFilters): boolean {
  return filters.search !== '' || filters.tags.length > 0 || filters.statuses.length > 0;
}

/** How many separate things have been asked for, for the summary line. */
export function countFilters(filters: AssetFilters): number {
  return (filters.search === '' ? 0 : 1) + filters.tags.length + filters.statuses.length;
}

/**
 * Turns one on or off.
 *
 * A chip is the same control either way — pressing one that is already on is
 * how anybody expects to take it off again, and a separate remove would be a
 * second control for the same idea.
 */
export function toggleTag(filters: AssetFilters, tag: string): AssetFilters {
  return { ...filters, tags: toggle(filters.tags, tag) };
}

export function toggleStatus(filters: AssetFilters, status: AssetStatus): AssetFilters {
  return { ...filters, statuses: toggle(filters.statuses, status) };
}

function toggle<TValue extends string>(
  chosen: readonly TValue[],
  value: TValue,
): readonly TValue[] {
  return chosen.includes(value) ? chosen.filter((entry) => entry !== value) : [...chosen, value];
}

/**
 * The filter as the query takes it.
 *
 * Lists travel as `modular,act-1` because a query parameter is a primitive by
 * contract, and an absent parameter rather than an empty one so a request for
 * the whole library is the same request every time — which is what lets the
 * cache recognise it.
 */
export function toQueryParams(filters: AssetFilters): {
  search?: string;
  tags?: string;
  statuses?: string;
} {
  return {
    ...(filters.search === '' ? {} : { search: filters.search }),
    ...(filters.tags.length === 0 ? {} : { tags: filters.tags.join(',') }),
    ...(filters.statuses.length === 0 ? {} : { statuses: filters.statuses.join(',') }),
  };
}
