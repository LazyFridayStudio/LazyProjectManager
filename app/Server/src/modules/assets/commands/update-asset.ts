import { createCommandSuccess, updateAssetCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import {
  AssetCategoryNotInProjectError,
  AssetNotFoundError,
  ProjectArchivedError,
} from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { assertPeopleAreOnTheProject } from '../../projects/project-people.js';

interface UpdateAssetInput {
  commandId: string;
  assetId: string;
  categoryId?: string;
  name?: string;
  status?: 'concept' | 'wip' | 'review' | 'approved' | 'final';
  description?: string | null;
  estimatedCostMinor?: number | null;
  dueOn?: string | null;
  assigneeId?: string | null;
  reporterId?: string | null;
}

/**
 * Changes an asset.
 *
 * An absent field means "leave it", so two people editing different things at
 * once do not overwrite each other. The panel owns every field and sends every
 * field, so it never relies on that — but a script fixing one field across a
 * hundred assets does, and the rule costs nothing to keep.
 */
export const updateAssetHandler = defineCommandHandler({
  definition: updateAssetCommand,

  async execute(input: UpdateAssetInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, updateAssetCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    await executeCommand({
      database: context.database,
      commandName: updateAssetCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => applyUpdate({ transaction, input, actor }),
    });

    return createCommandSuccess(input.assetId);
  },
});

interface UpdateRequest {
  readonly transaction: CommandTransaction;
  readonly input: UpdateAssetInput;
  readonly actor: RequestActor;
}

async function applyUpdate({ transaction, input, actor }: UpdateRequest): Promise<void> {
  const asset = await transaction.database
    .selectFrom('asset')
    .innerJoin('project', 'project.id', 'asset.projectId')
    .select(['asset.id', 'asset.projectId', 'project.archivedAt'])
    .where('asset.id', '=', input.assetId)
    .where('asset.accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    throw new AssetNotFoundError();
  }

  if (asset.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  if (input.categoryId !== undefined) {
    await assertCategoryIsInProject(transaction, input.categoryId, asset.projectId);
  }

  /*
   * The same rule a card is held to, and the same function that holds it.
   *
   * An asset handed to somebody who is not on the project is work nobody picks
   * up, and the picker is not what stops it: an id can arrive from a pasted
   * request, or name somebody taken off the project since.
   */
  await assertPeopleAreOnTheProject({
    database: transaction.database,
    projectId: asset.projectId,
    assigneeId: input.assigneeId,
    reporterId: input.reporterId,
  });

  const patch = buildPatch(input);

  if (Object.keys(patch).length === 0) {
    return;
  }

  await transaction.database
    .updateTable('asset')
    .set({ ...patch, updatedAt: new Date() })
    .where('id', '=', asset.id)
    .execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: asset.projectId,
    name: 'assets.assetUpdated',
    payload: { assetId: asset.id, changed: Object.keys(patch) },
  });
}

/**
 * Re-filing an asset only ever moves it within its own project.
 *
 * A category id from elsewhere would otherwise file it somewhere nobody looking
 * at the project can see.
 */
async function assertCategoryIsInProject(
  transaction: CommandTransaction,
  categoryId: string,
  projectId: string,
): Promise<void> {
  const category = await transaction.database
    .selectFrom('assetCategory')
    .select('id')
    .where('id', '=', categoryId)
    .where('projectId', '=', projectId)
    .executeTakeFirst();

  if (category === undefined) {
    throw new AssetCategoryNotInProjectError();
  }
}

/** Only the fields that arrived, so an absent one is left alone. */
function buildPatch(input: UpdateAssetInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (input.categoryId !== undefined) {
    patch.categoryId = input.categoryId;
  }

  if (input.name !== undefined) {
    patch.name = input.name;
  }

  if (input.status !== undefined) {
    patch.status = input.status;
  }

  if (input.description !== undefined) {
    patch.description = blankToNull(input.description);
  }

  if (input.estimatedCostMinor !== undefined) {
    patch.estimatedCostMinor = input.estimatedCostMinor;
  }

  if (input.dueOn !== undefined) {
    patch.dueOn = input.dueOn;
  }

  if (input.assigneeId !== undefined) {
    patch.assigneeId = input.assigneeId;
  }

  if (input.reporterId !== undefined) {
    patch.reporterId = input.reporterId;
  }

  return patch;
}

function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}
