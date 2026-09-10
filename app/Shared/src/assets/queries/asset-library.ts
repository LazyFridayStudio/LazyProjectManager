import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { projectSlugSchema } from '../../projects/project-vocabulary.js';
import { assetStatusSchema, ASSET_STATUSES } from '../asset-vocabulary.js';

/**
 * The most assets one category returns.
 *
 * A category with more than this has a filtering problem rather than a paging
 * problem, and an unbounded library query is how one enormous prop set takes the
 * whole screen down.
 */
export const MAXIMUM_ASSETS_PER_CATEGORY = 200;

/** An asset as its tile draws it. */
export const assetTileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: assetStatusSchema,
  estimatedCostMinor: z.number().int().nullable(),
  dueOn: z.string().nullable(),
  /** The first of its reference images, or null while it has none. */
  primaryReferenceUrl: z.string().nullable(),
  /** How many pictures of it there are, which is a measure of how known it is. */
  referenceCount: z.number().int(),
  /** How many cards are about it, which is what "unlinked" on a tile means. */
  linkedCardCount: z.number().int(),
  /**
   * The stages it is made in, and how many are ticked off.
   *
   * On the tile rather than only in the panel, because the whole reason to
   * write the stages down is to see at a glance which of forty assets are
   * nearly there. Both nought for an asset nobody has broken up, which the tile
   * draws as nothing rather than as `0/0`.
   */
  subtaskCount: z.number().int(),
  subtasksDone: z.number().int(),
  /** The words it is filed under, in the order they read best: alphabetical. */
  tags: z.array(z.string()),
});

export type AssetTile = z.infer<typeof assetTileSchema>;

/**
 * A category, and everything filed under it.
 *
 * The type is written out rather than inferred, because it refers to itself: a
 * category holds categories, to whatever depth a studio has built. `z.lazy` is
 * how zod is told that, and it cannot work the type out on its own.
 */
export interface AssetCategory {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly budgetMinor: number | null;
  /**
   * Everything under it, however deep — not only what was returned, and not
   * only what is filed directly in it.
   *
   * A parent whose assets are all in its children would otherwise read as
   * empty, which is the opposite of what a group is for.
   */
  readonly count: number;
  /** What everything under it is estimated to cost, against that budget. */
  readonly estimatedMinor: number;
  /** The categories inside it, in the order they are arranged. */
  readonly categories: readonly AssetCategory[];
  /** The assets filed directly in it, beside those categories rather than in them. */
  readonly assets: readonly AssetTile[];
}

export const assetCategorySchema: z.ZodType<AssetCategory> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string(),
    budgetMinor: z.number().int().nullable(),
    count: z.number().int(),
    estimatedMinor: z.number().int(),
    categories: z.array(assetCategorySchema),
    assets: z.array(assetTileSchema),
  }),
);

export const assetLibraryViewSchema = z.object({
  /** Enough of the project for the header, so the screen is one request. */
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    currency: z.string(),
    archived: z.boolean(),
  }),
  categories: z.array(assetCategorySchema),
  /**
   * Everything in the project, whatever the filters say.
   *
   * So the header can read "12 of 39" rather than telling somebody their
   * library shrank.
   */
  assetCount: z.number().int(),
  /** Every tag anybody has used in this project, so they can be offered. */
  availableTags: z.array(z.string()),
});

export type AssetLibraryView = z.infer<typeof assetLibraryViewSchema>;

/**
 * A list sent as one query parameter.
 *
 * Query parameters are primitives by contract — a definition that needs to send
 * structured data has the wrong parameter shape — so several tags travel as
 * `modular,act-1`. Safe as a separator because a tag is letters, numbers and
 * hyphens, and a status is one of five words.
 */
function commaSeparated<TItem extends z.ZodTypeAny>(item: TItem, most: number) {
  return z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    )
    .pipe(z.array(item).max(most));
}

/**
 * What the library is narrowed to.
 *
 * Filtering happens here rather than in the browser so the numbers beside a
 * category's name mean what is under it. A screen that filtered the tiles and
 * left the counts alone would be a screen that says eight and shows three.
 */
export const assetLibraryFilterSchema = z.object({
  /** Matched against the key and the name, case-insensitively. */
  search: z.string().trim().max(100).optional(),
  /** An asset must carry every one of them, as the design says. */
  tags: commaSeparated(z.string(), 20).optional(),
  statuses: commaSeparated(assetStatusSchema, ASSET_STATUSES.length).optional(),
});

/**
 * The whole library in one request, and one statement.
 *
 * The same rule the board is held to: a screen that costs a query per category
 * gets slower every time somebody adds one.
 */
export const assetLibraryQuery = defineQuery(
  'assets.library',
  assetLibraryFilterSchema.extend({ slug: projectSlugSchema }),
  assetLibraryViewSchema,
);
