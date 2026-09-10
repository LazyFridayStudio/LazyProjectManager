import {
  createCommandSuccess,
  linkAssetFileCommand,
  removeAssetFileCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { AssetNotFoundError, positionBetween, type MembershipRole } from '../../../domain/index.js';
import { loadWritableProject } from '../../board/cards/card-access.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

interface LinkFileRequest {
  readonly transaction: CommandTransaction;
  readonly input: { assetId: string; label: string; url: string };
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

/**
 * Points an asset at a file that lives somewhere else.
 *
 * The other half of uploading one. A studio with a Perforce depot, a NAS or a
 * shared drive already keeps the source file somewhere, and a library that
 * could only hold copies would be a library holding out-of-date copies.
 */
export const linkAssetFileHandler = defineCommandHandler({
  definition: linkAssetFileCommand,

  async execute(
    input: { commandId: string; assetId: string; label: string; url: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, linkAssetFileCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: linkAssetFileCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => linkFile({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

async function linkFile({ transaction, input, actor, role }: LinkFileRequest): Promise<string> {
  const asset = await transaction.database
    .selectFrom('asset')
    .select(['id', 'projectId'])
    .where('id', '=', input.assetId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    throw new AssetNotFoundError();
  }

  // Reached through its project, so who may add to it is the rule that already
  // governs the asset rather than a second one written here.
  const project = await loadWritableProject(
    { database: transaction.database, actor, role },
    asset.projectId,
  );

  const last = await transaction.database
    .selectFrom('assetFile')
    .select('position')
    .where('assetId', '=', asset.id)
    .orderBy('position', 'desc')
    .limit(1)
    .executeTakeFirst();

  const linked = await transaction.database
    .insertInto('assetFile')
    .values({
      accountId: project.accountId,
      assetId: asset.id,
      // The database holds a row to one or the other, so this says out loud
      // which half is being written.
      fileId: null,
      url: input.url,
      label: input.label,
      position: positionBetween(last === undefined ? null : Number(last.position), null),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  transaction.appendEvent({
    accountId: project.accountId,
    aggregateType: 'asset',
    aggregateId: asset.id,
    // No URL and no label: the outbox is read more widely than the asset, and a
    // path on a studio's depot says what they are working on and where.
    name: 'assets.fileLinked',
    payload: { projectId: asset.projectId, assetFileId: linked.id },
  });

  return linked.id;
}

/**
 * Takes a file off an asset.
 *
 * An uploaded one keeps its bytes in the store, as it does when it leaves a
 * card: the same file can hang off more than one thing, and deleting the bytes
 * because one of them let go would break the others. A linked one was never
 * ours to delete.
 */
export const removeAssetFileHandler = defineCommandHandler({
  definition: removeAssetFileCommand,

  async execute(
    input: { commandId: string; assetFileId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, removeAssetFileCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: removeAssetFileCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const assetFile = await transaction.database
          .selectFrom('assetFile')
          .innerJoin('asset', 'asset.id', 'assetFile.assetId')
          .select(['assetFile.id', 'assetFile.assetId', 'asset.projectId'])
          .where('assetFile.id', '=', input.assetFileId)
          .where('assetFile.accountId', '=', actor.accountId)
          .executeTakeFirst();

        if (assetFile === undefined) {
          // Also what another account's file looks like. Nobody learns one
          // exists by guessing at an id.
          throw new AssetNotFoundError();
        }

        const project = await loadWritableProject(
          { database: transaction.database, actor, role },
          assetFile.projectId,
        );

        await transaction.database.deleteFrom('assetFile').where('id', '=', assetFile.id).execute();

        transaction.appendEvent({
          accountId: project.accountId,
          aggregateType: 'asset',
          aggregateId: assetFile.assetId,
          name: 'assets.fileRemoved',
          payload: { projectId: assetFile.projectId, assetFileId: assetFile.id },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.assetFileId) : createCommandSuccess();
  },
});
