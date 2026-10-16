import {
  addAssetChecklistItemCommand,
  addAssetTabBlockCommand,
  addAssetTabCommand,
  ASSET_TAB_BLOCK_KINDS,
  ASSET_VIEW_BLOCK_KINDS,
  createCommandSuccess,
  deleteAssetTabCommand,
  MAXIMUM_BLOCKS_PER_TAB,
  MAXIMUM_ITEMS_PER_CHECKLIST,
  MAXIMUM_TABS_PER_ASSET,
  moveAssetTabBlockCommand,
  moveAssetTabCommand,
  removeAssetChecklistItemCommand,
  removeAssetTabBlockCommand,
  updateAssetChecklistItemCommand,
  updateAssetTabBlockCommand,
  updateAssetTabCommand,
  describeAssetBlockKind,
  type AssetBlockKind,
  type CommandSuccess,
} from '@lpm/shared';

import type { BinnedRepair } from '@lpm/database';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestContext } from '../../../cqrs/request-context.js';
import {
  AssetNotFoundError,
  InvariantViolatedError,
  positionBetween,
} from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { assertPeopleAreOnTheProject } from '../../projects/project-people.js';
import { binIt } from '../../recovery/index.js';
import {
  appendAssetEvent,
  loadWritableAsset,
  readPosition,
  type AssetAccess,
  type WritableAsset,
} from '../asset-access.js';
import { placeAtEndOfSet, placeInSet, type OrderedSet } from '../tab-positions.js';

/**
 * The tabs an asset is worked in, the blocks they are built from, and the lines
 * of a checklist block.
 *
 * Everything here is reached through the asset, so who may change it is the
 * rule that already governs the asset — `asset.update` — asked once by
 * `onAnAsset` rather than written into every handler. An id of a tab, a block or
 * an item says nothing on its own about who may touch it, and one that has gone
 * reads as the asset having gone: the caller only had the id because the panel
 * gave it to them.
 */

interface OnAnAsset {
  readonly context: RequestContext;
  readonly commandName: string;
  readonly commandId: string;
  /** The id of whatever the command made or changed. */
  readonly run: (access: AssetAccess) => Promise<string>;
}

/**
 * Asks whether the actor may change assets at all, then runs the command.
 *
 * Answers with the id the command made, when it made one, and with nothing when
 * the same command id was seen before.
 */
async function onAnAsset({
  context,
  commandName,
  commandId,
  run,
}: OnAnAsset): Promise<CommandSuccess> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action: 'asset.update' });

  const outcome = await executeCommand({
    database: context.database,
    commandName,
    commandId,
    actorId: actor.userId,
    run: (transaction) => run({ transaction, actor, role }),
  });

  return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
}

interface TabOnAsset {
  readonly asset: WritableAsset;
  readonly tab: { readonly id: string; readonly title: string };
}

async function loadTab(access: AssetAccess, assetTabId: string): Promise<TabOnAsset> {
  const tab = await access.transaction.database
    .selectFrom('assetTab')
    .select(['id', 'assetId', 'title'])
    .where('id', '=', assetTabId)
    .where('accountId', '=', access.actor.accountId)
    .executeTakeFirst();

  if (tab === undefined) {
    throw new AssetNotFoundError();
  }

  return { asset: await loadWritableAsset(access, tab.assetId), tab };
}

interface BlockOnAsset {
  readonly asset: WritableAsset;
  readonly block: {
    readonly id: string;
    /** Null for a block on the Overview. */
    readonly tabId: string | null;
    readonly kind: AssetBlockKind;
  };
}

async function loadBlock(access: AssetAccess, blockId: string): Promise<BlockOnAsset> {
  const block = await access.transaction.database
    .selectFrom('assetTabBlock')
    .select(['id', 'assetId', 'tabId', 'kind'])
    .where('id', '=', blockId)
    .executeTakeFirst();

  if (block === undefined) {
    throw new AssetNotFoundError();
  }

  // The account is asked of the asset, which `loadWritableAsset` does.
  return { asset: await loadWritableAsset(access, block.assetId), block };
}

async function loadChecklistItem(access: AssetAccess, itemId: string): Promise<WritableAsset> {
  const item = await access.transaction.database
    .selectFrom('assetTabChecklistItem')
    .select('assetId')
    .where('id', '=', itemId)
    .executeTakeFirst();

  if (item === undefined) {
    throw new AssetNotFoundError();
  }

  return loadWritableAsset(access, item.assetId);
}

