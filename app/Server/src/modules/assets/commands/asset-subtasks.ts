import {
  addAssetSubtaskCommand,
  createCommandSuccess,
  removeAssetSubtaskCommand,
  updateAssetSubtaskCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { AssetNotFoundError, positionBetween, type MembershipRole } from '../../../domain/index.js';
import { loadWritableProject } from '../../board/cards/card-access.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

/**
 * The stages an asset is made in.
 *
 * A card has had these since `0005-card-activity`; an asset has had one status
 * for the whole thing and no way to say that the mesh is done and the textures
 * are not. Same three commands, same shape, against `asset_subtask`.
 *
 * Reached through the asset, and the asset through its project, so who may
 * change a stage is the rule that already governs the asset — `asset.update` —
 * rather than a second one written here. A stage id on its own says nothing
 * about who may touch it.
 */

interface AssetAccess {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

interface WritableAsset {
  readonly id: string;
  readonly projectId: string;
  readonly accountId: string;
}

async function loadWritableAsset(access: AssetAccess, assetId: string): Promise<WritableAsset> {
  const asset = await access.transaction.database
    .selectFrom('asset')
    .select(['id', 'projectId'])
    .where('id', '=', assetId)
    .where('accountId', '=', access.actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    // Also what another account's asset looks like. Nobody learns one exists by
    // guessing at an id.
    throw new AssetNotFoundError();
  }

  const project = await loadWritableProject(
    { database: access.transaction.database, actor: access.actor, role: access.role },
    asset.projectId,
  );

  return { ...asset, accountId: project.accountId };
}

/**
 * The asset a stage belongs to, which is the thing permission is asked about.
 *
 * Missing reads as the asset being missing rather than as the stage being
 * missing: the caller only ever had the id because the panel gave it to them,
 * and a stage somebody else removed in the meantime is the same nothing.
 */
async function loadAssetOfSubtask(
  access: AssetAccess,
  assetSubtaskId: string,
): Promise<WritableAsset> {
  const subtask = await access.transaction.database
    .selectFrom('assetSubtask')
    .select('assetId')
    .where('id', '=', assetSubtaskId)
    .executeTakeFirst();

  if (subtask === undefined) {
    throw new AssetNotFoundError();
  }

  return loadWritableAsset(access, subtask.assetId);
}

function appendAssetEvent(
  transaction: CommandTransaction,
  asset: WritableAsset,
  name: string,
): void {
  transaction.appendEvent({
    accountId: asset.accountId,
    aggregateType: 'asset',
    aggregateId: asset.id,
    // No title in the payload: the outbox is read more widely than the asset,
    // and what a studio has left to do on a thing says what it is working on.
    name,
    payload: { projectId: asset.projectId },
  });
}

/** Adds a stage to an asset. It goes on the end of the ones already there. */
export const addAssetSubtaskHandler = defineCommandHandler({
  definition: addAssetSubtaskCommand,

  async execute(
    input: { commandId: string; assetId: string; title: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, addAssetSubtaskCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: addAssetSubtaskCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const asset = await loadWritableAsset({ transaction, actor, role }, input.assetId);

        const last = await transaction.database
          .selectFrom('assetSubtask')
          .select(({ fn }) => fn.max('position').as('lastPosition'))
          .where('assetId', '=', asset.id)
          .executeTakeFirst();

        const subtask = await transaction.database
          .insertInto('assetSubtask')
          .values({
            assetId: asset.id,
            title: input.title,
            position: positionBetween(readPosition(last?.lastPosition), null),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        appendAssetEvent(transaction, asset, 'assets.subtaskAdded');

        return { assetSubtaskId: subtask.id };
      },
    });

    return outcome.applied
      ? createCommandSuccess(outcome.result.assetSubtaskId)
      : createCommandSuccess();
  },
});

/** Ticks a stage off, unticks it, or renames it. */
export const updateAssetSubtaskHandler = defineCommandHandler({
  definition: updateAssetSubtaskCommand,

  async execute(
    input: { commandId: string; assetSubtaskId: string; title?: string; done?: boolean },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, updateAssetSubtaskCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateAssetSubtaskCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const asset = await loadAssetOfSubtask({ transaction, actor, role }, input.assetSubtaskId);

        const patch: Record<string, unknown> = {};

        if (input.title !== undefined) patch.title = input.title;

        if (input.done !== undefined) patch.done = input.done;

        await transaction.database
          .updateTable('assetSubtask')
          .set(patch)
          .where('id', '=', input.assetSubtaskId)
          .execute();

        appendAssetEvent(transaction, asset, 'assets.subtaskUpdated');
      },
    });

    return outcome.applied ? createCommandSuccess(input.assetSubtaskId) : createCommandSuccess();
  },
});

/** Removes a stage. Stages are working notes, so this really does delete. */
export const removeAssetSubtaskHandler = defineCommandHandler({
  definition: removeAssetSubtaskCommand,

  async execute(
    input: { commandId: string; assetSubtaskId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, removeAssetSubtaskCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: removeAssetSubtaskCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const asset = await loadAssetOfSubtask({ transaction, actor, role }, input.assetSubtaskId);

        await transaction.database
          .deleteFrom('assetSubtask')
          .where('id', '=', input.assetSubtaskId)
          .execute();

        appendAssetEvent(transaction, asset, 'assets.subtaskRemoved');
      },
    });

    return outcome.applied ? createCommandSuccess(input.assetSubtaskId) : createCommandSuccess();
  },
});

/** `numeric` arrives from `pg` as a string, so every read goes through here. */
function readPosition(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}
