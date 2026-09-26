import { sql, type BinnedRepair, type BinnedRows } from '@lpm/database';
import {
  createCommandSuccess,
  purgeDeletedThingCommand,
  restoreDeletedThingCommand,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import { InvariantViolatedError, type PermittedAction } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { DeletedThingNotFoundError } from '../recovery-errors.js';
import {
  describeKind,
  isRecoverableKind,
  restoreFrom,
  type RecoverableKind,
} from '../recycle-bin.js';

/**
 * Puts a deleted thing back, whole.
 *
 * The rows go back with the ids they had, which is the point: a card that
 * pointed at the milestone points at it again, and the audit trail's entries
 * about it still name something that exists. A restore that made a new id would
 * be a copy, and everything that referred to the original would still be
 * pointing at nothing.
 */
export const restoreDeletedThingHandler = defineCommandHandler({
  definition: restoreDeletedThingCommand,

  async execute(input: { commandId: string; deletedThingId: string }, context) {
    const actor = await authorise(context, restoreDeletedThingCommand.name, 'recovery.restore');

    const outcome = await executeCommand({
      database: context.database,
      commandName: restoreDeletedThingCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const binned = await take(transaction, actor, input.deletedThingId);

        await restoreFrom(transaction, binned);

        transaction.appendEvent({
          accountId: actor.accountId,
          ...whatItHappenedTo(binned),
          name: 'recovery.restored',
          payload: { what: describeKind(binned.kind), name: binned.name },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.deletedThingId) : createCommandSuccess();
  },
});

/**
 * Throws a deleted thing away now rather than in a week.
 *
 * The week is a kindness, not a rule: somebody who deleted a document because
 * it had a password in it should not have to wait seven days for that to be
 * true. Its own permission, because "may undo a delete" and "may make one
 * permanent" are not the same trust.
 */
export const purgeDeletedThingHandler = defineCommandHandler({
  definition: purgeDeletedThingCommand,

  async execute(input: { commandId: string; deletedThingId: string }, context) {
    const actor = await authorise(context, purgeDeletedThingCommand.name, 'recovery.purge');

    const outcome = await executeCommand({
      database: context.database,
      commandName: purgeDeletedThingCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const binned = await take(transaction, actor, input.deletedThingId);

        transaction.appendEvent({
          accountId: actor.accountId,
          ...whatItHappenedTo(binned),
          name: 'recovery.purged',
          payload: { what: describeKind(binned.kind), name: binned.name },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.deletedThingId) : createCommandSuccess();
  },
});

async function authorise(
  context: RequestContext,
  commandName: string,
  action: PermittedAction,
): Promise<RequestActor> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action });

  return actor;
}

/**
 * Reads a bin row and deletes it, in one transaction with whatever happens next.
 *
 * Both commands end with the row gone, so both take it the same way. Deleting it
 * here rather than afterwards is what makes a restore run twice impossible: the
 * second finds nothing and says so, rather than inserting the same rows again on
 * top of the first restore.
 */
async function take(transaction: CommandTransaction, actor: RequestActor, deletedThingId: string) {
  const row = await transaction.database
    .deleteFrom('deletedThing')
    .where('id', '=', deletedThingId)
    .where('accountId', '=', actor.accountId)
    .returning([
      'id',
      'kind',
      'subjectId',
      'name',
      'projectId',
      /*
       * As text, then parsed here.
       *
       * `CamelCasePlugin` renames the keys of any object it finds in a result,
       * including inside a `jsonb` column — and these keys are column names
       * that have to go back exactly as they came out. A string is left alone.
       */
      sql<string>`rows::text`.as('rows'),
      sql<string>`repairs::text`.as('repairs'),
    ])
    .executeTakeFirst();

  if (row === undefined) {
    // Also what another account's bin row looks like, and what one somebody
    // else restored while this screen was open looks like.
    throw new DeletedThingNotFoundError();
  }

  if (!isRecoverableKind(row.kind)) {
    throw new InvariantViolatedError(
      'This was deleted by an older version of the app and can no longer be put back.',
    );
  }

  return {
    ...row,
    kind: row.kind,
    rows: JSON.parse(row.rows) as BinnedRows[],
    repairs: JSON.parse(row.repairs) as BinnedRepair[],
  };
}

/** Where the entry about it belongs in the trail. */
const AGGREGATE_TYPE_BY_KIND: Readonly<Record<RecoverableKind, string>> = {
  team: 'team',
  permissionGroup: 'install',
  milestone: 'project',
  projectDoc: 'project',
  projectRelease: 'project',
  assetCategory: 'project',
  // Under its project, as its category's is: the trail names an entry by joining
  // to the thing, and joins to a project but not to an asset.
  asset: 'project',
  // Under itself rather than under its project, because a restored card exists
  // again — so the trail can join to it and name it by its key, which is how
  // anybody refers to a card.
  card: 'card',
};

/**
 * Which thing the trail files this entry under.
 *
 * A restored milestone is filed under its project rather than under itself: the
 * trail names an entry by joining the aggregate id to the thing, and a project
 * is what somebody scanning for "what happened to Saltmarsh" is looking for. The
 * milestone's own id is in the payload, where it is a fact rather than a join.
 */
function whatItHappenedTo(binned: {
  readonly kind: RecoverableKind;
  readonly subjectId: string;
  readonly projectId: string | null;
}): { aggregateType: string; aggregateId: string } {
  const aggregateType = AGGREGATE_TYPE_BY_KIND[binned.kind];

  return {
    aggregateType,
    aggregateId:
      aggregateType === 'project' ? (binned.projectId ?? binned.subjectId) : binned.subjectId,
  };
}
