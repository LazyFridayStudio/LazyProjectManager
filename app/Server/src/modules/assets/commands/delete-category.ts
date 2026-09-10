import {
  createCommandSuccess,
  deleteAssetCategoryCommand,
  DEFAULT_ASSET_CATEGORY,
  type CommandSuccess,
} from '@lpm/shared';

import type { BinnedRepair } from '@lpm/database';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import {
  AssetCategoryNotInProjectError,
  InvariantViolatedError,
  positionBetween,
  ProjectArchivedError,
} from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../../projects/project-access.js';
import { binIt, howMany } from '../../recovery/index.js';
import { placeCategory } from '../asset-positions.js';

interface DeleteRequest {
  readonly transaction: CommandTransaction;
  readonly categoryId: string;
  readonly actor: RequestActor;
}

/**
 * Takes a category out of a project's library.
 *
 * What it held is not deleted with it. A category is how a studio files things,
 * and refiling is not the same as throwing away — somebody reorganising a
 * library would otherwise have to move eight assets by hand before they were
 * allowed to drop the heading they no longer want.
 *
 * The same permission a list is managed under, because that is what this is:
 * the shape of the board rather than the work on it.
 */
export const deleteAssetCategoryHandler = defineCommandHandler({
  definition: deleteAssetCategoryCommand,

  async execute(
    input: { commandId: string; categoryId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, deleteAssetCategoryCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.manageCategory' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: deleteAssetCategoryCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => deleteCategory({ transaction, categoryId: input.categoryId, actor }),
    });

    return outcome.applied ? createCommandSuccess(input.categoryId) : createCommandSuccess();
  },
});

async function deleteCategory({
  transaction,
  categoryId,
  actor,
}: DeleteRequest): Promise<undefined> {
  const category = await transaction.database
    .selectFrom('assetCategory')
    .select(['id', 'projectId', 'name', 'parentId'])
    .where('id', '=', categoryId)
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

  const held = await transaction.database
    .selectFrom('asset')
    .select('id')
    .where('categoryId', '=', category.id)
    .execute();

  const movedTo =
    held.length === 0
      ? null
      : await moveToDefault({ transaction, category, accountId: actor.accountId });

  const lifted = await liftTheChildren({ transaction, category });

  /*
   * Kept after the assets have moved and before the category goes.
   *
   * The repairs are what this delete did to things it is not deleting, so they
   * are only knowable once the move has happened — and they have to be written
   * down before the category is gone, because they are written down on it.
   *
   * Restoring refiles only the assets still sitting where this move put them.
   * Somebody who filed one somewhere else afterwards meant it.
   */
  await binIt({
    transaction,
    kind: 'assetCategory',
    accountId: actor.accountId,
    actorId: actor.userId,
    subjectId: category.id,
    projectId: category.projectId,
    name: category.name,
    about: howMany(held.length, 'asset', 'assets'),
    repairs: whatThisDeleteMoved({ category, held, movedTo, lifted }),
  });

  await transaction.database.deleteFrom('assetCategory').where('id', '=', category.id).execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: category.projectId,
    name: 'assets.categoryDeleted',
    payload: { projectId: category.projectId, moved: held.length },
  });

  return undefined;
}

/**
 * What the delete changed on rows it is not deleting, so a restore can undo it.
 *
 * Two kinds, and both under the same rule the recycle bin applies to every
 * repair: only put back while the column still holds what this delete left
 * there. Somebody who refiled an asset, or moved a sub-category somewhere else
 * afterwards, meant it.
 */
function whatThisDeleteMoved({
  category,
  held,
  movedTo,
  lifted,
}: {
  readonly category: { id: string; parentId: string | null };
  readonly held: readonly { id: string }[];
  readonly movedTo: string | null;
  readonly lifted: readonly { id: string }[];
}): BinnedRepair[] {
  const assets =
    movedTo === null
      ? []
      : held.map((asset) => ({
          table: 'asset',
          id: asset.id,
          column: 'category_id',
          was: category.id,
          now: movedTo,
        }));

  // Putting the category back puts what was inside it back inside it.
  const children = lifted.map((child) => ({
    table: 'asset_category',
    id: child.id,
    column: 'parent_id',
    was: category.id,
    now: category.parentId,
  }));

  return [...assets, ...children];
}

interface LiftRequest {
  readonly transaction: CommandTransaction;
  readonly category: { id: string; projectId: string; name: string; parentId: string | null };
}

