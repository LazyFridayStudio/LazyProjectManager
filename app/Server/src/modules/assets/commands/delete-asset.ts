import { createCommandSuccess, deleteAssetCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import { AssetNotFoundError, ProjectArchivedError } from '../../../domain/index.js';
import {
  assertProjectPermission,
  authoriseWithinProject,
  loadMembershipRole,
} from '../../projects/project-access.js';
import { binIt } from '../../recovery/index.js';

interface DeleteRequest {
  readonly transaction: CommandTransaction;
  readonly context: RequestContext;
  readonly assetId: string;
  readonly actor: RequestActor;
}

/**
 * Takes an asset out of the library.
 *
 * Its own permission rather than `asset.update`, for the reason a card's delete
 * is: "may retag the watchtower" and "may throw away its reference sheet" are
 * not the same trust, and a studio wanting the first without the second could
 * not otherwise say so.
 *
 * Everything hanging off the asset cascades in the database — its pictures, its
 * files, its stages, its tags, the hours logged against it, its links to cards —
 * so all of it would go silently. The bin copy is taken first, so a restore
 * brings back the asset as it stood rather than an empty tile with the right
 * name.
 */
export const deleteAssetHandler = defineCommandHandler({
  definition: deleteAssetCommand,

  async execute(input: { commandId: string; assetId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, deleteAssetCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.delete' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: deleteAssetCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => deleteAsset({ transaction, context, assetId: input.assetId, actor }),
    });

    return outcome.applied ? createCommandSuccess(input.assetId) : createCommandSuccess();
  },
});

async function deleteAsset({
  transaction,
  context,
  assetId,
  actor,
}: DeleteRequest): Promise<undefined> {
  /*
   * Found inside the transaction, after the command id is claimed.
   *
   * So a delete sent twice finds the first one already recorded and answers as
   * it did, rather than going looking for an asset it has just deleted and
   * saying it was never there.
   */
  const asset = await transaction.database
    .selectFrom('asset')
    .innerJoin('project', 'project.id', 'asset.projectId')
    .select([
      'asset.id',
      'asset.projectId',
      'asset.name',
      'asset.assetKey',
      'project.archivedAt as projectArchivedAt',
    ])
    .where('asset.id', '=', assetId)
    .where('asset.accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    // Also what another account's asset looks like.
    throw new AssetNotFoundError();
  }

  // Whether they reach this project as well as whether they delete assets at
  // all: a project somebody is not on is one they cannot empty.
  await authoriseWithinProject({
    context,
    handlerName: deleteAssetCommand.name,
    projectId: asset.projectId,
    action: 'asset.delete',
  });

  if (asset.projectArchivedAt !== null) {
    throw new ProjectArchivedError();
  }

  await binIt({
    transaction,
    kind: 'asset',
    accountId: actor.accountId,
    actorId: actor.userId,
    subjectId: asset.id,
    projectId: asset.projectId,
    name: asset.name,
    // Its key, which is how anybody says which asset they mean — and it carries
    // the project's code, so the bin reads without a join.
    about: asset.assetKey,
  });

  await transaction.database.deleteFrom('asset').where('id', '=', asset.id).execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: asset.projectId,
    name: 'assets.assetDeleted',
    /*
     * What it was called travels with the entry.
     *
     * By the time anybody reads the trail the asset is gone, so there is no row
     * to join to for its name — without these, the entry could say only that
     * something was deleted.
     */
    payload: {
      projectId: asset.projectId,
      assetId: asset.id,
      assetKey: asset.assetKey,
      name: asset.name,
    },
  });

  return undefined;
}