/** Adds a tab to the end of an asset's row. */
export const addAssetTabHandler = defineCommandHandler({
  definition: addAssetTabCommand,

  execute(
    input: { commandId: string; assetId: string; title: string },
    context,
  ): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: addAssetTabCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const asset = await loadWritableAsset(access, input.assetId);
        const database = access.transaction.database;

        await assertRoomForTabs(access.transaction, asset.id, 1);

        const tab = await database
          .insertInto('assetTab')
          .values({
            accountId: asset.accountId,
            assetId: asset.id,
            title: input.title,
            position: await placeAtEndOfSet(database, {
              table: 'asset_tab',
              by: 'asset_id',
              id: asset.id,
            }),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        appendAssetEvent(access.transaction, asset, 'assets.tabAdded');

        return tab.id;
      },
    });
  },
});

/**
 * Refuses a tab past the most an asset may have.
 *
 * `adding` rather than one, because a template adds several at once and has to
 * be refused before it has added any.
 */
export async function assertRoomForTabs(
  transaction: CommandTransaction,
  assetId: string,
  adding: number,
): Promise<void> {
  const counted = await transaction.database
    .selectFrom('assetTab')
    .select(({ fn }) => fn.countAll<string>().as('tabs'))
    .where('assetId', '=', assetId)
    .executeTakeFirstOrThrow();

  if (Number(counted.tabs) + adding > MAXIMUM_TABS_PER_ASSET) {
    throw new InvariantViolatedError(
      `An asset can have ${String(MAXIMUM_TABS_PER_ASSET)} tabs at most. Delete one first.`,
    );
  }
}

interface UpdateTabInput {
  commandId: string;
  assetTabId: string;
  title?: string;
  done?: boolean;
  assigneeId?: string | null;
  dueOn?: string | null;
}

/** Renames a tab, ticks it off, or says who is doing it and by when. */
export const updateAssetTabHandler = defineCommandHandler({
  definition: updateAssetTabCommand,

  execute(input: UpdateTabInput, context): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: updateAssetTabCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const { asset, tab } = await loadTab(access, input.assetTabId);
        const database = access.transaction.database;

        // The rule an asset's own assignee is held to: somebody not on the
        // project is somebody who will never see the tab they were given.
        await assertPeopleAreOnTheProject({
          database,
          projectId: asset.projectId,
          assigneeId: input.assigneeId,
        });

        const patch: Record<string, unknown> = {};

        if (input.title !== undefined) patch.title = input.title;

        if (input.done !== undefined) patch.done = input.done;

        if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;

        if (input.dueOn !== undefined) patch.dueOn = input.dueOn;

        await database.updateTable('assetTab').set(patch).where('id', '=', tab.id).execute();

        appendAssetEvent(access.transaction, asset, 'assets.tabUpdated');

        return tab.id;
      },
    });
  },
});

/** Moves a tab along the row, between the two it was dropped between. */
export const moveAssetTabHandler = defineCommandHandler({
  definition: moveAssetTabCommand,

  execute(
    input: {
      commandId: string;
      assetTabId: string;
      beforeTabId?: string | null;
      afterTabId?: string | null;
    },
    context,
  ): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: moveAssetTabCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const { asset, tab } = await loadTab(access, input.assetTabId);
        const database = access.transaction.database;

        const position = await placeInSet({
          transaction: database,
          set: { table: 'asset_tab', by: 'asset_id', id: asset.id },
          rowId: tab.id,
          beforeId: input.beforeTabId,
          afterId: input.afterTabId,
        });

        await database.updateTable('assetTab').set({ position }).where('id', '=', tab.id).execute();

        appendAssetEvent(access.transaction, asset, 'assets.tabMoved');

        return tab.id;
      },
    });
  },
});

/**
 * Deletes a tab, with its notes and checklists, into the bin.
 *
 * The files and hours that named it are the asset's, and stay: the database
 * empties the column that pointed at the tab. What it emptied is written down as
 * repairs, so putting the tab back puts their tags back too — unless somebody
 * has tagged them to something else since, which they meant.
 */
export const deleteAssetTabHandler = defineCommandHandler({
  definition: deleteAssetTabCommand,

  execute(input: { commandId: string; assetTabId: string }, context): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: deleteAssetTabCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const { asset, tab } = await loadTab(access, input.assetTabId);
        const database = access.transaction.database;

        await binIt({
          transaction: access.transaction,
          kind: 'assetTab',
          accountId: asset.accountId,
          actorId: access.actor.userId,
          subjectId: tab.id,
          projectId: asset.projectId,
          name: tab.title,
          // The asset it was on, by key, so the bin reads without a join.
          about: asset.assetKey,
          repairs: await whatLosingTheTabEmpties(access.transaction, tab.id),
        });

        await database.deleteFrom('assetTab').where('id', '=', tab.id).execute();

        appendAssetEvent(access.transaction, asset, 'assets.tabDeleted');

        return tab.id;
      },
    });
  },
});

