import {
  createCardCommand,
  createCommandSuccess,
  type CardPriority,
  type CardType,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { assertListHasRoom } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { allocateCardKey } from '../cards/card-keys.js';
import { assertPeopleAreOnTheProject } from '../../projects/project-people.js';
import { countOpenCards, loadListOnBoard, loadWritableProject } from '../cards/card-access.js';
import { placeAtEndOfList } from '../cards/card-positions.js';

interface CreateCardInput {
  commandId: string;
  projectId: string;
  listId: string;
  title: string;
  type: CardType;
  priority?: CardPriority | null;
  points?: number | null;
  estimateMinutes?: number | null;
  assigneeId?: string | null;
  milestoneId?: string | null;
  discipline?: string | null;
  fixVersion?: string | null;
  dueOn?: string | null;
  description?: string | null;
  acceptanceCriteria?: string | null;
}

/**
 * Creates a card.
 *
 * The key is issued inside the same transaction as the row it belongs to, so a
 * create that rolls back gives its number back rather than leaving a gap in the
 * project's sequence.
 */
export const createCardHandler = defineCommandHandler({
  definition: createCardCommand,

  async execute(input: CreateCardInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, createCardCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'card.create' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: createCardCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => createCard({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result.cardId) : createCommandSuccess();
  },
});

interface CreateCardRequest {
  readonly transaction: CommandTransaction;
  readonly input: CreateCardInput;
  readonly actor: RequestActor;
  readonly role: Awaited<ReturnType<typeof loadMembershipRole>>;
}

async function createCard(request: CreateCardRequest): Promise<{ cardId: string }> {
  const { transaction, input, actor } = request;

  const project = await loadWritableProject(
    { database: transaction.database, actor, role: request.role },
    input.projectId,
  );

  const list = await loadListOnBoard(transaction.database, project.boardId, input.listId);

  // A new card is arriving in the list, so the limit applies to it as much as it
  // does to one being dragged in.
  assertListHasRoom({
    listName: list.name,
    wipLimit: list.wipLimit,
    openCardCount: await countOpenCards(transaction.database, list.id),
    isAdvisory: project.wipIsAdvisory,
  });

  const cardKey = await allocateCardKey({
    database: transaction.database,
    projectId: project.projectId,
    projectCode: project.projectCode,
    cardType: input.type,
  });

  // The same rule an edit is held to: a card is never created already given to
  // somebody who could not open it.
  await assertPeopleAreOnTheProject({
    database: transaction.database,
    projectId: project.projectId,
    assigneeId: input.assigneeId,
  });

  const card = await transaction.database
    .insertInto('card')
    .values({
      accountId: project.accountId,
      projectId: project.projectId,
      listId: list.id,
      cardKey,
      title: input.title,
      type: input.type,
      priority: input.priority ?? null,
      points: input.points ?? null,
      estimateMinutes: input.estimateMinutes ?? null,
      assigneeId: input.assigneeId ?? null,
      milestoneId: input.milestoneId ?? null,
      // Whoever made it, unless somebody else is named later.
      reporterId: actor.userId,
      discipline: input.discipline ?? null,
      fixVersion: input.fixVersion ?? null,
      dueOn: input.dueOn ?? null,
      description: input.description ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      position: await placeAtEndOfList(transaction.database, list.id),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  transaction.appendEvent({
    accountId: project.accountId,
    aggregateType: 'card',
    aggregateId: card.id,
    name: 'board.cardCreated',
    payload: { cardKey, projectId: project.projectId, listId: list.id, type: input.type },
  });

  return { cardId: card.id };
}
