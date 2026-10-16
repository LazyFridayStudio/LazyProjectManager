import type { AssetBlockKind, AssetPhase } from '@lpm/shared';
import type { ColumnType, Generated } from 'kysely';

/**
 * Table types for the asset library: what a project has to make, grouped by what
 * kind of thing it is.
 */

type CreatedAt = ColumnType<Date, Date | undefined, never>;

/** As elsewhere: `bigint` arrives from `pg` as a string. */
type MinorUnits = ColumnType<string | null, number | null | undefined, number | null>;

/** `numeric` arrives as a string too, and is written as a number. */
type Position = ColumnType<string, number, number>;

export interface AssetCategoryTable {
  id: Generated<string>;
  accountId: string;
  projectId: string;
  /**
   * The category this one sits inside, and null for one at the top.
   *
   * Any depth: a parent may itself have a parent. The only shape the database
   * cannot refuse on its own is a category inside itself, which is why
   * `moveCategory` walks the ancestors before it writes.
   */
  parentId: string | null;
  name: string;
  color: string;
  /** Null when nobody has budgeted it, which is not the same as budgeting nothing. */
  budgetMinor: MinorUnits;
  /** Among its siblings, so each parent orders what is directly under it. */
  position: Position;
  /** The template an asset filed here starts from. Offered, never imposed. */
  defaultTemplateId: string | null;
  archivedAt: Date | null;
  createdAt: CreatedAt;
}

export interface AssetTable {
  id: Generated<string>;
  accountId: string;
  projectId: string;
  categoryId: string;
  /** `DRCH-AST-6`. Handed out by `assetSequence` and never reused. */
  assetKey: string;
  name: string;
  phase: Generated<AssetPhase>;
  description: string | null;
  estimatedCostMinor: MinorUnits;
  /** Who is making it. */
  assigneeId: string | null;
  /** Who asked for it, and null for every asset filed before that was kept. */
  reporterId: string | null;
  dueOn: string | null;
  position: Position;
  createdAt: CreatedAt;
  updatedAt: ColumnType<Date, Date | undefined, Date>;
}

/**
 * The pictures of an asset.
 *
 * A sheet rather than a portrait: an asset accumulates a silhouette, colour
 * keys, a material study, a scale reference and a render. The first by position
 * is the one a tile shows, which is why promoting a reference is a reorder and
 * not a separate column.
 */
export interface AssetReferenceTable {
  id: Generated<string>;
  accountId: string;
  assetId: string;
  fileId: string;
  position: Position;
  createdAt: CreatedAt;
}

/**
 * The working files of an asset: the source, not the picture of it.
 *
 * Either the bytes are here or they are somewhere else — a studio with a
 * Perforce depot is not uploading a four-gigabyte source file into this. A row
 * carries a `fileId` or a `url`, and the database holds it to exactly one.
 */
export interface AssetFileTable {
  id: Generated<string>;
  accountId: string;
  assetId: string;
  /** Set when the bytes are here. */
  fileId: string | null;
  /** Set when they are somewhere else, and this is where. */
  url: string | null;
  /** What to call it in the list. The filename, for something uploaded. */
  label: string;
  /** The tab it is for, or null for the asset as a whole. Emptied if the tab goes. */
  tabId: string | null;
  position: Position;
  createdAt: CreatedAt;
}

/**
 * The next asset number for a project.
 *
 * Its own table rather than a row in `card_sequence`, whose check constraint
 * names the four card prefixes on purpose.
 */
export interface AssetSequenceTable {
  projectId: string;
  lastValue: Generated<number>;
}

/**
 * The words a studio files its own assets under.
 *
 * A category says what kind of thing something is and there is exactly one; a
 * tag says anything else worth finding an asset by, and there are as many as
 * are useful.
 */
export interface AssetTagTable {
  id: Generated<string>;
  accountId: string;
  assetId: string;
  /** Already lowercase and hyphenated by the time it arrives. */
  tag: string;
  createdAt: CreatedAt;
}

/**
 * One job inside an asset: Mesh, UVs, Rig.
 *
 * `asset.phase` says where the whole thing is; a tab is one part of the work
 * inside it, with its own person, its own date and blocks to say the rest.
 * Freeform and per asset, or copied from a template the project wrote.
 */
export interface AssetTabTable {
  id: Generated<string>;
  /** The bin checks the account on the thing it keeps, and a tab is kept on its own. */
  accountId: string;
  assetId: string;
  title: string;
  done: Generated<boolean>;
  assigneeId: string | null;
  dueOn: string | null;
  position: Position;
  createdAt: CreatedAt;
}

/**
 * What a tab, or an asset's Overview, is built from, top to bottom.
 *
 * No tab is the Overview. Carries its asset as well as its tab, so a deleted
 * asset takes its blocks to the bin along with it: the bin finds rows by a
 * column naming the thing.
 */
export interface AssetTabBlockTable {
  id: Generated<string>;
  assetId: string;
  /** Null for a block on the asset's Overview. */
  tabId: string | null;
  kind: AssetBlockKind;
  /** What a notes block says, and null for every other kind. */
  body: string | null;
  position: Position;
  createdAt: CreatedAt;
}

/** One line of a checklist block. Carries its asset and tab for the bin, as a block does. */
export interface AssetTabChecklistItemTable {
  id: Generated<string>;
  assetId: string;
  /** Null for a line of a checklist on the Overview. */
  tabId: string | null;
  blockId: string;
  title: string;
  done: Generated<boolean>;
  position: Position;
  createdAt: CreatedAt;
}

/**
 * A set of tabs a project keeps, to start assets from.
 *
 * The definition is `jsonb`, written as a string and read back as `text`: the
 * `CamelCasePlugin` renames the keys of any object it finds in a result, and a
 * template's keys are its own rather than column names.
 */
export interface AssetTemplateTable {
  id: Generated<string>;
  accountId: string;
  projectId: string;
  name: string;
  definition: ColumnType<unknown, string, string>;
  createdAt: CreatedAt;
}

/**
 * Which cards are about which assets.
 *
 * No `kind`: a card relates to another card in several ways, but there is only
 * one thing it can be to an asset — about it.
 */
export interface CardAssetLinkTable {
  id: Generated<string>;
  accountId: string;
  cardId: string;
  assetId: string;
  createdAt: CreatedAt;
}

/**
 * Which assets belong with which other assets: a boss and what it drops.
 *
 * One row per pair, the lower id first whichever end asked, so the pair is
 * unique rather than each direction of it. Nothing about the link reads
 * differently from the other end.
 */
export interface AssetLinkTable {
  id: Generated<string>;
  accountId: string;
  firstAssetId: string;
  secondAssetId: string;
  createdAt: CreatedAt;
}
