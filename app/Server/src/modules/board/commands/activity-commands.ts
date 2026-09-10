import {
  addSubtaskCommand,
  commentCommand,
  createCommandSuccess,
  getReciprocalLinkKind,
  linkCardCommand,
  putUnderLegendCommand,
  removeSubtaskCommand,
  setLegendCommand,
  unlinkCardCommand,
  updateSubtaskCommand,
  type CardLinkKind,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { recordMentions } from './record-mentions.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import {
  CardNotFoundError,
  InvariantViolatedError,
  positionBetween,
  type MembershipRole,
  type PermittedAction,
} from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { loadWritableCard, type WritableCard } from '../cards/card-access.js';

interface Authorised {
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function authorise(
  context: RequestContext,
  commandName: string,
  action: PermittedAction,
): Promise<Authorised> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action });

  return { actor, role };
}

/** Adds a step to a card. It goes on the end of the ones already there. */
export const addSubtaskHandler = defineCommandHandler({
  definition: addSubtaskCommand,

  async execute(
    input: { commandId: string; cardId: string; title: string },
    context,
  ): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, addSubtaskCommand.name, 'card.update');

    const outcome = await executeCommand({
      database: context.database,
      commandName: addSubtaskCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const card = await loadWritableCard(
          { database: transaction.database, actor, role },
          input.cardId,
        );

        const last = await transaction.database
          .selectFrom('subtask')
          .select(({ fn }) => fn.max('position').as('lastPosition'))
          .where('cardId', '=', card.id)
          .executeTakeFirst();

        const subtask = await transaction.database
          .insertInto('subtask')
          .values({
            cardId: card.id,
            title: input.title,
            position: positionBetween(readPosition(last?.lastPosition), null),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        appendCardEvent({
          transaction,
          card,
          name: 'board.subtaskAdded',
          payload: { subtaskId: subtask.id },
        });

        return { subtaskId: subtask.id };
      },
    });

    return outcome.applied
      ? createCommandSuccess(outcome.result.subtaskId)
      : createCommandSuccess();
  },
});

/** Ticks a step off, unticks it, or renames it. */
export const updateSubtaskHandler = defineCommandHandler({
  definition: updateSubtaskCommand,

  async execute(
    input: { commandId: string; subtaskId: string; title?: string; done?: boolean },
    context,
  ): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, updateSubtaskCommand.name, 'card.update');

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateSubtaskCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const { card } = await loadSubtask(
          { database: transaction.database, actor, role },
          input.subtaskId,
        );

        const patch: Record<string, unknown> = {};

        if (input.title !== undefined) {
          patch.title = input.title;
        }

        if (input.done !== undefined) {
          patch.done = input.done;
        }

        if (Object.keys(patch).length === 0) {
          return;
        }

        await transaction.database
          .updateTable('subtask')
          .set(patch)
          .where('id', '=', input.subtaskId)
          .execute();

        appendCardEvent({
          transaction,
          card,
          name: 'board.subtaskUpdated',
          payload: { subtaskId: input.subtaskId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.subtaskId) : createCommandSuccess();
  },
});

/** Removes a step. Subtasks are working notes, so this really does delete. */
export const removeSubtaskHandler = defineCommandHandler({
  definition: removeSubtaskCommand,

  async execute(input: { commandId: string; subtaskId: string }, context): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, removeSubtaskCommand.name, 'card.update');

    const outcome = await executeCommand({
      database: context.database,
      commandName: removeSubtaskCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const { card } = await loadSubtask(
          { database: transaction.database, actor, role },
          input.subtaskId,
        );

        await transaction.database
          .deleteFrom('subtask')
          .where('id', '=', input.subtaskId)
          .execute();

        appendCardEvent({
          transaction,
          card,
          name: 'board.subtaskRemoved',
          payload: { subtaskId: input.subtaskId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.subtaskId) : createCommandSuccess();
  },
});

/** Says something on a card. */
export const commentHandler = defineCommandHandler({
  definition: commentCommand,

  async execute(
    input: { commandId: string; cardId: string; body: string },
    context,
  ): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, commentCommand.name, 'card.comment');

    const outcome = await executeCommand({
      database: context.database,
      commandName: commentCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const card = await loadWritableCard(
          { database: transaction.database, actor, role },
          input.cardId,
        );

        const comment = await transaction.database
          .insertInto('comment')
          .values({ cardId: card.id, authorId: actor.userId, body: input.body })
          .returning('id')
          .executeTakeFirstOrThrow();

        // Who it named, out of the body just stored rather than out of anything
        // the browser claimed about it.
        const named = await recordMentions({
          database: transaction.database,
          commentId: comment.id,
          projectId: card.projectId,
          accountId: card.accountId,
          body: input.body,
          authorId: actor.userId,
        });

        // The body is not in the payload: a comment is readable by whoever can
        // open the card, and the outbox is read far more widely than that. The
        // count is safe — it says somebody was told, not who or what about.
        appendCardEvent({
          transaction,
          card,
          name: 'board.commented',
          payload: { commentId: comment.id, mentioned: named.length },
        });

        return { commentId: comment.id };
      },
    });

    return outcome.applied
      ? createCommandSuccess(outcome.result.commentId)
      : createCommandSuccess();
  },
});

