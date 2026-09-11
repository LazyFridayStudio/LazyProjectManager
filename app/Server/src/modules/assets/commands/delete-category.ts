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
  nameWhereTheyLand,
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
import { whileNamesSettle } from '../category-names.js';

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

  /*
   * Names are checked once the category has gone, not at each row on the way.
   *
   * What was inside it comes up while it is still here — its children point at
   * it until they have moved, and the bin copies it after — so a `Props` inside
   * `Props` stands beside its parent until the parent is deleted. That is a
   * clash on the way to a library without one.
   */
  await whileNamesSettle({
    transaction: transaction.database,
    work: async () => {
      const lifted = await liftTheChildren({ transaction, category });

      /*
       * Kept after what it held has moved and before the category goes.
       *
       * The repairs are what this delete did to things it is not deleting, so
       * they are only knowable once the move has happened — and they have to be
       * written down before the category is gone, because they are written down
       * on it.
       *
       * Restoring refiles only the assets still sitting where this move put
       * them. Somebody who filed one somewhere else afterwards meant it.
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

      await transaction.database
        .deleteFrom('assetCategory')
        .where('id', '=', category.id)
        .execute();
    },
  });

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
 * Three kinds, and all under the same rule the recycle bin applies to every
 * repair: only put back while the column still holds what this delete left
 * there. Somebody who refiled an asset, moved a sub-category somewhere else or
 * renamed one afterwards meant it.
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
  readonly lifted: readonly LiftedChild[];
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

  // And under the name it had in there, for one that came up under another.
  const names = lifted
    .filter((child) => child.cameUpAs !== child.name)
    .map((child) => ({
      table: 'asset_category',
      id: child.id,
      column: 'name',
      was: child.name,
      now: child.cameUpAs,
    }));

  return [...assets, ...children, ...names];
}

interface LiftRequest {
  readonly transaction: CommandTransaction;
  readonly category: { id: string; projectId: string; name: string; parentId: string | null };
}

/** A category that came up out of the one being deleted. */
interface LiftedChild {
  readonly id: string;
  /** What it was called inside the category being deleted. */
  readonly name: string;
  /** What it is called where it landed: the same, unless that name was taken. */
  readonly cameUpAs: string;
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
 *
 * Under its own name wherever that is free there, and named after the category
 * it came out of where it is not — `nameWhereTheyLand` says how. This used to
 * refuse the delete instead, which somebody met only after confirming it, and
 * which asked them to rename a heading before they could drop one.
 */
async function liftTheChildren({
  transaction,
  category,
}: LiftRequest): Promise<readonly LiftedChild[]> {
  const children = await transaction.database
    .selectFrom('assetCategory')
    .select(['id', 'name'])
    .where('parentId', '=', category.id)
    .orderBy('position')
    .execute();

  if (children.length === 0) {
    return [];
  }

  const landingNames = new Map(
    nameWhereTheyLand({
      leaving: category.name,
      children,
      takenWhereTheyLand: await namesTakenWhereTheyLand({ transaction, category }),
    }).map((child) => [child.id, child.name]),
  );

  const lifted: LiftedChild[] = [];

  for (const child of children) {
    const cameUpAs = landingNames.get(child.id) ?? child.name;
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
      .set({ parentId: category.parentId, name: cameUpAs, position })
      .where('id', '=', child.id)
      .execute();

    lifted.push({ id: child.id, name: child.name, cameUpAs });
  }

  return lifted;
}

/**
 * Every name already used where the children are landing.
 *
 * Not counting the category they are coming out of, whose name is free the
 * moment it goes. Archived categories do count: they are not drawn, but a name
 * is unique among siblings whether anybody can see the sibling or not.
 */
async function namesTakenWhereTheyLand({
  transaction,
  category,
}: LiftRequest): Promise<ReadonlySet<string>> {
  const level = transaction.database
    .selectFrom('assetCategory')
    .select('name')
    .where('projectId', '=', category.projectId)
    .where('id', '!=', category.id);

  const siblings =
    category.parentId === null
      ? await level.where('parentId', 'is', null).execute()
      : await level.where('parentId', '=', category.parentId).execute();

  return new Set(siblings.map((sibling) => sibling.name));
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
