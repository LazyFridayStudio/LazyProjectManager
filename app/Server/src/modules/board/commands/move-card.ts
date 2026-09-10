import { createCommandSuccess, moveCardCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { assertListHasRoom, closingStampFor, type MembershipRole } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { readBoardEnds } from '../cards/board-ends.js';
import { countOpenCards, loadListOnBoard, loadWritableCard } from '../cards/card-access.js';
import { placeCard } from '../cards/card-positions.js';

interface MoveCardInput {
  commandId: string;
  cardId: string;
  toListId: string;
  beforeCardId?: string | null;
  afterCardId?: string | null;
}

/**
 * Moves a card, within a list or between them.
 *
 * The work-in-progress limit is checked here rather than in the browser, because
 * the browser's count is always a moment out of date and two people dragging
 * into the same full list would both be told it was fine.
 *
 * **A move is also what closes a card.** Landing on the list the board finishes
 * on stamps `closed_at`, and leaving it clears the stamp — see `closingStampFor`
 * for why that rule lives in one place rather than beside a button as well.
 */
export const moveCardHandler = defineCommandHandler({
  definition: moveCardCommand,

  async execute(input: MoveCardInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, moveCardCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'card.move' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: moveCardCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => moveCard({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.cardId) : createCommandSuccess();
  },
});

interface MoveCardRequest {
  readonly transaction: CommandTransaction;
  readonly input: MoveCardInput;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function moveCard(request: MoveCardRequest): Promise<void> {
  const { transaction, input, actor } = request;

  const card = await loadWritableCard(
    { database: transaction.database, actor, role: request.role },
    input.cardId,
  );

  const list = await loadListOnBoard(transaction.database, card.boardId, input.toListId);
  const isChangingList = list.id !== card.listId;

  if (isChangingList) {
    // Reordering inside a list cannot make it fuller than it already is, so the
    // limit only applies to a card arriving from somewhere else.
    assertListHasRoom({
      listName: list.name,
      wipLimit: list.wipLimit,
      openCardCount: await countOpenCards(transaction.database, list.id),
      isAdvisory: card.wipIsAdvisory,
    });
  }

  const position = await placeCard({
    transaction: transaction.database,
    listId: list.id,
    cardId: card.id,
    beforeCardId: input.beforeCardId,
    afterCardId: input.afterCardId,
  });

  const now = new Date();
  const ends = await readBoardEnds(transaction.database, card.projectId);
  const closedAt = closingStampFor({
    isFinishingList: list.id === ends.finished,
    closedAt: card.closedAt,
    now,
  });

  await transaction.database
    .updateTable('card')
    .set({ listId: list.id, position, closedAt, updatedAt: now })
    .where('id', '=', card.id)
    .execute();

  transaction.appendEvent({
    accountId: card.accountId,
    aggregateType: 'card',
    aggregateId: card.id,
    name: 'board.cardMoved',
    payload: {
      projectId: card.projectId,
      fromListId: card.listId,
      toListId: list.id,
      closed: closedAt !== null,
    },
  });
}