async function whatLosingTheTabEmpties(
  transaction: CommandTransaction,
  tabId: string,
): Promise<BinnedRepair[]> {
  const files = await transaction.database
    .selectFrom('assetFile')
    .select('id')
    .where('tabId', '=', tabId)
    .execute();

  const hours = await transaction.database
    .selectFrom('workLog')
    .select('id')
    .where('assetTabId', '=', tabId)
    .execute();

  return [
    ...files.map((file) => ({
      table: 'asset_file',
      id: file.id,
      column: 'tab_id',
      was: tabId,
      now: null,
    })),
    ...hours.map((entry) => ({
      table: 'work_log',
      id: entry.id,
      column: 'asset_tab_id',
      was: tabId,
      now: null,
    })),
  ];
}

interface AddBlockInput {
  commandId: string;
  assetTabId?: string;
  assetId?: string;
  kind: AssetBlockKind;
  body?: string;
}

/** Where a new block is going: a tab, or the Overview of an asset. */
interface BlockPlace {
  readonly asset: WritableAsset;
  /** Null for the Overview. */
  readonly tabId: string | null;
  readonly set: OrderedSet;
  /** What to call the place in a refusal: "This tab", "This Overview". */
  readonly called: string;
}

async function loadBlockPlace(access: AssetAccess, input: AddBlockInput): Promise<BlockPlace> {
  if (input.assetTabId !== undefined) {
    const { asset, tab } = await loadTab(access, input.assetTabId);

    return {
      asset,
      tabId: tab.id,
      set: { table: 'asset_tab_block', by: 'tab_id', id: tab.id },
      called: 'This tab',
    };
  }

  const asset = await loadWritableAsset(access, input.assetId ?? '');

  return {
    asset,
    tabId: null,
    set: { table: 'asset_tab_block', by: 'overview', id: asset.id },
    called: 'This Overview',
  };
}

/** Adds a block to the end of a tab, or of an asset's Overview. */
export const addAssetTabBlockHandler = defineCommandHandler({
  definition: addAssetTabBlockCommand,

  execute(input: AddBlockInput, context): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: addAssetTabBlockCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const place = await loadBlockPlace(access, input);
        const database = access.transaction.database;

        await assertRoomForBlock(access.transaction, place, input.kind);

        const block = await database
          .insertInto('assetTabBlock')
          .values({
            assetId: place.asset.id,
            tabId: place.tabId,
            kind: input.kind,
            // Only a notes block has text of its own.
            body: input.kind === 'notes' ? (input.body ?? '') : null,
            position: await placeAtEndOfSet(database, place.set),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        appendAssetEvent(access.transaction, place.asset, 'assets.blockAdded');

        return block.id;
      },
    });
  },
});

/**
 * Refuses a block that does not belong where it is going, one past the most a
 * place may have, and a second of a block that shows something the asset has,
 * which would show the same things as the first.
 *
 * Asked before the insert rather than left to the constraints, because they can
 * only say "check violation" or "duplicate key" and this can say which block.
 */
async function assertRoomForBlock(
  transaction: CommandTransaction,
  place: BlockPlace,
  kind: AssetBlockKind,
): Promise<void> {
  const label = describeAssetBlockKind(kind).toLowerCase();

  if (place.tabId !== null && !(ASSET_TAB_BLOCK_KINDS as readonly string[]).includes(kind)) {
    // The asset's own sections are the Overview's: on a tab they would be the
    // whole asset again, inside one job of it.
    throw new InvariantViolatedError(`A ${label} block goes on the Overview, not on a tab.`);
  }

  const query = transaction.database
    .selectFrom('assetTabBlock')
    .select('kind')
    .where('assetId', '=', place.asset.id);
  const blocks = await (
    place.tabId === null ? query.where('tabId', 'is', null) : query.where('tabId', '=', place.tabId)
  ).execute();

  if (blocks.length >= MAXIMUM_BLOCKS_PER_TAB) {
    throw new InvariantViolatedError(
      `${place.called} can have ${String(MAXIMUM_BLOCKS_PER_TAB)} blocks at most. Remove one first.`,
    );
  }

  if (ASSET_VIEW_BLOCK_KINDS.includes(kind) && blocks.some((block) => block.kind === kind)) {
    throw new InvariantViolatedError(`${place.called} already has a ${label} block.`);
  }
}

/** Changes what a notes block says. */
export const updateAssetTabBlockHandler = defineCommandHandler({
  definition: updateAssetTabBlockCommand,

  execute(
    input: { commandId: string; blockId: string; body: string },
    context,
  ): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: updateAssetTabBlockCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const { asset, block } = await loadBlock(access, input.blockId);

        if (block.kind !== 'notes') {
          throw new InvariantViolatedError('Only a notes block has text to change.');
        }

        await access.transaction.database
          .updateTable('assetTabBlock')
          .set({ body: input.body })
          .where('id', '=', block.id)
          .execute();

        appendAssetEvent(access.transaction, asset, 'assets.blockUpdated');

        return block.id;
      },
    });
  },
});

