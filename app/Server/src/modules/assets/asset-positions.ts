import type { DatabaseTransaction } from '@lpm/database';

import { placeAtEnd, placeInOrder, type OrderedRows } from '../../ordering/place-in-order.js';

export interface AssetPlacement {
  readonly transaction: DatabaseTransaction;
  readonly categoryId: string;
  /** The asset being placed, excluded from its own neighbour search. */
  readonly assetId: string | null;
  /** The asset it should end up in front of. */
  readonly beforeAssetId: string | null | undefined;
  /** The asset it should end up behind. */
  readonly afterAssetId: string | null | undefined;
}

/**
 * The assets of one category, as the ordering algorithm asks about them.
 *
 * The half that is about assets: which table, which column holds the category,
 * and that the asset being moved is not its own neighbour. The arithmetic —
 * midpoints, and spreading the set back out when the gap closes — is the same
 * one the board uses, in `ordering/place-in-order`.
 */
function assetsInCategory(placement: AssetPlacement): OrderedRows {
  const { transaction, categoryId } = placement;

  const others = () => {
    const query = transaction.selectFrom('asset').where('categoryId', '=', categoryId);

    return placement.assetId === null ? query : query.where('id', '!=', placement.assetId);
  };

  return {
    async positionOf(id) {
      const asset = await transaction
        .selectFrom('asset')
        .select('position')
        .where('id', '=', id)
        .where('categoryId', '=', categoryId)
        .executeTakeFirst();

      return readPosition(asset?.position);
    },

    async firstAbove(position) {
      const row = await others()
        .select(({ fn }) => fn.min('position').as('found'))
        // Sent as text: `position` is `numeric`, which Postgres compares exactly
        // and JavaScript would have already rounded.
        .where('position', '>', String(position))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async lastBelow(position) {
      const row = await others()
        .select(({ fn }) => fn.max('position').as('found'))
        .where('position', '<', String(position))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async last() {
      const row = await others()
        .select(({ fn }) => fn.max('position').as('found'))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async idsInOrder() {
      const assets = await transaction
        .selectFrom('asset')
        .select('id')
        .where('categoryId', '=', categoryId)
        .orderBy('position')
        .execute();

      return assets.map((asset) => asset.id);
    },

    async setPosition(id, position) {
      await transaction.updateTable('asset').set({ position }).where('id', '=', id).execute();
    },
  };
}

/** Works out where an asset lands in its category. */
export async function placeAsset(placement: AssetPlacement): Promise<number> {
  return placeInOrder(assetsInCategory(placement), {
    beforeId: placement.beforeAssetId,
    afterId: placement.afterAssetId,
  });
}

/** Where a brand-new asset goes: the end of its category. */
export async function placeAtEndOfCategory(
  transaction: DatabaseTransaction,
  categoryId: string,
): Promise<number> {
  return placeAtEnd(
    assetsInCategory({
      transaction,
      categoryId,
      assetId: null,
      beforeAssetId: null,
      afterAssetId: null,
    }),
  );
}

export interface CategoryPlacement {
  readonly transaction: DatabaseTransaction;
  readonly projectId: string;
  /**
   * The category it is landing inside, and null for the top level.
   *
   * Positions are among siblings, so this is what "the order" even means: a
   * category dropped into another is ordered against what is already in there,
   * and the rest of the library is not its business.
   */
  readonly parentId: string | null;
  /** The category being placed, excluded from its own neighbour search. */
  readonly categoryId: string;
  /** The category it should end up above. */
  readonly beforeCategoryId: string | null | undefined;
  /** The category it should end up below. */
  readonly afterCategoryId: string | null | undefined;
}

/**
 * The categories under one parent, as the ordering algorithm asks about them.
 *
 * The same adapter shape the assets have, one level up: a set of headings
 * somebody arranges by hand, which is the problem `place-in-order` already
 * solves for cards, lists and the assets inside these.
 *
 * Archived categories are left out. They are not drawn, so they are not among
 * the neighbours a drop can name — and a hidden row between two visible ones
 * would be a gap the arithmetic keeps splitting for nobody.
 */
function categoriesInProject(placement: CategoryPlacement): OrderedRows {
  const { transaction, projectId, parentId } = placement;

  const visible = () => {
    const query = transaction
      .selectFrom('assetCategory')
      .where('projectId', '=', projectId)
      .where('archivedAt', 'is', null);

    return parentId === null
      ? query.where('parentId', 'is', null)
      : query.where('parentId', '=', parentId);
  };

  const others = () => visible().where('id', '!=', placement.categoryId);

  return {
    async positionOf(id) {
      const category = await visible().select('position').where('id', '=', id).executeTakeFirst();

      return readPosition(category?.position);
    },

    async firstAbove(position) {
      const row = await others()
        .select(({ fn }) => fn.min('position').as('found'))
        // Sent as text: `position` is `numeric`, which Postgres compares exactly
        // and JavaScript would have already rounded.
        .where('position', '>', String(position))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async lastBelow(position) {
      const row = await others()
        .select(({ fn }) => fn.max('position').as('found'))
        .where('position', '<', String(position))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async last() {
      const row = await others()
        .select(({ fn }) => fn.max('position').as('found'))
        .executeTakeFirst();

      return readPosition(row?.found);
    },

    async idsInOrder() {
      const categories = await visible().select('id').orderBy('position').execute();

      return categories.map((category) => category.id);
    },

    async setPosition(id, position) {
      await transaction
        .updateTable('assetCategory')
        .set({ position })
        .where('id', '=', id)
        .execute();
    },
  };
}

/** Works out where a category lands in its project's library. */
export async function placeCategory(placement: CategoryPlacement): Promise<number> {
  return placeInOrder(categoriesInProject(placement), {
    beforeId: placement.beforeCategoryId,
    afterId: placement.afterCategoryId,
  });
}

/** `numeric` arrives from `pg` as a string, so every read goes through here. */
function readPosition(value: string | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
