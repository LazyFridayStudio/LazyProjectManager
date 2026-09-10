import type { Database } from '@lpm/database';

import { InvariantViolatedError } from '../../../domain/index.js';

/**
 * One sync of a repository at a time.
 *
 * Nothing used to stop two: the button is served by the API container and the
 * clock runs in the worker, so those two could always collide, and at a
 * one-minute interval a sync of a repository with a hundred issues will not
 * reliably finish before the next one is due. Two syncs reconciling the same
 * board at once is two sets of writes racing to decide which side changed last.
 *
 * A column rather than an advisory lock, because a sync is not one transaction.
 * It reads the forge, writes the database, then writes back to the forge — so a
 * transaction-scoped lock cannot cover the whole of it, and a session lock would
 * mean pinning a pool connection across three network calls. One conditional
 * `update … returning` decides it in the database, holds nothing open, and reads
 * the same from either container.
 */

/**
 * How long a claim is honoured before another sync may take it.
 *
 * A sync that has been running for ten minutes is not running: it is a worker
 * that was killed, a container that was replaced, or a request that was cut off
 * mid-flight. Without a lease those leave a claim nothing ever clears, and a
 * connection nothing can ever sync again — which is a worse failure than the
 * overlap this prevents, because it is silent and permanent.
 *
 * Well past the slowest plausible sync: a hundred issues, their labels, and the
 * cards raised back. Generous on purpose, because the cost of waiting is a late
 * board and the cost of being wrong is two syncs after all.
 */
export const A_SYNC_CANNOT_RUN_LONGER_THAN_MS = 10 * 60_000;

/**
 * A sync asked for while one is already running.
 *
 * An `InvariantViolatedError` so it carries a `FailureCode` the client already
 * handles and the message reaches the person who pressed the button. Its own
 * class so the worker can tell it from a sync that actually failed: stepping
 * around the button is not something to record against the connection or to
 * back off from.
 */
export class SyncAlreadyRunningError extends InvariantViolatedError {
  constructor() {
    super('A sync of this repository is already running. Give it a moment.');
    this.name = 'SyncAlreadyRunningError';
  }
}

export interface SyncClaim {
  readonly connectionId: string;
}

/**
 * Takes the connection, or says somebody else has it.
 *
 * The condition is in the statement rather than in a read followed by a write:
 * two workers asking at the same moment both see `null` in a check-then-act, and
 * only one of them can win an `update … where syncing_since is null`.
 */
export async function claimTheSync(
  database: Database,
  projectId: string,
  now: Date,
): Promise<SyncClaim> {
  const expiredBefore = new Date(now.getTime() - A_SYNC_CANNOT_RUN_LONGER_THAN_MS);

  const claimed = await database
    .updateTable('scmConnection')
    .set({ syncingSince: now })
    .where('projectId', '=', projectId)
    .where((builder) =>
      builder.or([
        builder.eb('syncingSince', 'is', null),
        builder.eb('syncingSince', '<', expiredBefore),
      ]),
    )
    .returning('id')
    .executeTakeFirst();

  if (claimed === undefined) {
    throw new SyncAlreadyRunningError();
  }

  return { connectionId: claimed.id };
}

/**
 * Gives the connection back, and says the sync worked.
 *
 * The failure is cleared here rather than left to age out, so what a screen
 * shows is the state now rather than the worst thing that ever happened to this
 * connection.
 */
export async function releaseTheSync(database: Database, claim: SyncClaim): Promise<void> {
  await database
    .updateTable('scmConnection')
    .set({ syncingSince: null, syncFailedAt: null, syncFailure: null })
    .where('id', '=', claim.connectionId)
    .execute();
}

/**
 * Gives the connection back, and says why the sync did not work.
 *
 * `syncFailedAt` is left alone when one is already recorded, because the useful
 * question on a screen is "how long has this been broken", not "when did it last
 * try". The reason is overwritten, because the most recent one is the one worth
 * acting on.
 */
export async function releaseTheSyncAsFailed(
  database: Database,
  claim: SyncClaim,
  failure: { readonly reason: string; readonly at: Date },
): Promise<void> {
  await database
    .updateTable('scmConnection')
    .set((builder) => ({
      syncingSince: null,
      syncFailedAt: builder.fn.coalesce('syncFailedAt', builder.val(failure.at)),
      syncFailure: failure.reason,
    }))
    .where('id', '=', claim.connectionId)
    .execute();
}
