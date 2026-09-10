import {
  archiveListCommand,
  createCommandSuccess,
  createListCommand,
  moveListCommand,
  updateListCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import {
  InvariantViolatedError,
  ListNotOnBoardError,
  POSITION_STEP,
  positionBetween,
  type MembershipRole,
} from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { loadListOnBoard, loadWritableBoard, loadWritableList } from '../cards/card-access.js';
import { placeList } from '../lists/list-positions.js';

/**
 * Adds a list to the board.
 *
 * It goes on the end: a board is read left to right, and a list appearing in the
 * middle of one is a list somebody has to go looking for.
 */
export const createListHandler = defineCommandHandler({
  definition: createListCommand,

  async execute(
    input: {
      commandId: string;
      boardId: string;
      name: string;
      color: string;
      wipLimit?: number | null;
    },
    context,
  ): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, createListCommand.name, 'board.manageList');

    const outcome = await executeCommand({
      database: context.database,
      commandName: createListCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const board = await loadWritableBoard(
          { database: transaction.database, actor, role },
          input.boardId,
        );

        const last = await transaction.database
          .selectFrom('list')
          .select(({ fn }) => fn.max('position').as('lastPosition'))
          .where('boardId', '=', board.boardId)
          .executeTakeFirst();

        const list = await transaction.database
          .insertInto('list')
          .values({
            boardId: board.boardId,
            name: input.name,
            color: input.color,
            wipLimit: input.wipLimit ?? null,
            position: positionBetween(readPosition(last?.lastPosition), null),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        transaction.appendEvent({
          accountId: board.accountId,
          aggregateType: 'board',
          aggregateId: board.boardId,
          name: 'board.listCreated',
          payload: { projectId: board.projectId, listId: list.id, name: input.name },
        });

        return { listId: list.id };
      },
    });

    return outcome.applied ? createCommandSuccess(outcome.result.listId) : createCommandSuccess();
  },
});

interface UpdateListInput {
  commandId: string;
  listId: string;
  name?: string;
  color?: string;
  wipLimit?: number | null;
  nextListId?: string | null;
  backListId?: string | null;
}

/** Renames a list, recolours it, or changes what it will hold. */
export const updateListHandler = defineCommandHandler({
  definition: updateListCommand,

  async execute(input: UpdateListInput, context): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, updateListCommand.name, 'board.manageList');

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateListCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => updateList({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.listId) : createCommandSuccess();
  },
});

