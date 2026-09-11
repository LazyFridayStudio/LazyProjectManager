import { z } from 'zod';

/**
 * How far along an asset is.
 *
 * Deliberately not the board's list names. A card moves through whatever columns
 * a studio invents; an asset goes through the same five stages everywhere,
 * because they are stages of making a thing rather than of managing work.
 */
export const ASSET_STATUSES = ['concept', 'wip', 'review', 'approved', 'final'] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const assetStatusSchema = z.enum(ASSET_STATUSES);

const STATUS_LABELS: Readonly<Record<AssetStatus, string>> = {
  concept: 'Concept',
  wip: 'WIP',
  review: 'Review',
  approved: 'Approved',
  final: 'Final',
};

export function describeAssetStatus(status: AssetStatus): string {
  return STATUS_LABELS[status];
}

export const assetNameSchema = z.string().trim().min(1).max(200);

/**
 * The longest name a category may have.
 *
 * Its own constant because a person is no longer the only thing that names a
 * category: one coming up out of a deleted category into a name that is taken
 * is given another, and that has to be a name the edit dialog would accept.
 */
export const MAXIMUM_ASSET_CATEGORY_NAME_LENGTH = 100;

export const assetCategoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAXIMUM_ASSET_CATEGORY_NAME_LENGTH);

/**
 * A colour a category is drawn in.
 *
 * The same shape a list's colour takes, so the two screens agree about what a
 * colour is and neither has to sanitise the other's.
 */
export const assetCategoryColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i, 'A colour is six hexadecimal digits after a hash.');

/**
 * Money, in minor units, as everywhere else.
 *
 * The same ceiling the project's budget uses: above this it is not a number
 * anybody typed on purpose.
 */
export const assetCostMinorSchema = z.number().int().min(0).max(1_000_000_000_000);

/**
 * The middle of an asset's key: `EXMP-AST-6`.
 *
 * Deliberately the shape a ticket key has, because it is the same idea — a
 * short thing to say out loud. "The crate" is ambiguous across two
 * projects and `EXMP-AST-6` is not.
 */
export const ASSET_KEY_PREFIX = 'AST';

/**
 * Where assets go when the category holding them is deleted.
 *
 * Made when it is first needed rather than with the project: a library that
 * came with an empty "Unorganised" in it would be a library where the first
 * thing everybody does is wonder what it is for.
 *
 * Grey, because it is not a kind of thing — it is the absence of one.
 */
export const DEFAULT_ASSET_CATEGORY = { name: 'Unorganised', color: '#7a7a7a' } as const;

/**
 * The most tags one asset carries.
 *
 * Not a rule about how anybody should work — it is the point past which a tile
 * is a wall of chips with a picture somewhere behind it.
 */
export const MAXIMUM_TAGS_PER_ASSET = 20;

/**
 * A word an asset is filed under.
 *
 * Normalised rather than policed: `Act 1`, `act 1` and `ACT-1` are one tag, and
 * a library where they are three is a library where filtering by any of them
 * finds a third of what it should. Lower case and hyphens, which is the form
 * every tag in the design is already written in.
 */
export const assetTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-'))
  .refine((value) => value.length > 0, 'Name the tag.')
  .refine((value) => value.length <= 40, 'That is longer than a tag wants to be.')
  .refine((value) => /^[a-z0-9][a-z0-9-]*$/.test(value), 'A tag is letters, numbers and hyphens.');

/** What a file is called in an asset's list. The filename, for an upload. */
export const assetFileLabelSchema = z.string().trim().min(1).max(200);

/**
 * Where a file lives, when it does not live here.
 *
 * Held to `http` and `https` on purpose. `javascript:` in an href is the oldest
 * trick there is, and `file:` is a path on whichever machine happens to be
 * reading it — neither is a place anybody can send a colleague.
 */
export const assetFileUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) => {
      try {
        const { protocol } = new URL(value);

        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'That needs to be a full http or https address.' },
  );