/**
 * What was inside it comes up to where it sat.
 *
 * Deleting a heading is refiling rather than throwing away — the promise the
 * assets already have — and a sub-category is a heading. Up to the level the
 * parent was on rather than out to the top: somebody deleting a middle heading
 * out of `Props > Interior > Destructible` means the two ends to meet, not the
 * bottom to be flung to the surface.
 *
 * Placed at the end of where they land, because they are arriving among
 * headings that already have an order and the positions they had were an order
 * among each other.
 */
async function liftTheChildren({
  transaction,
  category,
}: LiftRequest): Promise<readonly { id: string }[]> {
  const children = await transaction.database
    .selectFrom('assetCategory')
    .select(['id', 'name'])
    .where('parentId', '=', category.id)
    .orderBy('position')
    .execute();

  if (children.length === 0) {
    return [];
  }

  await refuseIfANameIsTaken({ transaction, category, children });

  for (const child of children) {
    const position = await placeCategory({
      transaction: transaction.database,
      projectId: category.projectId,
      parentId: category.parentId,
      categoryId: child.id,
      beforeCategoryId: null,
      afterCategoryId: null,
    });

    await transaction.database
      .updateTable('assetCategory')
      .set({ parentId: category.parentId, position })
      .where('id', '=', child.id)
      .execute();
  }

  return children.map((child) => ({ id: child.id }));
}

/**
 * A child cannot come up into a place where its name is already taken.
 *
 * Names are unique among siblings, so lifting `Weapons` out of `Props` into a
 * library that already has a `Weapons` at the top is a delete that cannot
 * finish. Refused with the name in the message rather than reported as a
 * constraint: somebody who renames one of the two can then delete the heading,
 * and nothing about a unique index tells them that.
 */
async function refuseIfANameIsTaken({
  transaction,
  category,
  children,
}: LiftRequest & { children: readonly { id: string; name: string }[] }): Promise<void> {
  const destination = transaction.database
    .selectFrom('assetCategory')
    .select('name')
    .where('projectId', '=', category.projectId)
    .where('id', '!=', category.id)
    .where(
      'name',
      'in',
      children.map((child) => child.name),
    );

  const taken =
    category.parentId === null
      ? await destination.where('parentId', 'is', null).execute()
      : await destination.where('parentId', '=', category.parentId).execute();

  const clash = taken[0];

  if (clash !== undefined) {
    throw new InvariantViolatedError(
      `${clash.name} is inside ${category.name} and there is already a ${clash.name} where ${category.name} sits. Rename one of them before deleting ${category.name}.`,
    );
  }
}

interface MoveRequest {
  readonly transaction: CommandTransaction;
  readonly category: { id: string; projectId: string; name: string };
  readonly accountId: string;
}

/**
 * Sends everything the category held to `Unorganised`, making it if it is not
 * there yet.
 *
 * Deleting `Unorganised` while it still holds things is the one case with
 * nowhere to move to, and is refused rather than quietly resolved: it is where
 * things go, and a rule that deleted the destination would be a rule that lost
 * the assets.
 */
async function moveToDefault({ transaction, category, accountId }: MoveRequest): Promise<string> {
  const existing = await transaction.database
    .selectFrom('assetCategory')
    .select('id')
    .where('projectId', '=', category.projectId)
    .where('name', '=', DEFAULT_ASSET_CATEGORY.name)
    .executeTakeFirst();

  if (existing?.id === category.id) {
    throw new InvariantViolatedError(
      `${DEFAULT_ASSET_CATEGORY.name} is where assets go when their category is deleted. Move what is in it somewhere else first.`,
    );
  }

  const destinationId = existing?.id ?? (await createDefault({ transaction, category, accountId }));

  await transaction.database
    .updateTable('asset')
    .set({ categoryId: destinationId })
    .where('categoryId', '=', category.id)
    .execute();

  return destinationId;
}

/** Made only when something needs somewhere to go, and put at the end. */
async function createDefault({ transaction, category, accountId }: MoveRequest): Promise<string> {
  const last = await transaction.database
    .selectFrom('assetCategory')
    .select('position')
    .where('projectId', '=', category.projectId)
    .orderBy('position', 'desc')
    .limit(1)
    .executeTakeFirst();

  const created = await transaction.database
    .insertInto('assetCategory')
    .values({
      accountId,
      projectId: category.projectId,
      name: DEFAULT_ASSET_CATEGORY.name,
      color: DEFAULT_ASSET_CATEGORY.color,
      // No budget: it is not a kind of thing anybody plans to spend on.
      budgetMinor: null,
      position: positionBetween(last === undefined ? null : Number(last.position), null),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return created.id;
}
