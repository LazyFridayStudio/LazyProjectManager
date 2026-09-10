import { createCommandSuccess, moveAssetCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { AssetNotFoundError, type MembershipRole } from '../../../domain/index.js';
import { loadWritableProject } from '../../board/cards/card-access.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { placeAsset } from '../asset-positions.js';

interface MoveAssetInput {
  commandId: string;
  assetId: string;
  toCategoryId: string;
  beforeAssetId?: string | null;
  afterAssetId?: string | null;
}

/**
 * Moves an asset, within a category or into another one.
 *
 * A library is a running order as much as a list — the hero prop first, the set
 * dressing after it — and until this the only order was the one things were
 * made in. `asset.position` has been what the library reads by all along;
 * nothing could change it.
 */
export const moveAssetHandler = defineCommandHandler({
  definition: moveAssetCommand,

  async execute(input: MoveAssetInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, moveAssetCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: moveAssetCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => moveAsset({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.assetId) : createCommandSuccess();
  },
});

interface MoveAssetRequest {
  readonly transaction: CommandTransaction;
  readonly input: MoveAssetInput;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function moveAsset(request: MoveAssetRequest): Promise<void> {
  const { transaction, input, actor } = request;

  const asset = await transaction.database
    .selectFrom('asset')
    .select(['id', 'projectId', 'categoryId'])
    .where('id', '=', input.assetId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    // Also what another account's asset looks like. Nobody learns one exists by
    // guessing at an id.
    throw new AssetNotFoundError();
  }

  const project = await loadWritableProject(
    { database: transaction.database, actor, role: request.role },
    asset.projectId,
  );

  /*
   * The category has to be one of this project's own.
   *
   * Without it, a category id from another project would move an asset out of
   * the library it belongs to and into one whose project never agreed to it —
   * and the screen it left would simply stop showing it.
   */
  const category = await transaction.database
    .selectFrom('assetCategory')
    .select('id')
    .where('id', '=', input.toCategoryId)
    .where('projectId', '=', asset.projectId)
    .executeTakeFirst();

  if (category === undefined) {
    throw new AssetNotFoundError();
  }

  const position = await placeAsset({
    transaction: transaction.database,
    categoryId: category.id,
    assetId: asset.id,
    beforeAssetId: input.beforeAssetId,
    afterAssetId: input.afterAssetId,
  });

  await transaction.database
    .updateTable('asset')
    .set({ categoryId: category.id, position, updatedAt: new Date() })
    .where('id', '=', asset.id)
    .execute();

  transaction.appendEvent({
    accountId: project.accountId,
    aggregateType: 'asset',
    aggregateId: asset.id,
    name: 'assets.moved',
    // No position in the payload: the outbox is read more widely than the
    // library, and where a studio puts a thing in its own running order says
    // what it is working on next.
    payload: {
      projectId: asset.projectId,
      fromCategoryId: asset.categoryId,
      toCategoryId: category.id,
    },
  });
}
