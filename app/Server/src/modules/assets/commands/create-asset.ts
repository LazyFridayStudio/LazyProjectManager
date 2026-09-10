import {
  createAssetCategoryCommand,
  createAssetCommand,
  createCommandSuccess,
  type AssetStatus,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { allocateAssetKey } from '../asset-keys.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { isUniqueViolation } from '../../../cqrs/unique-violation.js';
import {
  AssetCategoryNameTakenError,
  AssetCategoryNotInProjectError,
  positionBetween,
  ProjectArchivedError,
} from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../../projects/project-access.js';

/** Named in `0060-a-category-inside-a-category`, and the only clash this insert expects. */
const CATEGORY_NAME_CONSTRAINT = 'asset_category_name_unique_among_siblings';

interface CreateCategoryInput {
  commandId: string;
  projectId: string;
  /** What to put it inside, and absent or null for one at the top. */
  parentId?: string | null;
  name: string;
  color: string;
  budgetMinor?: number | null;
}

/**
 * Adds a category to a project's library.
 *
 * A project starts with none. What a game is made of differs by game — "World
 * Bosses" and "Weapons — Tier 3" mean nothing to a studio making a puzzler — so
 * defaults would be four categories everybody deletes before adding their own.
 */
export const createAssetCategoryHandler = defineCommandHandler({
  definition: createAssetCategoryCommand,

  async execute(input: CreateCategoryInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, createAssetCategoryCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.manageCategory' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: createAssetCategoryCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => createCategory({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

interface CategoryRequest {
  readonly transaction: CommandTransaction;
  readonly input: CreateCategoryInput;
  readonly actor: RequestActor;
}

async function createCategory({ transaction, input, actor }: CategoryRequest): Promise<string> {
  const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  const parentId = await resolveParent({ transaction, input, actor });

  // The end of wherever it is going, which is its siblings rather than the
  // library: a sub-category added to Props goes under the last thing in Props.
  const last = await lastAmongSiblings(transaction, project.id, parentId);

  try {
    const category = await transaction.database
      .insertInto('assetCategory')
      .values({
        accountId: actor.accountId,
        projectId: project.id,
        parentId,
        name: input.name,
        color: input.color,
        budgetMinor: input.budgetMinor ?? null,
        // Added at the end, as a new list is. Somewhere in the middle is a drag,
        // which is a different thing somebody asked for on purpose.
        position: positionBetween(last === undefined ? null : Number(last.position), null),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    transaction.appendEvent({
      accountId: actor.accountId,
      aggregateType: 'project',
      aggregateId: project.id,
      name: 'assets.categoryCreated',
      payload: { projectId: project.id, name: input.name },
    });

    return category.id;
  } catch (error) {
    // By constraint name, not by code: any other unique violation from this
    // statement is a genuine surprise and should not be reported as a name clash.
    if (isUniqueViolation(error, CATEGORY_NAME_CONSTRAINT)) {
      throw new AssetCategoryNameTakenError(input.name);
    }

    throw error;
  }
}

/**
 * The category this one is going inside, once it is established there is one.
 *
 * Checked against the project rather than only the account: a category from
 * another library would put a heading somewhere nobody looking at this project
 * could ever see it.
 */
async function resolveParent({
  transaction,
  input,
  actor,
}: CategoryRequest): Promise<string | null> {
  if (input.parentId === undefined || input.parentId === null) {
    return null;
  }

  const parent = await transaction.database
    .selectFrom('assetCategory')
    .select('id')
    .where('id', '=', input.parentId)
    .where('projectId', '=', input.projectId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (parent === undefined) {
    throw new AssetCategoryNotInProjectError();
  }

  return parent.id;
}

/** The last position among the categories directly inside the same place. */
async function lastAmongSiblings(
  transaction: CommandTransaction,
  projectId: string,
  parentId: string | null,
): Promise<{ position: string } | undefined> {
  const query = transaction.database
    .selectFrom('assetCategory')
    .select('position')
    .where('projectId', '=', projectId)
    .orderBy('position', 'desc')
    .limit(1);

  return parentId === null
    ? query.where('parentId', 'is', null).executeTakeFirst()
    : query.where('parentId', '=', parentId).executeTakeFirst();
}

interface CreateAssetInput {
  commandId: string;
  projectId: string;
  categoryId: string;
  name: string;
  status: AssetStatus;
  description?: string | null;
  estimatedCostMinor?: number | null;
  dueOn?: string | null;
}

/**
 * Adds a thing the game needs.
 *
 * Only a name and a category are insisted on. Everything else about an asset is
 * learned while making it, and a form that demands a cost estimate before the
 * concept exists is a form people put invented numbers into.
 */
export const createAssetHandler = defineCommandHandler({
  definition: createAssetCommand,

  async execute(input: CreateAssetInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, createAssetCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.create' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: createAssetCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => createAsset({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
  },
});

interface AssetRequest {
  readonly transaction: CommandTransaction;
  readonly input: CreateAssetInput;
  readonly actor: RequestActor;
}

async function createAsset({ transaction, input, actor }: AssetRequest): Promise<string> {
  const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  // Scoped to the project as well as the id: a category id from another project
  // would otherwise file this asset somewhere nobody looking at it can see.
  const category = await transaction.database
    .selectFrom('assetCategory')
    .select('id')
    .where('id', '=', input.categoryId)
    .where('projectId', '=', project.id)
    .executeTakeFirst();

  if (category === undefined) {
    throw new AssetCategoryNotInProjectError();
  }

  const last = await transaction.database
    .selectFrom('asset')
    .select('position')
    .where('categoryId', '=', category.id)
    .orderBy('position', 'desc')
    .limit(1)
    .executeTakeFirst();

  const asset = await transaction.database
    .insertInto('asset')
    .values({
      accountId: actor.accountId,
      projectId: project.id,
      categoryId: category.id,
      assetKey: await allocateAssetKey({
        database: transaction.database,
        projectId: project.id,
        projectCode: project.code,
      }),
      name: input.name,
      status: input.status,
      description: blankToNull(input.description),
      estimatedCostMinor: input.estimatedCostMinor ?? null,
      dueOn: input.dueOn ?? null,
      /*
       * Whoever filed it, as a card's reporter is whoever raised it.
       *
       * Not asked for on the way in. Somebody adding twelve props to a library
       * is not filing them on anybody else's behalf, and a form that asked
       * would be asking the same question twelve times to get the answer it
       * already had. It is changeable afterwards for the times that is wrong.
       */
      reporterId: actor.userId,
      position: positionBetween(last === undefined ? null : Number(last.position), null),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: project.id,
    name: 'assets.assetCreated',
    payload: { projectId: project.id, categoryId: category.id, name: input.name },
  });

  return asset.id;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}
