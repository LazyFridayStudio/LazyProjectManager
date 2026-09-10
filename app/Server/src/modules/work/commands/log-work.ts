import { createCommandSuccess, logWorkCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import type { RequestActor } from '../../../cqrs/request-context.js';
import { InvariantViolatedError } from '../../../domain/index.js';
import { authoriseWithinProject } from '../../projects/project-access.js';
import { findWhatWasWorkedOn, type WorkedOn } from '../what-was-worked-on.js';

interface LogWorkInput {
  commandId: string;
  cardId?: string;
  assetId?: string;
  minutes: number;
  workedOn: string;
  note?: string;
}

/**
 * Records time somebody worked on a card or an asset.
 *
 * Always their own: the actor is the author, and there is no field to say
 * otherwise. An entry means "I did this", and a sheet other people can write
 * into is one nobody can vouch for.
 *
 * Behind `card.update` on the project the thing belongs to, because logging
 * work against a card is a change to that card's record and the same people who
 * may move it are the people doing the work. It is deliberately not its own
 * permission: an install that wants to stop somebody logging hours wants to
 * stop them working on the project.
 */
export const logWorkHandler = defineCommandHandler({
  definition: logWorkCommand,

  async execute(input: LogWorkInput, context): Promise<CommandSuccess> {
    assertNotInTheFuture(input.workedOn);

    const worked = await findWhatWasWorkedOn(context.database, input);

    const actor = await authoriseWithinProject({
      context,
      handlerName: logWorkCommand.name,
      projectId: worked.projectId,
      action: 'card.update',
    });

    const outcome = await executeCommand({
      database: context.database,
      commandName: logWorkCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => append({ transaction, input, actor, worked }),
    });

    return outcome.applied ? createCommandSuccess(worked.id) : createCommandSuccess();
  },
});

interface AppendRequest {
  readonly transaction: CommandTransaction;
  readonly input: LogWorkInput;
  readonly actor: RequestActor;
  readonly worked: WorkedOn;
}

async function append(request: AppendRequest): Promise<void> {
  const { transaction, input, actor, worked } = request;

  const entry = await transaction.database
    .insertInto('workLog')
    .values({
      cardId: worked.kind === 'card' ? worked.id : null,
      assetId: worked.kind === 'asset' ? worked.id : null,
      userId: actor.userId,
      minutes: input.minutes,
      workedOn: input.workedOn,
      note: input.note ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  transaction.appendEvent({
    accountId: worked.accountId,
    aggregateType: worked.kind,
    aggregateId: worked.id,
    name: 'work.logged',
    /*
     * How long, and on what. Not the note.
     *
     * The trail is read across the whole install, and what somebody wrote about
     * their afternoon is theirs — the hours are the fact the project needs.
     */
    payload: {
      projectId: worked.projectId,
      entryId: entry.id,
      minutes: input.minutes,
      workedOn: input.workedOn,
    },
  });
}

/**
 * Refuses a day nobody could have worked.
 *
 * Not a schema rule, because "in the future" is a question about now and a
 * schema does not know what now is. The mistake this catches is a year typed as
 * 2027, which otherwise sits in the sheet until somebody totals a quarter and
 * finds work booked to it that has not happened.
 *
 * A day of slack, deliberately. The server keeps time in UTC and a studio does
 * not: somebody in Auckland logging their Monday afternoon is a day ahead of it,
 * and refusing them would be the server being right about the wrong thing.
 */
function assertNotInTheFuture(workedOn: string): void {
  const tomorrow = new Date(Date.now() + DAY_IN_MS).toISOString().slice(0, 10);

  if (workedOn > tomorrow) {
    throw new InvariantViolatedError('That day has not happened yet.', {
      workedOn: 'Not in the future.',
    });
  }
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
