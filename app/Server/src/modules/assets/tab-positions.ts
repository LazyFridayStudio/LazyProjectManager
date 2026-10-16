import { sql, type DatabaseTransaction, type RawBuilder } from '@lpm/database';

import { placeAtEnd, placeInOrder, type OrderedRows } from '../../ordering/place-in-order.js';
import { readPosition } from './asset-access.js';

/**
 * The two hand-ordered sets inside an asset: its tabs along the row, and the
 * blocks down one tab.
 *
 * One adapter for both, written against the table and the column that holds
 * the set together, because they differ in nothing else. Raw SQL, so every
 * identifier is snake_case — the `CamelCasePlugin` does not reach inside a
 * `sql` fragment.
 */
export type OrderedSet =
  | { readonly table: 'asset_tab'; readonly by: 'asset_id'; readonly id: string }
  | { readonly table: 'asset_tab_block'; readonly by: 'tab_id'; readonly id: string }
  /** An asset's Overview: its blocks that are on no tab. */
  | { readonly table: 'asset_tab_block'; readonly by: 'overview'; readonly id: string };

interface Placing {
  readonly transaction: DatabaseTransaction;
  readonly set: OrderedSet;
  /** The row being placed, left out of its own neighbour search. Null for a new one. */
  readonly rowId: string | null;
}

function rowsOf({ transaction, set, rowId }: Placing): OrderedRows {
  const table = sql.table(set.table);
  const inTheSet =
    set.by === 'overview'
      ? sql`asset_id = ${set.id} and tab_id is null`
      : sql`${sql.ref(set.by)} = ${set.id}`;
  const notItself = rowId === null ? sql`` : sql`and id <> ${rowId}`;

  const one = async (query: RawBuilder<{ found: string | null }>) => {
    const result = await query.execute(transaction);

    return readPosition(result.rows[0]?.found);
  };

  return {
    positionOf: (id) =>
      one(sql<{ found: string | null }>`
        select position::text as found from ${table} where id = ${id} and ${inTheSet}
      `),

    // Compared as text: `position` is `numeric`, which Postgres compares exactly
    // and JavaScript would already have rounded.
    firstAbove: (position) =>
      one(sql<{ found: string | null }>`
        select min(position)::text as found from ${table}
        where ${inTheSet} and position > ${String(position)}::numeric ${notItself}
      `),

    lastBelow: (position) =>
      one(sql<{ found: string | null }>`
        select max(position)::text as found from ${table}
        where ${inTheSet} and position < ${String(position)}::numeric ${notItself}
      `),

    last: () =>
      one(sql<{ found: string | null }>`
        select max(position)::text as found from ${table} where ${inTheSet} ${notItself}
      `),

    async idsInOrder() {
      const result = await sql<{ id: string }>`
        select id from ${table} where ${inTheSet} order by position
      `.execute(transaction);

      return result.rows.map((row) => row.id);
    },

    async setPosition(id, position) {
      await sql`update ${table} set position = ${position} where id = ${id}`.execute(transaction);
    },
  };
}

/** Where a row lands among the others in its set, between the two it was dropped between. */
export function placeInSet(
  placing: Placing & {
    readonly beforeId: string | null | undefined;
    readonly afterId: string | null | undefined;
  },
): Promise<number> {
  return placeInOrder(rowsOf(placing), { beforeId: placing.beforeId, afterId: placing.afterId });
}

/** Where a new row goes: the end of its set. */
export function placeAtEndOfSet(
  transaction: DatabaseTransaction,
  set: OrderedSet,
): Promise<number> {
  return placeAtEnd(rowsOf({ transaction, set, rowId: null }));
}
