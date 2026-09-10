import { createCommandSuccess, updateAssetCategoryCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { isUniqueViolation } from '../../../cqrs/unique-violation.js';
import {
  AssetCategoryNameTakenError,
  AssetCategoryNotInProjectError,
  ProjectArchivedError,
} from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../../projects/project-access.js';

/** Named in `0060-a-category-inside-a-category`, and the only clash this update expects. */
const CATEGORY_NAME_CONSTRAINT = 'asset_category_name_unique_among_siblings';

interface UpdateCategoryInput {
  commandId: string;
  categoryId: string;
  name?: string;
  color?: string;
  budgetMinor?: number | null;
}

/**
 * Changes a category: what it is called, what colour it is drawn in, what it is
 * expected to cost.
 *
 * The same permission a list is managed under, because that is what this is —
 * the shape of the library rather than the work in it.
 */
export const updateAssetCategoryHandler = defineCommandHandler({
  definition: updateAssetCategoryCommand,

  async execute(input: UpdateCategoryInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, updateAssetCategoryCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.manageCategory' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateAssetCategoryCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => updateCategory({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(input.categoryId) : createCommandSuccess();
  },
});

interface UpdateRequest {
  readonly transaction: CommandTransaction;
  readonly input: UpdateCategoryInput;
  readonly actor: RequestActor;
}

async function updateCategory({ transaction, input, actor }: UpdateRequest): Promise<undefined> {
  const category = await transaction.database
    .selectFrom('assetCategory')
    .select(['id', 'projectId', 'name'])
    .where('id', '=', input.categoryId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (category === undefined) {
    // Also what another account's category looks like.
    throw new AssetCategoryNotInProjectError();
  }

  const project = await loadProjectForWrite(transaction.database, actor, category.projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  try {
    await transaction.database
      .updateTable('assetCategory')
      .set({
        // An absent field means "leave it"; `budgetMinor` is the one that can be
        // set back to nothing, which is not the same as being left alone.
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.budgetMinor === undefined ? {} : { budgetMinor: input.budgetMinor }),
      })
      .where('id', '=', category.id)
      .execute();
  } catch (error) {
    if (isUniqueViolation(error, CATEGORY_NAME_CONSTRAINT)) {
      throw new AssetCategoryNameTakenError(input.name ?? category.name);
    }

    throw error;
  }

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: category.projectId,
    name: 'assets.categoryUpdated',
    payload: { projectId: category.projectId },
  });

  return undefined;
}
