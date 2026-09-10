import {
  createCommandSuccess,
  signInCommand,
  signOutCommand,
  type CommandSuccess,
} from '@lpm/shared';
import { AccountSuspendedError, InvalidCredentialsError } from '../../../domain/index.js';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand } from '../../../cqrs/execute-command.js';
import type { RequestContext } from '../../../cqrs/request-context.js';
import { isPasswordCorrect, spendVerificationTime } from '../password-hasher.js';
import { issueSession, revokeSession } from '../sessions/session-store.js';

interface SignInInput {
  commandId: string;
  email: string;
  password: string;
}

export const signInHandler = defineCommandHandler({
  definition: signInCommand,
  requiresAuthentication: false,

  async execute(input: SignInInput, context): Promise<CommandSuccess> {
    const user = await findUserForSignIn(context, input.email);

    if (user === null) {
      // Spend the time a real verification would, so a missing account and a
      // wrong password are indistinguishable from the outside.
      await spendVerificationTime(input.password);
      throw new InvalidCredentialsError();
    }

    if (!(await isPasswordCorrect(input.password, user.passwordHash))) {
      throw new InvalidCredentialsError();
    }

    if (user.status !== 'active') {
      throw new AccountSuspendedError();
    }

    const outcome = await executeCommand({
      database: context.database,
      commandName: signInCommand.name,
      commandId: input.commandId,
      actorId: user.id,
      run: async (transaction) => {
        const session = await issueSession(transaction.database, user.id, context.origin);

        await transaction.database
          .updateTable('appUser')
          .set({ lastSeenAt: new Date() })
          .where('id', '=', user.id)
          .execute();

        transaction.appendEvent({
          accountId: user.accountId,
          aggregateType: 'user',
          aggregateId: user.id,
          name: 'identity.userSignedIn',
          payload: { userId: user.id },
        });

        return session;
      },
    });

    if (!outcome.applied) {
      return createCommandSuccess();
    }

    context.sessionCookie.issue(outcome.result.token);

    return createCommandSuccess(user.id);
  },
});

/**
 * Signing out always succeeds, even without a session.
 *
 * A browser that has lost its cookie still needs the local state cleared, and
 * failing here would leave the user stuck on a screen they cannot escape.
 */
export const signOutHandler = defineCommandHandler({
  definition: signOutCommand,
  requiresAuthentication: false,

  async execute(_input, context): Promise<CommandSuccess> {
    if (context.sessionToken !== null) {
      await revokeSession(context.database, context.sessionToken);
    }

    context.sessionCookie.clear();

    return createCommandSuccess();
  },
});

interface SignInCandidate {
  id: string;
  accountId: string;
  passwordHash: string;
  status: string;
}

/**
 * `email` is a citext column, so this comparison is case-insensitive in the
 * index itself and no call site has to remember to lowercase first.
 */
async function findUserForSignIn(
  context: RequestContext,
  email: string,
): Promise<SignInCandidate | null> {
  const user = await context.database
    .selectFrom('appUser')
    .innerJoin('membership', 'membership.userId', 'appUser.id')
    .select([
      'appUser.id as id',
      'membership.accountId as accountId',
      'appUser.passwordHash as passwordHash',
      'appUser.status as status',
    ])
    .where('appUser.email', '=', email)
    /*
     * People only.
     *
     * An agent has no password, and the string in that column is not a valid
     * hash — so a verification against it could never succeed. This is the
     * belt: an agent is not a thing that signs in, and the query that looks for
     * somebody signing in should not find one. Anybody typing an agent's
     * address gets the same answer as for an address that does not exist,
     * which is the answer they should get.
     */
    .where('appUser.kind', '=', 'person')
    .executeTakeFirst();

  return user ?? null;
}
