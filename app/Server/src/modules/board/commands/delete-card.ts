import { createCommandSuccess, deleteCardCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { binIt } from '../../recovery/index.js';
import { loadWritableCard, type WritableCard } from '../cards/card-access.js';

/**
 * Takes a card off the board for good.
 *
 * Its own permission rather than `card.update`, because "may fix a typo" and
 * "may destroy an afternoon of somebody's comments" are not the same trust, and
 * a studio that wants the first without the second could not say so.
 *
 * Everything hanging off the card goes with it — subtasks, comments, links,
 * attachments, what the repository said, which assets it was about. All of it
 * cascades in the database, which means all of it would have gone silently; the
 * bin copy is taken first, so a restore brings back the card as it stood rather
 * than an empty one with the right title.
 */
export const deleteCardHandler = defineCommandHandler({
  definition: deleteCardCommand,

  async execute(input: { commandId: string; cardId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, deleteCardCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'card.delete' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: deleteCardCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const reached = await loadWritableCard(
          { database: transaction.database, actor, role },
          input.cardId,
        );

        const card = await readCard(transaction, reached.id);
        const gathered = card.isLegend ? await cardsUnder(transaction, card.id) : [];

        await binIt({
          transaction,
          kind: 'card',
          accountId: reached.accountId,
          actorId: actor.userId,
          subjectId: card.id,
          projectId: reached.projectId,
          name: card.title,
          // Its key, which is how anybody says which card they mean — and it
          // carries the project's code, so the bin reads without a join.
          about: card.cardKey,
          /*
           * The cards under a legend keep going; they stop being clumped.
           *
           * `card.legend_id` is `on delete set null`, so the database unhooks
           * them on the way out. This is what re-gathers the ones nobody has
           * since moved somewhere else, exactly as a milestone re-promises the
           * cards that were held to it.
           */
          repairs: gathered.map((childId) => ({
            table: 'card',
            id: childId,
            column: 'legend_id',
            was: card.id,
            now: null,
          })),
        });

        await dismissTheIssue(transaction, reached, card.externalId);

        await transaction.database.deleteFrom('card').where('id', '=', card.id).execute();

        transaction.appendEvent({
          accountId: reached.accountId,
          aggregateType: 'card',
          aggregateId: card.id,
          name: 'board.cardDeleted',
          /*
           * The key is in the payload rather than left to a join.
           *
           * Every other entry about a card is labelled by joining the trail to
           * the card. This is the one event where the row is gone by the time
           * anybody reads it, so the key travels with the entry or the trail
           * says only that a card was deleted.
           */
          payload: { projectId: reached.projectId, cardKey: card.cardKey },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.cardId) : createCommandSuccess();
  },
});

/** The parts of a card that outlive it: what it was called, and what it was. */
async function readCard(transaction: CommandTransaction, cardId: string) {
  return transaction.database
    .selectFrom('card')
    .select(['id', 'title', 'cardKey', 'externalId', 'isLegend'])
    .where('id', '=', cardId)
    .executeTakeFirstOrThrow();
}

/** The cards this legend is holding together, about to be let go of. */
async function cardsUnder(
  transaction: CommandTransaction,
  legendId: string,
): Promise<readonly string[]> {
  const gathered = await transaction.database
    .selectFrom('card')
    .select('id')
    .where('legendId', '=', legendId)
    .execute();

  return gathered.map((card) => card.id);
}

/**
 * Tells the sync not to make this card again.
 *
 * Without it, deleting a card that came from a repository lasts until the
 * worker next comes round: the sync sees an issue with no card and does the
 * obvious thing. The forge is told nothing — the issue stays open, because
 * deleting a card is a statement about this board and not about somebody's
 * issue tracker.
 */
async function dismissTheIssue(
  transaction: CommandTransaction,
  card: WritableCard,
  externalId: string | null,
): Promise<void> {
  if (externalId === null) {
    return;
  }

  await transaction.database
    .insertInto('dismissedIssue')
    .values({ accountId: card.accountId, projectId: card.projectId, externalId })
    // Deleted, restored, and deleted again is the same sentence said twice.
    .onConflict((conflict) => conflict.columns(['projectId', 'externalId']).doNothing())
    .execute();
}
