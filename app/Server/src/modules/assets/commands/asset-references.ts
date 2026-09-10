import {
  createCommandSuccess,
  moveAssetReferenceCommand,
  promoteAssetReferenceCommand,
  removeAssetReferenceCommand,
  type CommandSuccess,
} from '@lpm/shared';

import type { DatabaseTransaction } from '@lpm/database';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { AssetNotFoundError, positionBetween, type MembershipRole } from '../../../domain/index.js';
import { loadWritableProject } from '../../board/cards/card-access.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

interface ReferenceRequest {
  readonly transaction: CommandTransaction;
  readonly referenceId: string;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

interface LoadedReference {
  readonly id: string;
  readonly assetId: string;
  readonly fileId: string;
  readonly projectId: string;
  readonly accountId: string;
}

/**
 * The reference, and whether this caller may change the asset it hangs on.
 *
 * Reached through its asset's project, so an id from another install is refused
 * by the rule that already governs the asset rather than by a second one written
 * here.
 */
async function loadWritableReference(
  database: DatabaseTransaction,
  { referenceId, actor, role }: Omit<ReferenceRequest, 'transaction'>,
): Promise<LoadedReference> {
  const reference = await database
    .selectFrom('assetReference')
    .innerJoin('asset', 'asset.id', 'assetReference.assetId')
    .select([
      'assetReference.id',
      'assetReference.assetId',
      'assetReference.fileId',
      'asset.projectId',
    ])
    .where('assetReference.id', '=', referenceId)
    .where('assetReference.accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (reference === undefined) {
    // Also what another account's reference looks like. Nobody learns one exists
    // by guessing at an id.
    throw new AssetNotFoundError();
  }

  const project = await loadWritableProject({ database, actor, role }, reference.projectId);

  return { ...reference, accountId: project.accountId };
}

/**
 * Takes a picture off an asset.
 *
 * The object stays in the store, as it does when a file leaves a card: the same
 * file can be a reference on more than one asset, and deleting the bytes because
 * one of them let go would break the others.
 */
export const removeAssetReferenceHandler = defineCommandHandler({
  definition: removeAssetReferenceCommand,

  async execute(
    input: { commandId: string; referenceId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, removeAssetReferenceCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: removeAssetReferenceCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) =>
        removeReference({ transaction, referenceId: input.referenceId, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.referenceId) : createCommandSuccess();
  },
});

async function removeReference({
  transaction,
  referenceId,
  actor,
  role,
}: ReferenceRequest): Promise<void> {
  const reference = await loadWritableReference(transaction.database, { referenceId, actor, role });

  await transaction.database.deleteFrom('assetReference').where('id', '=', reference.id).execute();

  transaction.appendEvent({
    accountId: reference.accountId,
    aggregateType: 'asset',
    aggregateId: reference.assetId,
    name: 'assets.referenceRemoved',
    payload: { projectId: reference.projectId, fileId: reference.fileId },
  });
}

/**
 * Makes one of the pictures the first one, which is the one a tile shows.
 *
 * A reorder rather than a column on the asset. A column would let the tile and
 * the sheet disagree about which picture comes first, and there is no reading of
 * an asset where that is a useful thing to be able to say.
 */
export const promoteAssetReferenceHandler = defineCommandHandler({
  definition: promoteAssetReferenceCommand,

  async execute(
    input: { commandId: string; referenceId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, promoteAssetReferenceCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: promoteAssetReferenceCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) =>
        promoteReference({ transaction, referenceId: input.referenceId, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.referenceId) : createCommandSuccess();
  },
});

interface MoveInput {
  commandId: string;
  referenceId: string;
  beforeReferenceId?: string | null;
  afterReferenceId?: string | null;
}

/**
 * Moves a reference within the sheet.
 *
 * The general form of "make thumbnail": dropping one at the front is the same
 * act as promoting it, because the first picture is what the library tile
 * draws. Neighbours rather than an index, as a card move is — an index means
 * something different by the time it arrives.
 */
export const moveAssetReferenceHandler = defineCommandHandler({
  definition: moveAssetReferenceCommand,

  async execute(input: MoveInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, moveAssetReferenceCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: moveAssetReferenceCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => moveReference({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.referenceId) : createCommandSuccess();
  },
});

async function moveReference({
  transaction,
  input,
  actor,
  role,
}: {
  transaction: CommandTransaction;
  input: MoveInput;
  actor: RequestActor;
  role: MembershipRole;
}): Promise<void> {
  const reference = await loadWritableReference(transaction.database, {
    referenceId: input.referenceId,
    actor,
    role,
  });

  const [before, after] = await Promise.all([
    positionOf(transaction, reference.assetId, input.beforeReferenceId),
    positionOf(transaction, reference.assetId, input.afterReferenceId),
  ]);

  await transaction.database
    .updateTable('assetReference')
    // `after` is the one it lands below, so it is the lower bound.
    .set({ position: positionBetween(after, before) })
    .where('id', '=', reference.id)
    .execute();

  transaction.appendEvent({
    accountId: reference.accountId,
    aggregateType: 'asset',
    aggregateId: reference.assetId,
    name: 'assets.referenceMoved',
    payload: { projectId: reference.projectId, fileId: reference.fileId },
  });
}

/**
 * Where a neighbour sits, or null if none was named.
 *
 * A neighbour that was named and is not on this sheet is refused rather than
 * ignored. Ignoring it would leave the move with no bounds at all, which puts
 * the picture at the same position as whatever is already first — two rows with
 * one position is an order the database cannot answer for.
 */
async function positionOf(
  transaction: CommandTransaction,
  assetId: string,
  referenceId: string | null | undefined,
): Promise<number | null> {
  if (referenceId === null || referenceId === undefined) return null;

  const row = await transaction.database
    .selectFrom('assetReference')
    .select('position')
    .where('id', '=', referenceId)
    .where('assetId', '=', assetId)
    .executeTakeFirst();

  if (row === undefined) {
    throw new AssetNotFoundError();
  }

  return Number(row.position);
}

async function promoteReference({
  transaction,
  referenceId,
  actor,
  role,
}: ReferenceRequest): Promise<void> {
  const reference = await loadWritableReference(transaction.database, { referenceId, actor, role });

  const first = await transaction.database
    .selectFrom('assetReference')
    .select('position')
    .where('assetId', '=', reference.assetId)
    .orderBy('position')
    .limit(1)
    .executeTakeFirst();

  // Ahead of whatever is first now, by the midpoint arithmetic the board moves
  // cards with. Nothing else on the sheet has to be rewritten.
  await transaction.database
    .updateTable('assetReference')
    .set({ position: positionBetween(null, first === undefined ? null : Number(first.position)) })
    .where('id', '=', reference.id)
    .execute();

  transaction.appendEvent({
    accountId: reference.accountId,
    aggregateType: 'asset',
    aggregateId: reference.assetId,
    name: 'assets.referencePromoted',
    payload: { projectId: reference.projectId, fileId: reference.fileId },
  });
}
