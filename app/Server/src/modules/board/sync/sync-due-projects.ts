import { createSortableId, sql, type Database } from '@lpm/database';

import type { Environment } from '../../../server/environment.js';
import type { FetchLike } from '../../scm/forge/github-app.js';
import { A_SYNC_CANNOT_RUN_LONGER_THAN_MS, SyncAlreadyRunningError } from './claim-the-sync.js';
import { syncProjectIssues } from './sync-project-issues.js';

/**
 * Keeping the board and the issue list in step without anybody pressing
 * anything.
 *
 * The button on the board is for when you want it now. This is for the rest of
 * the time: every project with a repository it can read gets the same reconcile
 * on its own clock. Without it "in sync" means "in sync as of whenever somebody
 * last looked", which is not what anybody means by it.
 *
 * How often is `project.sync_every_seconds`, a minute by default and settable
 * per project, because the right answer differs by project on one install: the
 * repository a studio is living in wants a minute, and last year's archive does
 * not want to be asked at all. It was half an hour for everybody, written here
 * as a constant, which was long enough that a board was stale for most of a
 * working day even when nothing was broken.
 *
 * A connection the forge has spoken to since its last reconcile is due whatever
 * the clock says, and whatever the setting says. That is the difference between
 * a board that catches up when it is told and one that catches up when it gets
 * round to it: somebody who has just merged a pull request *is* watching the
 * board. It is also why Off is honest — the webhook and the button still work.
 */

/**
 * How long to leave a connection alone after a sync that failed.
 *
 * Held in memory rather than in a column, because it is a fact about this
 * worker's afternoon rather than about the connection: a restart should try
 * again rather than remember a grudge. Without it a repository that refuses
 * every request would be asked again on the next pass, which is every half
 * second.
 */
const AFTER_A_FAILURE_MS = 5 * 60_000;

/** Bounded, so one install with fifty projects cannot hold a pass open. */
const MOST_PER_PASS = 5;

export type SyncAttempts = Map<string, Date>;

export function createSyncAttempts(): SyncAttempts {
  return new Map();
}

export interface DueSyncOptions {
  readonly database: Database;
  readonly environment: Pick<Environment, 'APP_SECRET'>;
  readonly fetch: FetchLike;
  readonly now: Date;
  /** Failures per connection, so a refusing repository is not asked twice a second. */
  readonly attempts: SyncAttempts;
  readonly onSyncError?: (projectId: string, error: unknown) => void;
}

/** Syncs whatever is due and returns how many projects were dealt with. */
export async function syncDueProjects(options: DueSyncOptions): Promise<number> {
  const due = await readDueProjects(options);
  let dealtWith = 0;

  for (const project of due) {
    try {
      await syncProjectIssues({
        database: options.database,
        environment: options.environment,
        fetch: options.fetch,
        projectId: project.projectId,
        // Nobody pressed it. The audit trail says so rather than blaming
        // whoever happened to connect the repository.
        actorId: null,
        commandId: createSortableId(),
      });

      options.attempts.delete(project.connectionId);
      dealtWith += 1;
    } catch (error) {
      if (error instanceof SyncAlreadyRunningError) {
        // Claimed between this pass reading it and reaching it — the button, or
        // another worker. Not a failure, so it is not recorded as one and not
        // backed off from: the sync holding the connection is doing the work
        // this pass came to do.
        continue;
      }

      // One project nobody can sync must not stop the ones behind it, and must
      // not be retried every half second until somebody fixes it.
      options.attempts.set(project.connectionId, options.now);
      options.onSyncError?.(project.projectId, error);
      dealtWith += 1;
    }
  }

  return dealtWith;
}

interface DueProject {
  readonly connectionId: string;
  readonly projectId: string;
}

/**
 * The connections the clock has come round for.
 *
 * A connection with no credentials is skipped rather than attempted: every
 * Gitea and GitLab connection is in that state today, and asking every minute
 * would be a log full of the same refusal.
 */
async function readDueProjects(options: DueSyncOptions): Promise<DueProject[]> {
  const connections = await options.database
    .selectFrom('scmConnection')
    .innerJoin('project', 'project.id', 'scmConnection.projectId')
    .select(['scmConnection.id as connectionId', 'scmConnection.projectId as projectId'])
    .where('scmConnection.appId', 'is not', null)
    .where('scmConnection.installationId', 'is not', null)
    .where('scmConnection.privateKeyEnc', 'is not', null)
    .where('project.archivedAt', 'is', null)
    /*
     * A connection somebody is already syncing is not due, it is busy.
     *
     * The claim decides the race — two passes reading this at the same moment
     * both see it free — but reading it here means an ordinary pass does not
     * spend one of its five on a project it is about to be turned away from.
     * The same shape as `for update skip locked` on the outbox: skip what is
     * held, come back next pass.
     */
    .where((builder) =>
      builder.or([
        builder.eb('scmConnection.syncingSince', 'is', null),
        builder.eb(
          'scmConnection.syncingSince',
          '<',
          new Date(options.now.getTime() - A_SYNC_CANNOT_RUN_LONGER_THAN_MS),
        ),
      ]),
    )
    .where((builder) =>
      builder.or([
        builder.and([
          // Off is off: no clock, and the two clauses below carry on working.
          builder.eb('project.syncEverySeconds', 'is not', null),
          builder.or([
            builder.eb('scmConnection.issuesSyncedAt', 'is', null),
            /*
             * The interval is a column, so the comparison is per row.
             *
             * `CamelCasePlugin` does not reach inside a raw fragment, so the
             * identifier is snake_case by hand — and the clock is the one the
             * caller passed rather than the database's `now()`, because that is
             * what makes this testable at a date nobody has to wait for.
             */
            builder.eb(
              'scmConnection.issuesSyncedAt',
              '<',
              sql<Date>`${options.now}::timestamptz - make_interval(secs => project.sync_every_seconds)`,
            ),
          ]),
        ]),
        /*
         * Or the forge has said something since the last reconcile.
         *
         * This is what turns "up to half an hour behind" into "behind until the
         * worker's next pass". A merge that closes an issue sends a delivery,
         * the delivery stamps `forgeSpokeAt`, and the connection is due now
         * rather than on the clock — while the clock stays underneath for the
         * delivery that never arrived, the webhook somebody misconfigured, and
         * everything that changed while the install was down.
         */
        builder.eb('scmConnection.forgeSpokeAt', '>', builder.ref('scmConnection.issuesSyncedAt')),
      ]),
    )
    .orderBy('scmConnection.issuesSyncedAt', (order) => order.asc().nullsFirst())
    .limit(MOST_PER_PASS)
    .execute();

  const tryAgainAfter = new Date(options.now.getTime() - AFTER_A_FAILURE_MS);

  return connections.filter((connection) => {
    const failedAt = options.attempts.get(connection.connectionId);

    return failedAt === undefined || failedAt < tryAgainAfter;
  });
}
