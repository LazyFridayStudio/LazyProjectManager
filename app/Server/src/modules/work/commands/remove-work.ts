import { createCommandSuccess, removeWorkCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand } from '../../../cqrs/execute-command.js';
import { requireActor } from '../../../cqrs/request-context.js';

/**
 * Takes one of your own entries back off.
 *
 * Removed rather than edited: an hour typed as ten is fixed by deleting it and
 * logging it again, and an edit history on a timesheet is a great deal of
 * machinery for a mistake that takes ten seconds to redo.
 *
 * No permission, and the guard is the one `notifications.see` runs on: the
 * delete names the session's own user, so an entry belonging to somebody else
 * is a row it cannot reach. Not even a lead may take somebody's hours off —
 * they are that person's account of their own week, and a producer who thinks
 * one is wrong asks them.
 *
 * An entry that is already gone, or was never theirs, changes nothing and says
 * so. Pressing a stale panel twice is not a failure worth reporting.
 */
export const removeWorkHandler = defineCommandHandler({
  definition: removeWorkCommand,

  async execute(input: { commandId: string; entryId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, removeWorkCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: removeWorkCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await transaction.database
          .deleteFrom('workLog')
          .where('id', '=', input.entryId)
          .where('userId', '=', actor.userId)
          .execute();
      },
    });

    return outcome.applied ? createCommandSuccess(input.entryId) : createCommandSuccess();
  },
});
