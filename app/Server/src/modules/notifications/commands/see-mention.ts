import { createCommandSuccess, seeMentionCommand, type CommandSuccess } from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand } from '../../../cqrs/execute-command.js';
import { requireActor } from '../../../cqrs/request-context.js';

/**
 * Takes one mention off the mark.
 *
 * No permission, and the guard is the same one `identity.updateProfile` runs on:
 * the update names the session's own user, so a mention belonging to somebody
 * else is a row this cannot reach. Asking about one that is already seen, or
 * never existed, changes nothing and says so — pressing a stale panel twice is
 * not a failure worth reporting.
 *
 * Nothing is appended to the trail. Who read what and when is a great deal of
 * noise about nobody's work, and the audit trail is read across the whole
 * install.
 */
export const seeMentionHandler = defineCommandHandler({
  definition: seeMentionCommand,

  async execute(input: { commandId: string; mentionId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, seeMentionCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: seeMentionCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await transaction.database
          .updateTable('commentMention')
          .set({ seenAt: new Date() })
          .where('id', '=', input.mentionId)
          .where('userId', '=', actor.userId)
          .where('seenAt', 'is', null)
          .execute();
      },
    });

    return outcome.applied ? createCommandSuccess(input.mentionId) : createCommandSuccess();
  },
});