/** Moves a block up or down its tab. */
export const moveAssetTabBlockHandler = defineCommandHandler({
  definition: moveAssetTabBlockCommand,

  execute(
    input: {
      commandId: string;
      blockId: string;
      beforeBlockId?: string | null;
      afterBlockId?: string | null;
    },
    context,
  ): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: moveAssetTabBlockCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const { asset, block } = await loadBlock(access, input.blockId);
        const database = access.transaction.database;

        const position = await placeInSet({
          transaction: database,
          set:
            block.tabId === null
              ? { table: 'asset_tab_block', by: 'overview', id: asset.id }
              : { table: 'asset_tab_block', by: 'tab_id', id: block.tabId },
          rowId: block.id,
          beforeId: input.beforeBlockId,
          afterId: input.afterBlockId,
        });

        await database
          .updateTable('assetTabBlock')
          .set({ position })
          .where('id', '=', block.id)
          .execute();

        appendAssetEvent(access.transaction, asset, 'assets.blockMoved');

        return block.id;
      },
    });
  },
});

/** Takes a block off its tab. A checklist's items go with it. */
export const removeAssetTabBlockHandler = defineCommandHandler({
  definition: removeAssetTabBlockCommand,

  execute(input: { commandId: string; blockId: string }, context): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: removeAssetTabBlockCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const { asset, block } = await loadBlock(access, input.blockId);

        await access.transaction.database
          .deleteFrom('assetTabBlock')
          .where('id', '=', block.id)
          .execute();

        appendAssetEvent(access.transaction, asset, 'assets.blockRemoved');

        return block.id;
      },
    });
  },
});

/** Adds a line to the end of a checklist block. */
export const addAssetChecklistItemHandler = defineCommandHandler({
  definition: addAssetChecklistItemCommand,

  execute(
    input: { commandId: string; blockId: string; title: string },
    context,
  ): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: addAssetChecklistItemCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const { asset, block } = await loadBlock(access, input.blockId);
        const database = access.transaction.database;

        if (block.kind !== 'checklist') {
          throw new InvariantViolatedError('Only a checklist block has items.');
        }

        const last = await database
          .selectFrom('assetTabChecklistItem')
          .select(({ fn }) => [
            fn.max('position').as('lastPosition'),
            fn.countAll<string>().as('items'),
          ])
          .where('blockId', '=', block.id)
          .executeTakeFirstOrThrow();

        if (Number(last.items) >= MAXIMUM_ITEMS_PER_CHECKLIST) {
          throw new InvariantViolatedError(
            `A checklist can have ${String(MAXIMUM_ITEMS_PER_CHECKLIST)} items at most.`,
          );
        }

        const item = await database
          .insertInto('assetTabChecklistItem')
          .values({
            assetId: asset.id,
            tabId: block.tabId,
            blockId: block.id,
            title: input.title,
            position: positionBetween(readPosition(last.lastPosition), null),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        appendAssetEvent(access.transaction, asset, 'assets.checklistItemAdded');

        return item.id;
      },
    });
  },
});

/** Ticks a line off, unticks it, or renames it. */
export const updateAssetChecklistItemHandler = defineCommandHandler({
  definition: updateAssetChecklistItemCommand,

  execute(
    input: { commandId: string; itemId: string; title?: string; done?: boolean },
    context,
  ): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: updateAssetChecklistItemCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const asset = await loadChecklistItem(access, input.itemId);
        const patch: Record<string, unknown> = {};

        if (input.title !== undefined) patch.title = input.title;

        if (input.done !== undefined) patch.done = input.done;

        await access.transaction.database
          .updateTable('assetTabChecklistItem')
          .set(patch)
          .where('id', '=', input.itemId)
          .execute();

        appendAssetEvent(access.transaction, asset, 'assets.checklistItemUpdated');

        return input.itemId;
      },
    });
  },
});

/** Takes a line off a checklist. */
export const removeAssetChecklistItemHandler = defineCommandHandler({
  definition: removeAssetChecklistItemCommand,

  execute(input: { commandId: string; itemId: string }, context): Promise<CommandSuccess> {
    return onAnAsset({
      context,
      commandName: removeAssetChecklistItemCommand.name,
      commandId: input.commandId,
      run: async (access) => {
        const asset = await loadChecklistItem(access, input.itemId);

        await access.transaction.database
          .deleteFrom('assetTabChecklistItem')
          .where('id', '=', input.itemId)
          .execute();

        appendAssetEvent(access.transaction, asset, 'assets.checklistItemRemoved');

        return input.itemId;
      },
    });
  },
});
