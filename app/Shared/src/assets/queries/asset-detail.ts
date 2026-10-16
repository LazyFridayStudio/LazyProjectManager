import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { cardAssigneeSchema } from '../../board/queries/board-view.js';
import { subtaskSchema } from '../../board/queries/card-detail.js';
import { assetBlockKindSchema, assetPhaseSchema } from '../asset-vocabulary.js';
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
 * Another asset this one goes with.
 *
 * Enough to say what it is without opening it: a helm on the Voryoc Hound's
 * panel reads as a helm, filed under Helmets, and finished or not.
 */
export const linkedAssetSchema = z.object({
  /** What `assets.unlinkAsset` takes. The same from either end of the link. */
  linkId: z.string().uuid(),
  assetId: z.string().uuid(),
  assetKey: z.string(),
  name: z.string(),
  phase: assetPhaseSchema,
  category: z.object({
    id: z.string().uuid(),
    name: z.string(),
    color: z.string(),
  }),
});

export type LinkedAsset = z.infer<typeof linkedAssetSchema>;

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
  /** The tab it is for, or null for one that is the asset's as a whole. */
  tabId: z.string().uuid().nullable(),
});

export type AssetFile = z.infer<typeof assetFileSchema>;

/**
 * One block of a tab or of the Overview, as it is drawn.
 *
 * One shape for every kind rather than a union, because the panel walks them in
 * order and switches on `kind`: a notes block has a body and no items, a
 * checklist has items and no body, and a files or work block has neither — it
 * shows the asset's files and hours that name its tab.
 */
export const assetTabBlockSchema = z.object({
  id: z.string().uuid(),
  kind: assetBlockKindSchema,
  body: z.string().nullable(),
  /** A checklist's items, in order. The same shape a card's steps have. */
  items: z.array(subtaskSchema),
});

export type AssetTabBlock = z.infer<typeof assetTabBlockSchema>;

/**
 * One job inside the asset: Mesh, UVs, Rig.
 *
 * Who is doing it and by when are the tab's own, because the rigger is not the
 * modeller and the rig is not due when the mesh is.
 */
export const assetTabSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  done: z.boolean(),
  assignee: cardAssigneeSchema.nullable(),
  dueOn: z.string().nullable(),
  /** What it is built from, top to bottom. */
  blocks: z.array(assetTabBlockSchema),
});

export type AssetTab = z.infer<typeof assetTabSchema>;

export const assetDetailViewSchema = z.object({
  id: z.string().uuid(),
  /** What it is called out loud: `EXMP-AST-6`. */
  assetKey: z.string(),
  name: z.string(),
  phase: assetPhaseSchema,
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
   * The jobs it is made in, in the order somebody put them.
   *
   * The Overview is not one of these: it is the asset itself, and every asset
   * has it whether or not anybody has broken the work up.
   */
  tabs: z.array(assetTabSchema),
  /**
   * What the Overview shows beyond the description, assignee and reporter every
   * asset has, top to bottom. A new asset shows nothing else until somebody
   * adds it.
   */
  overview: z.array(assetTabBlockSchema),
  /** What it is made of, uploaded or linked, in the order they were added. */
  files: z.array(assetFileSchema),
  /** The cards about it, open ones first. */
  cards: z.array(assetCardLinkSchema),
  /** The other assets it goes with, by name. */
  linkedAssets: z.array(linkedAssetSchema),
  /**
   * Whether the person reading this may delete the asset.
   *
   * Asked by the server rather than worked out on the screen, so the button and
   * the command behind it cannot disagree about who that is.
   */
  canDelete: z.boolean(),
  /** Whether they may link it to another asset, or unlink one. Asked the same way. */
  canLink: z.boolean(),
  /** Whether they may save its tabs as one of the project's templates. */
  canManageTemplates: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AssetDetailView = z.infer<typeof assetDetailViewSchema>;

export const assetDetailQuery = defineQuery(
  'assets.detail',
  z.object({ assetId: z.string().uuid() }),
  assetDetailViewSchema,
);