/**
 * Ties one card to another, both ways round.
 *
 * `blocks` and `blocked_by` are the same fact told from either end, so one
 * command writes both rows — otherwise a card could be blocked by something that
 * does not know it is blocking.
 */
export const linkCardHandler = defineCommandHandler({
  definition: linkCardCommand,

  async execute(
    input: { commandId: string; cardId: string; toCardKey: string; kind: CardLinkKind },
    context,
  ): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, linkCardCommand.name, 'card.link');

    const outcome = await executeCommand({
      database: context.database,
      commandName: linkCardCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const access = { database: transaction.database, actor, role };
        const card = await loadWritableCard(access, input.cardId);

        // Looked up inside this card's project, which is what stops a key from
        // another board being linked to and what makes an unknown key read as
        // "no such card" rather than as a permission answer.
        const other = await transaction.database
          .selectFrom('card')
          .select('id')
          .where('projectId', '=', card.projectId)
          .where('cardKey', '=', input.toCardKey)
          .executeTakeFirst();

        if (other === undefined) {
          throw new CardNotFoundError();
        }

        if (other.id === card.id) {
          throw new InvariantViolatedError('A card cannot be linked to itself.');
        }

        await transaction.database
          .insertInto('cardLink')
          .values([
            { fromCardId: card.id, toCardId: other.id, kind: input.kind },
            {
              fromCardId: other.id,
              toCardId: card.id,
              kind: getReciprocalLinkKind(input.kind),
            },
          ])
          .onConflict((conflict) => conflict.doNothing())
          .execute();

        appendCardEvent({
          transaction,
          card,
          name: 'board.cardLinked',
          payload: { toCardId: other.id, kind: input.kind },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.cardId) : createCommandSuccess();
  },
});

/** Removes a link, and the half of it pointing the other way. */
export const unlinkCardHandler = defineCommandHandler({
  definition: unlinkCardCommand,

  async execute(input: { commandId: string; linkId: string }, context): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, unlinkCardCommand.name, 'card.link');

    const outcome = await executeCommand({
      database: context.database,
      commandName: unlinkCardCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const link = await transaction.database
          .selectFrom('cardLink')
          .select(['id', 'fromCardId', 'toCardId', 'kind'])
          .where('id', '=', input.linkId)
          .executeTakeFirst();

        if (link === undefined) {
          throw new CardNotFoundError();
        }

        // Reached through the card, so a link id from another install is
        // refused the same way the card behind it would be.
        const card = await loadWritableCard(
          { database: transaction.database, actor, role },
          link.fromCardId,
        );

        await transaction.database
          .deleteFrom('cardLink')
          .where((expression) =>
            expression.or([
              expression.eb('id', '=', link.id),
              expression.and([
                expression.eb('fromCardId', '=', link.toCardId),
                expression.eb('toCardId', '=', link.fromCardId),
                expression.eb('kind', '=', getReciprocalLinkKind(link.kind)),
              ]),
            ]),
          )
          .execute();

        appendCardEvent({
          transaction,
          card,
          name: 'board.cardUnlinked',
          payload: { toCardId: link.toCardId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.linkId) : createCommandSuccess();
  },
});

/**
 * A subtask, reached through the card it belongs to.
 *
 * Going through the card is what applies the project's visibility rules; a
 * subtask id on its own says nothing about who may touch it.
 */
async function loadSubtask(
  access: { database: CommandTransaction['database']; actor: RequestActor; role: MembershipRole },
  subtaskId: string,
): Promise<{ card: WritableCard }> {
  const subtask = await access.database
    .selectFrom('subtask')
    .select('cardId')
    .where('id', '=', subtaskId)
    .executeTakeFirst();

  if (subtask === undefined) {
    throw new CardNotFoundError();
  }

  return { card: await loadWritableCard(access, subtask.cardId) };
}

interface CardEvent {
  readonly transaction: CommandTransaction;
  readonly card: WritableCard;
  readonly name: string;
  readonly payload: Record<string, unknown>;
}

function appendCardEvent({ transaction, card, name, payload }: CardEvent): void {
  transaction.appendEvent({
    accountId: card.accountId,
    aggregateType: 'card',
    aggregateId: card.id,
    name,
    payload: { projectId: card.projectId, ...payload },
  });
}

/** `numeric` arrives from `pg` as a string, so every read goes through here. */
function readPosition(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Makes a card a legend, or stops it being one.
 *
 * Unmaking one lets everything go rather than refusing: a producer who decides
 * the clump was a bad idea wants it gone, and a command that says "empty it
 * first" makes them do by hand what this can do in the same statement. The
 * cards themselves are untouched — they were always the real work.
 *
 * A card that is under a legend cannot become one. One level is the whole model:
 * two makes "which legend closes this" a question with two answers.
 */
export const setLegendHandler = defineCommandHandler({
  definition: setLegendCommand,

  async execute(
    input: { commandId: string; cardId: string; isLegend: boolean },
    context,
  ): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, setLegendCommand.name, 'card.link');

    const outcome = await executeCommand({
      database: context.database,
      commandName: setLegendCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const access = { database: transaction.database, actor, role };
        const card = await loadWritableCard(access, input.cardId);
        const state = await readLegendState(transaction, card.id);

        if (input.isLegend && state.legendId !== null) {
          throw new InvariantViolatedError(
            'A card that is under a legend cannot be one. Take it out of its legend first.',
          );
        }

        await transaction.database
          .updateTable('card')
          .set({ isLegend: input.isLegend })
          .where('id', '=', card.id)
          .execute();

        if (!input.isLegend) {
          await transaction.database
            .updateTable('card')
            .set({ legendId: null })
            .where('legendId', '=', card.id)
            .execute();
        }

        appendCardEvent({
          transaction,
          card,
          name: input.isLegend ? 'board.legendSet' : 'board.legendCleared',
          payload: { cardId: card.id },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.cardId) : createCommandSuccess();
  },
});

/**
 * Puts a card under a legend, or takes it out from under one.
 *
 * Looked up inside this card's own project, which is what stops a key from
 * another board being used and what makes an unknown key read as "no such card"
 * rather than as an answer about who may see what.
 */
export const putUnderLegendHandler = defineCommandHandler({
  definition: putUnderLegendCommand,

  async execute(
    input: { commandId: string; cardId: string; legendKey: string | null },
    context,
  ): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, putUnderLegendCommand.name, 'card.link');

    const outcome = await executeCommand({
      database: context.database,
      commandName: putUnderLegendCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const access = { database: transaction.database, actor, role };
        const card = await loadWritableCard(access, input.cardId);
        const legendId = await findLegend(transaction, card, input.legendKey);

        await transaction.database
          .updateTable('card')
          .set({ legendId })
          .where('id', '=', card.id)
          .execute();

        appendCardEvent({
          transaction,
          card,
          name: legendId === null ? 'board.cardReleased' : 'board.cardGathered',
          payload: { legendId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.cardId) : createCommandSuccess();
  },
});

/** What the card already is, which both rules above are about. */
async function readLegendState(
  transaction: CommandTransaction,
  cardId: string,
): Promise<{ isLegend: boolean; legendId: string | null }> {
  const row = await transaction.database
    .selectFrom('card')
    .select(['isLegend', 'legendId'])
    .where('id', '=', cardId)
    .executeTakeFirst();

  if (row === undefined) {
    throw new CardNotFoundError();
  }

  return row;
}

/**
 * The legend a key names, checked against every rule before it is written.
 *
 * Null in means null out — taking a card out of its legend needs no lookup and
 * no legend to exist.
 */
async function findLegend(
  transaction: CommandTransaction,
  card: WritableCard,
  legendKey: string | null,
): Promise<string | null> {
  if (legendKey === null) {
    return null;
  }

  const legend = await transaction.database
    .selectFrom('card')
    .select(['id', 'isLegend'])
    .where('projectId', '=', card.projectId)
    .where('cardKey', '=', legendKey)
    .executeTakeFirst();

  if (legend === undefined) {
    throw new CardNotFoundError();
  }

  if (legend.id === card.id) {
    throw new InvariantViolatedError('A card cannot be its own legend.');
  }

  if (!legend.isLegend) {
    throw new InvariantViolatedError(`${legendKey} is not a legend. Make it one first.`);
  }

  const state = await readLegendState(transaction, card.id);

  if (state.isLegend) {
    throw new InvariantViolatedError(
      'A legend cannot be put under another legend. Legends are one level deep.',
    );
  }

  return legend.id;
}