interface UpdateListRequest {
  readonly transaction: CommandTransaction;
  readonly input: UpdateListInput;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function updateList(request: UpdateListRequest): Promise<void> {
  const { transaction, input, actor } = request;
  const list = await loadWritableList(
    { database: transaction.database, actor, role: request.role },
    input.listId,
  );

  const patch: Record<string, unknown> = {};

  for (const field of ['name', 'color', 'wipLimit', 'nextListId', 'backListId'] as const) {
    if (input[field] !== undefined) {
      patch[field] = input[field];
    }
  }

  const changedFields = Object.keys(patch);

  if (changedFields.length === 0) {
    return;
  }

  // A list that flows into itself is a loop the board would offer forever.
  assertFlowIsNotSelfReferential(list.listId, input);

  await transaction.database.updateTable('list').set(patch).where('id', '=', list.listId).execute();

  transaction.appendEvent({
    accountId: list.accountId,
    aggregateType: 'board',
    aggregateId: list.boardId,
    name: 'board.listUpdated',
    payload: { projectId: list.projectId, listId: list.listId, changedFields },
  });
}

function assertFlowIsNotSelfReferential(listId: string, input: UpdateListInput): void {
  if (input.nextListId === listId || input.backListId === listId) {
    throw new InvariantViolatedError('A list cannot flow into itself.');
  }
}

interface MoveListInput {
  commandId: string;
  listId: string;
  beforeListId?: string | null;
  afterListId?: string | null;
}

/**
 * Moves a list to another place on the board.
 *
 * The four a board starts with are a starting point rather than the shape of
 * the product, and a fifth working stage added to the end almost never belongs
 * after Done.
 */
export const moveListHandler = defineCommandHandler({
  definition: moveListCommand,

  async execute(input: MoveListInput, context): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, moveListCommand.name, 'board.manageList');

    const outcome = await executeCommand({
      database: context.database,
      commandName: moveListCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => moveList({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.listId) : createCommandSuccess();
  },
});

interface MoveListRequest {
  readonly transaction: CommandTransaction;
  readonly input: MoveListInput;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function moveList(request: MoveListRequest): Promise<void> {
  const { transaction, input, actor } = request;
  const list = await loadWritableList(
    { database: transaction.database, actor, role: request.role },
    input.listId,
  );

  const position = await placeList({
    transaction: transaction.database,
    boardId: list.boardId,
    listId: list.listId,
    beforeListId: input.beforeListId,
    afterListId: input.afterListId,
  });

  await transaction.database
    .updateTable('list')
    .set({ position })
    .where('id', '=', list.listId)
    .execute();

  transaction.appendEvent({
    accountId: list.accountId,
    aggregateType: 'board',
    aggregateId: list.boardId,
    name: 'board.listMoved',
    payload: { projectId: list.projectId, listId: list.listId },
  });
}

interface ArchiveListInput {
  commandId: string;
  listId: string;
  moveCardsToListId?: string | null;
}

/**
 * Takes a list off the board.
 *
 * Its cards have to go somewhere. Rather than stranding them where nobody would
 * find them again, the command refuses unless it is told where they go — or the
 * list is already empty.
 */
export const archiveListHandler = defineCommandHandler({
  definition: archiveListCommand,

  async execute(input: ArchiveListInput, context): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, archiveListCommand.name, 'board.manageList');

    const outcome = await executeCommand({
      database: context.database,
      commandName: archiveListCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => archiveList({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.listId) : createCommandSuccess();
  },
});

interface ArchiveListRequest {
  readonly transaction: CommandTransaction;
  readonly input: ArchiveListInput;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function archiveList(request: ArchiveListRequest): Promise<void> {
  const { transaction, input, actor } = request;
  const list = await loadWritableList(
    { database: transaction.database, actor, role: request.role },
    input.listId,
  );

  const remaining = await transaction.database
    .selectFrom('card')
    .select('id')
    .where('listId', '=', list.listId)
    .where('closedAt', 'is', null)
    .execute();

  if (remaining.length > 0) {
    await moveCardsOut({
      request,
      boardId: list.boardId,
      listId: list.listId,
      cardCount: remaining.length,
    });
  }

  await transaction.database
    .updateTable('list')
    .set({ archivedAt: new Date() })
    .where('id', '=', list.listId)
    .execute();

  transaction.appendEvent({
    accountId: list.accountId,
    aggregateType: 'board',
    aggregateId: list.boardId,
    name: 'board.listArchived',
    payload: { projectId: list.projectId, listId: list.listId, movedCards: remaining.length },
  });
}

interface MoveCardsOutRequest {
  readonly request: ArchiveListRequest;
  readonly boardId: string;
  readonly listId: string;
  readonly cardCount: number;
}

async function moveCardsOut({
  request,
  boardId,
  listId,
  cardCount,
}: MoveCardsOutRequest): Promise<void> {
  const { transaction, input } = request;
  const destinationId = input.moveCardsToListId;

  if (destinationId === null || destinationId === undefined) {
    throw new InvariantViolatedError(
      `That list still has ${String(cardCount)} cards on it. Say where they should go.`,
      { moveCardsToListId: 'Choose a list for the cards.' },
    );
  }

  if (destinationId === listId) {
    throw new ListNotOnBoardError();
  }

  const destination = await loadListOnBoard(transaction.database, boardId, destinationId);

  const last = await transaction.database
    .selectFrom('card')
    .select(({ fn }) => fn.max('position').as('lastPosition'))
    .where('listId', '=', destination.id)
    .executeTakeFirst();

  // Appended in the order they were in, after whatever is already there. The
  // limit is deliberately not applied: refusing here would leave the cards in a
  // list nobody can see.
  const moving = await transaction.database
    .selectFrom('card')
    .select('id')
    .where('listId', '=', listId)
    .orderBy('position')
    .execute();

  const startAt = readPosition(last?.lastPosition) ?? 0;

  for (const [index, card] of moving.entries()) {
    await transaction.database
      .updateTable('card')
      .set({ listId: destination.id, position: startAt + (index + 1) * POSITION_STEP })
      .where('id', '=', card.id)
      .execute();
  }
}

/** `numeric` arrives from `pg` as a string, so every read goes through here. */
function readPosition(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Every list command needs the same two answers before it can do anything. */
async function authorise(
  context: RequestContext,
  commandName: string,
  action: 'board.manageList',
): Promise<{ actor: RequestActor; role: MembershipRole }> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action });

  return { actor, role };
}
