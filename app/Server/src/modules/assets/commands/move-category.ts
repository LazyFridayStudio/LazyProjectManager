import { sql } from '@lpm/database';
import { createCommandSuccess, moveAssetCategoryCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { AssetCategoryNotInProjectError, ProjectArchivedError } from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../../projects/project-access.js';
import { placeCategory } from '../asset-positions.js';

interface MoveCategoryInput {
  commandId: string;
  categoryId: string;
  /** Absent leaves it where it is; null puts it at the top level. */
  parentId?: string | null;
  beforeCategoryId?: string | null;
  afterCategoryId?: string | null;
}

/**
 * Moves a category up or down the library.
 *
 * The same permission changing one is under, because that is what this is — the
 * shape of the library rather than the work in it. Somebody who may rename a
 * heading may decide what order the headings read in.
 */
export const moveAssetCategoryHandler = defineCommandHandler({
  definition: moveAssetCategoryCommand,

  async execute(input: MoveCategoryInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, moveAssetCategoryCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.manageCategory' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: moveAssetCategoryCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => moveCategory({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(input.categoryId) : createCommandSuccess();
  },
});

interface MoveRequest {
  readonly transaction: CommandTransaction;
  readonly input: MoveCategoryInput;
  readonly actor: RequestActor;
}

async function moveCategory({ transaction, input, actor }: MoveRequest): Promise<undefined> {
  const category = await transaction.database
    .selectFrom('assetCategory')
    .select(['id', 'projectId', 'parentId'])
    .where('id', '=', input.categoryId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (category === undefined) {
    // Also what another account's category looks like. Nobody learns one exists
    // by guessing at an id.
    throw new AssetCategoryNotInProjectError();
  }

  const project = await loadProjectForWrite(transaction.database, actor, category.projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  // Absent means "stay where you are", which is every reorder among siblings.
  const parentId = input.parentId === undefined ? category.parentId : input.parentId;

  await refuseToPutItInsideItself({ transaction, category, parentId, actor });

  /*
   * The neighbours are not checked against the project.
   *
   * They are advice about where to land rather than rows being written: one
   * that is not in this library is simply not found among the siblings, and
   * `placeAmong` falls back to the other side — or to the end when neither is
   * there. Refusing instead would mean a drop failing because somebody else
   * deleted the heading it was dropped next to a moment earlier.
   */
  const position = await placeCategory({
    transaction: transaction.database,
    projectId: category.projectId,
    parentId,
    categoryId: category.id,
    beforeCategoryId: input.beforeCategoryId,
    afterCategoryId: input.afterCategoryId,
  });

  await transaction.database
    .updateTable('assetCategory')
    .set({ parentId, position })
    .where('id', '=', category.id)
    .execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: category.projectId,
    // No position in the payload: the order a studio reads its own library in
    // says what it is working on, and the trail is read more widely than the
    // library is.
    name: 'assets.categoryMoved',
    payload: { projectId: category.projectId, categoryId: category.id },
  });

  return undefined;
}

interface CycleCheck {
  readonly transaction: CommandTransaction;
  readonly category: { readonly id: string };
  readonly parentId: string | null;
  readonly actor: RequestActor;
}

/**
 * A category cannot be moved inside itself, or inside anything under itself.
 *
 * The one shape an adjacency list cannot refuse on its own, and the one that
 * costs the most: a cycle is a subtree that has left the library — nothing can
 * reach it, no screen draws it, and the assets in it are gone without anything
 * having been deleted. Every walk over the tree afterwards is a walk that does
 * not end.
 *
 * Walked upwards from the proposed parent rather than downwards over the moved
 * category's descendants, because a chain of ancestors is at most as long as the
 * tree is deep and a subtree is as big as the library.
 *
 * The parent is checked against the account here, which the neighbours above
 * deliberately are not: a neighbour is advice about ordering and a parent is
 * written down.
 */
async function refuseToPutItInsideItself({
  transaction,
  category,
  parentId,
  actor,
}: CycleCheck): Promise<void> {
  if (parentId === null) {
    return;
  }

  if (parentId === category.id) {
    throw new AssetCategoryNotInProjectError();
  }

  const ancestors = await sql<{ id: string }>`
    with recursive ancestors as (
      select id, parent_id
      from asset_category
      where id = ${parentId}
        and account_id = ${actor.accountId}
      union all
      select above.id, above.parent_id
      from asset_category as above
        join ancestors on ancestors.parent_id = above.id
    )
    select id from ancestors
  `.execute(transaction.database);

  const reachable = ancestors.rows.map((row) => row.id);

  // An empty walk means the parent is not this account's, which is the same
  // answer as "no such category" for the same reason it is everywhere else.
  if (reachable.length === 0 || reachable.includes(category.id)) {
    throw new AssetCategoryNotInProjectError();
  }
}
