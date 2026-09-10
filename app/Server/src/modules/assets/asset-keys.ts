import type { DatabaseTransaction } from '@lpm/database';
import { formatCardKey, ASSET_KEY_PREFIX } from '@lpm/shared';

export interface AllocateAssetKeyRequest {
  readonly database: DatabaseTransaction;
  readonly projectId: string;
  /** The project's code, which is the root of the key: `DRCH`. */
  readonly projectCode: string;
}

/**
 * Takes the next asset key for a project: `DRCH-AST-6`.
 *
 * An upsert rather than an update, so a project that has never had an asset
 * gets its counter the moment it needs one. Nothing has to remember to seed a
 * row, which is the kind of thing that is remembered until the day somebody
 * adds another way to make a project.
 *
 * The row is written and read back in one statement, so two people adding an
 * asset at the same instant take different numbers — Postgres serialises them
 * on the row lock. Reading then writing would hand both of them the same key.
 *
 * Runs inside the caller's transaction, which is what makes a rolled-back
 * create give its number back instead of leaving a gap.
 */
export async function allocateAssetKey(request: AllocateAssetKeyRequest): Promise<string> {
  const { database, projectId, projectCode } = request;

  const sequence = await database
    .insertInto('assetSequence')
    .values({ projectId, lastValue: 1 })
    .onConflict((conflict) =>
      conflict.column('projectId').doUpdateSet((expression) => ({
        lastValue: expression('assetSequence.lastValue', '+', 1),
      })),
    )
    .returning('lastValue')
    .executeTakeFirstOrThrow();

  return formatCardKey(projectCode, ASSET_KEY_PREFIX, sequence.lastValue);
}
