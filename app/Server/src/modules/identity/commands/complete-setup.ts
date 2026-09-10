import { completeSetupCommand, createCommandSuccess, type CommandSuccess } from '@lpm/shared';
import {
  deriveAccountSlug,
  deriveInitials,
  SetupAlreadyCompletedError,
} from '../../../domain/index.js';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import type { RequestContext } from '../../../cqrs/request-context.js';
import { hashPassword } from '../password-hasher.js';
import { seedDefaultPermissionGroups } from '../../permissions/default-groups.js';
import { issueSession } from '../sessions/session-store.js';

interface CompleteSetupInput {
  commandId: string;
  serverName: string;
  baseUrl: string;
  admin: { email: string; password: string; displayName: string };
}

/**
 * The first-run wizard.
 *
 * Unauthenticated, because there is nobody to authenticate as yet. What keeps it
 * from being an open door is the singleton index on `install_settings`: the
 * second caller loses the race at the database, not at a check-then-act in
 * JavaScript that two simultaneous requests could both pass.
 */
export const completeSetupHandler = defineCommandHandler({
  definition: completeSetupCommand,
  requiresAuthentication: false,

  async execute(input: CompleteSetupInput, context): Promise<CommandSuccess> {
    await assertSetupHasNotRun(context);

    // Hashing takes deliberate CPU time. Doing it before the transaction opens
    // means Argon2 is not holding a database connection while it works.
    const passwordHash = await hashPassword(input.admin.password);

    const outcome = await executeCommand({
      database: context.database,
      commandName: completeSetupCommand.name,
      commandId: input.commandId,
      actorId: null,
      run: (transaction) => createInstall({ transaction, input, passwordHash, context }),
    });

    if (!outcome.applied) {
      return createCommandSuccess();
    }

    context.sessionCookie.issue(outcome.result.sessionToken);

    return createCommandSuccess(outcome.result.userId);
  },
});

/**
 * Creates the account, its owner and the install settings row together.
 *
 * All three or none: an install with an account but no owner would be
 * unreachable, and setup refuses to run a second time to fix it.
 */
interface CreateInstallRequest {
  readonly transaction: CommandTransaction;
  readonly input: CompleteSetupInput;
  readonly passwordHash: string;
  readonly context: RequestContext;
}

async function createInstall(
  request: CreateInstallRequest,
): Promise<{ userId: string; sessionToken: string }> {
  const { transaction, input, passwordHash, context } = request;

  const account = await transaction.database
    .insertInto('account')
    .values({ name: input.serverName, slug: deriveAccountSlug(input.serverName) })
    .returning('id')
    .executeTakeFirstOrThrow();

  const user = await transaction.database
    .insertInto('appUser')
    .values({
      email: input.admin.email,
      passwordHash,
      displayName: input.admin.displayName,
      initials: deriveInitials(input.admin.displayName),
      status: 'active',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await transaction.database
    .insertInto('membership')
    .values({ accountId: account.id, userId: user.id, role: 'owner' })
    .execute();

  await transaction.database
    .insertInto('installSettings')
    .values({
      serverName: input.serverName,
      baseUrl: input.baseUrl,
      setupCompletedAt: new Date(),
      // Written here and never again. This person's role cannot be changed and
      // they cannot be suspended, which is what keeps an install reachable
      // after somebody rearranges the roles.
      ownerUserId: user.id,
    })
    .execute();

  // The headings the Permissions screen already groups actions under,
  // plus the one that holds the lot. Ordinary groups once made: an install that
  // wants none of them deletes them.
  await seedDefaultPermissionGroups(transaction, account.id);

  const session = await issueSession(transaction.database, user.id, context.origin);

  transaction.appendEvent({
    accountId: account.id,
    aggregateType: 'install',
    aggregateId: account.id,
    name: 'identity.installCompleted',
    // No password material, hashed or otherwise: the outbox is an audit trail
    // that is read far more widely than the user table.
    payload: { serverName: input.serverName, ownerUserId: user.id },
  });

  return { userId: user.id, sessionToken: session.token };
}

async function assertSetupHasNotRun(context: RequestContext): Promise<void> {
  const existing = await context.database
    .selectFrom('installSettings')
    .select('setupCompletedAt')
    .executeTakeFirst();

  if (existing !== undefined) {
    throw new SetupAlreadyCompletedError();
  }
}
