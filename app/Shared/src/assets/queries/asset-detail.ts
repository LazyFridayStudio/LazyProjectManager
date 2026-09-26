import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { cardAssigneeSchema } from '../../board/queries/board-view.js';
import { subtaskSchema } from '../../board/queries/card-detail.js';
import { assetStatusSchema } from '../asset-vocabulary.js';
import { workDoneSchema } from '../../work/work-view.js';

/**
 * One asset, as its panel shows it.
 *
 * Separate from the tile the library draws, for the same reason a card's detail
 * is separate from its chip: a library carrying every description would carry
 * them for every asset on screen, and nearly none would be read.
 */
/**
 * A card that is about this asset.
 *
 * The half that makes a library worth keeping: not what an asset is, but what
 * work is outstanding on it.
 */
export const assetCardLinkSchema = z.object({
  linkId: z.string().uuid(),
  cardId: z.string().uuid(),
  cardKey: z.string(),
  title: z.string(),
  closed: z.boolean(),
});

export type AssetCardLink = z.infer<typeof assetCardLinkSchema>;

/**
 * One picture of the asset.
 *
 * An asset gathers a sheet of these — a silhouette, colour keys, a material
 * study, a scale reference, a render — rather than having one portrait. The
 * first is the one a tile shows.
 */
export const assetReferenceSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  /**
   * A signed link, or null for a file with no picture in it and for one whose
   * thumbnail has not been made yet. Both mean the same thing to the panel:
   * draw the filename.
   */
  url: z.string().nullable(),
});

export type AssetReference = z.infer<typeof assetReferenceSchema>;

/**
 * A working file of the asset: the source, not the picture of it.
 *
 * `href` is where to go for it either way — `/api/f/<id>?full` for something
 * uploaded, and whatever was typed for something linked. The panel does not
 * need to know which, but it says which, because "opens a 900MB download" and
 * "opens somebody else's website" are different things to be about to do.
 */
export const assetFileSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  href: z.string(),
  /** Whether the bytes are here or somewhere else. */
  stored: z.boolean(),
  /** Null for a linked file, and for one whose upload never finished. */
  bytes: z.number().int().nullable(),
});

export type AssetFile = z.infer<typeof assetFileSchema>;

export const assetDetailViewSchema = z.object({
  id: z.string().uuid(),
  /** What it is called out loud: `EXMP-AST-6`. */
  assetKey: z.string(),
  name: z.string(),
  status: assetStatusSchema,
  description: z.string().nullable(),
  estimatedCostMinor: z.number().int().nullable(),
  /** The hours put into this, and what they add up to. */
  work: workDoneSchema,
  dueOn: z.string().nullable(),
  /** Every picture of it, the first one first. Empty until somebody adds one. */
  references: z.array(assetReferenceSchema),
  /** Who is making it, or null for something nobody has picked up yet. */
  assignee: cardAssigneeSchema.nullable(),
  /**
   * Who asked for it.
   *
   * Null two ways, and the panel cannot tell them apart because nothing it
   * could say about the difference would help: an asset filed before assets
   * carried a reporter, and one whose reporter has since left the install.
   */
  reporter: cardAssigneeSchema.nullable(),
  category: z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string(),
  }),
  /** Enough of the project to price it and to know whether it is editable. */
  project: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    currency: z.string(),
    archived: z.boolean(),
  }),
  /** The words it is filed under, alphabetical. */
  tags: z.array(z.string()),
  /**
   * The stages it is made in, in the order somebody put them.
   *
   * The same shape a card's steps have, deliberately: a checklist on a thing is
   * one idea, and two schemas that agreed today would drift the first time one
   * of them grew a field.
   */
  subtasks: z.array(subtaskSchema),
  /** What it is made of, uploaded or linked, in the order they were added. */
  files: z.array(assetFileSchema),
  /** The cards about it, open ones first. */
  cards: z.array(assetCardLinkSchema),
  /**
   * Whether the person reading this may delete the asset.
   *
   * Asked by the server rather than worked out on the screen, so the button and
   * the command behind it cannot disagree about who that is.
   */
  canDelete: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AssetDetailView = z.infer<typeof assetDetailViewSchema>;

export const assetDetailQuery = defineQuery(
  'assets.detail',
  z.object({ assetId: z.string().uuid() }),
  assetDetailViewSchema,
);
