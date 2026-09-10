import {
  changePasswordCommand,
  createCommandSuccess,
  createUserCommand,
  resetUserPasswordCommand,
  setUserRoleCommand,
  setUserStatusCommand,
  updateProfileCommand,
  type CommandSuccess,
  type MembershipRoleName,
  type Theme,
  type ThemeColors,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import {
  assertAnAdminRemains,
  deriveInitials,
  EmailAlreadyTakenError,
  InvalidCredentialsError,
  InvariantViolatedError,
  UserNotFoundError,
} from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { hashPassword, isPasswordCorrect } from '../password-hasher.js';
import { issueSession } from '../sessions/session-store.js';

/** The role that administers the install, which is the one this module guards. */
const ADMIN_ROLE = 'owner';

interface CreateUserInput {
  commandId: string;
  email: string;
  displayName: string;
  role?: MembershipRoleName;
  password: string;
}

/**
 * What a person can do before anybody gives them a permission group: read.
 *
 * The same floor an agent is made on, and for the same reason. What somebody
 * may do is decided by the groups they hold, so the rung they stand on is not a
 * question any screen asks — and the lowest one is the only safe answer to a
 * question nobody was asked, because everything above it is then something a
 * person deliberately allowed.
 */
const FLOOR = 'viewer' as const;

/**
 * Adds a person to the install.
 *
 * Two rows in one transaction: the person, and their membership of this
 * account. A person with no membership is one who can sign in and see nothing,
 * which reads to them as the software being broken.
 */
export const createUserHandler = defineCommandHandler({
  definition: createUserCommand,

  async execute(input: CreateUserInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, createUserCommand.name);

    // Argon2 is deliberately slow. Hashing before the transaction opens keeps it
    // from holding a database connection while it works.
    const passwordHash = await hashPassword(input.password);

    const outcome = await executeCommand({
      database: context.database,
      commandName: createUserCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => createUser({ transaction, input, actor, passwordHash }),
    });

    return outcome.applied ? createCommandSuccess(outcome.result.userId) : createCommandSuccess();
  },
});

interface CreateUserRequest {
  readonly transaction: CommandTransaction;
  readonly input: CreateUserInput;
  readonly actor: RequestActor;
  readonly passwordHash: string;
}

async function createUser(request: CreateUserRequest): Promise<{ userId: string }> {
  const { transaction, input, actor } = request;

  // `email` is citext, so this finds an address that differs only in case — and
  // so would the unique index, but a checked message names the field.
  const existing = await transaction.database
    .selectFrom('appUser')
    .select('id')
    .where('email', '=', input.email)
    .executeTakeFirst();

  if (existing !== undefined) {
    throw new EmailAlreadyTakenError();
  }

  const user = await transaction.database
    .insertInto('appUser')
    .values({
      email: input.email,
      passwordHash: request.passwordHash,
      displayName: input.displayName,
      initials: deriveInitials(input.displayName),
      status: 'active',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const role = input.role ?? FLOOR;

  await transaction.database
    .insertInto('membership')
    .values({ accountId: actor.accountId, userId: user.id, role })
    .execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'user',
    aggregateId: user.id,
    // No password material, hashed or otherwise: the trail is read far more
    // widely than the user table.
    name: 'identity.userCreated',
    payload: { displayName: input.displayName, role },
  });

  return { userId: user.id };
}

interface SetUserRoleInput {
  commandId: string;
  userId: string;
  role: MembershipRoleName;
}

/** Changes what a person may do on this install. */
export const setUserRoleHandler = defineCommandHandler({
  definition: setUserRoleCommand,

  async execute(input: SetUserRoleInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, setUserRoleCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: setUserRoleCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => setUserRole({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(input.userId) : createCommandSuccess();
  },
});

async function setUserRole(request: {
  transaction: CommandTransaction;
  input: SetUserRoleInput;
  actor: RequestActor;
}): Promise<void> {
  const { transaction, input, actor } = request;
  const person = await loadPersonOnInstall(transaction, actor, input.userId);

  if (person.role === input.role) {
    return;
  }

  await assertNotTheInstallOwner(transaction, person, 'Their role cannot be changed.');

  if (person.role === ADMIN_ROLE) {
    assertAnAdminRemains({
      activeAdminCount: await countActiveAdmins(transaction, actor),
      subjectIsActiveAdmin: person.status === 'active',
    });
  }

  await transaction.database
    .updateTable('membership')
    .set({ role: input.role })
    .where('userId', '=', person.userId)
    .where('accountId', '=', actor.accountId)
    .execute();

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'user',
    aggregateId: person.userId,
    name: 'identity.userRoleChanged',
    payload: { displayName: person.displayName, from: person.role, to: input.role },
  });
}

interface SetUserStatusInput {
  commandId: string;
  userId: string;
  status: 'active' | 'suspended';
}

/**
 * Turns somebody's access off, or back on.
 *
 * Suspending ends their sessions in the same transaction. An account that
 * cannot sign in but is still signed in somewhere is not suspended.
 */
export const setUserStatusHandler = defineCommandHandler({
  definition: setUserStatusCommand,

  async execute(input: SetUserStatusInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, setUserStatusCommand.name);

    const outcome = await executeCommand({
      database: context.database,
      commandName: setUserStatusCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => setUserStatus({ transaction, input, actor }),
    });

    return outcome.applied ? createCommandSuccess(input.userId) : createCommandSuccess();
  },
});

async function setUserStatus(request: {
  transaction: CommandTransaction;
  input: SetUserStatusInput;
  actor: RequestActor;
}): Promise<void> {
  const { transaction, input, actor } = request;
  const person = await loadPersonOnInstall(transaction, actor, input.userId);
  const isSuspending = input.status === 'suspended';

  if (isSuspending && person.userId === actor.userId) {
    throw new InvariantViolatedError('Suspending your own account would lock you out of it.');
  }

  if (isSuspending) {
    await assertNotTheInstallOwner(transaction, person, 'They cannot be suspended.');
  }

  if (isSuspending && person.role === ADMIN_ROLE) {
    assertAnAdminRemains({
      activeAdminCount: await countActiveAdmins(transaction, actor),
      subjectIsActiveAdmin: person.status === 'active',
    });
  }

  await transaction.database
    .updateTable('appUser')
    .set({ status: input.status })
    .where('id', '=', person.userId)
    .execute();

  if (isSuspending) {
    await endEverySession(transaction, person.userId);
  }

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'user',
    aggregateId: person.userId,
    name: isSuspending ? 'identity.userSuspended' : 'identity.userRestored',
    payload: { displayName: person.displayName },
  });
}

interface ResetUserPasswordInput {
  commandId: string;
  userId: string;
  password: string;
}

/**
 * Sets somebody else's password.
 *
 * With no mail server there is no reset link that could work, so an admin is
 * the way back in. Their sessions end with it: a reset that leaves the old
 * session alive protects nobody.
 */
export const resetUserPasswordHandler = defineCommandHandler({
  definition: resetUserPasswordCommand,

  async execute(input: ResetUserPasswordInput, context): Promise<CommandSuccess> {
    const actor = await authoriseAdmin(context, resetUserPasswordCommand.name);
    const passwordHash = await hashPassword(input.password);

    const outcome = await executeCommand({
      database: context.database,
      commandName: resetUserPasswordCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const person = await loadPersonOnInstall(transaction, actor, input.userId);

        await writePassword(transaction, person.userId, passwordHash);
        await endEverySession(transaction, person.userId);

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'user',
          aggregateId: person.userId,
          name: 'identity.passwordReset',
          payload: { displayName: person.displayName },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.userId) : createCommandSuccess();
  },
});

interface ChangePasswordInput {
  commandId: string;
  currentPassword: string;
  newPassword: string;
}

/**
 * Changes your own password, whoever you are.
 *
 * The only command in this module that is not an admin's: everybody signs in
 * with a password an admin typed, so everybody needs a way to make it their
 * own. Every session ends and this one is reissued, so the browser doing the
 * changing stays signed in and nothing else does.
 */
interface UpdateProfileInput {
  commandId: string;
  displayName?: string;
  initials?: string;
  theme?: Theme;
  themeColors?: ThemeColors | null;
}

/**
 * Changes your own name, or the letters drawn in place of it.
 *
 * No permission is asserted, and that is deliberate rather than forgotten. This
 * is about the person asking and nobody else — `actor.userId` is the only row it
 * can reach — so there is nothing here to refuse them, for the reason
 * `identity.me` gives: refusing somebody their own name is not a permission
 * worth having. `every-handler-is-guarded` carries it on the short list of
 * handlers that answer to nobody, where a decision like this has to be argued
 * for out loud.
 *
 * Only what was sent is written. A form that saves one field and a form that
 * saves both are then the same command, and neither can blank the other's field
 * by not knowing about it.
 */
export const updateProfileHandler = defineCommandHandler({
  definition: updateProfileCommand,

  async execute(input: UpdateProfileInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, updateProfileCommand.name);
    const patch: {
      displayName?: string;
      initials?: string;
      theme?: Theme;
      /** The column holds JSON, and null is how somebody goes back to a theme that shipped. */
      themeColors?: string | null;
    } = {};

    if (input.displayName !== undefined) {
      patch.displayName = input.displayName;
    }

    if (input.initials !== undefined) {
      patch.initials = input.initials;
    }

    if (input.theme !== undefined) {
      patch.theme = input.theme;
    }

    if (input.themeColors !== undefined) {
      patch.themeColors = input.themeColors === null ? null : JSON.stringify(input.themeColors);
    }

    const changedFields = Object.keys(patch);

    if (changedFields.length === 0) {
      return createCommandSuccess(actor.userId);
    }

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateProfileCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await transaction.database
          .updateTable('appUser')
          .set(patch)
          .where('id', '=', actor.userId)
          .execute();

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'user',
          aggregateId: actor.userId,
          name: 'identity.profileChanged',
          // The names of what moved, not the values: the trail is read more
          // widely than the person it is about.
          payload: { changedFields },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(actor.userId) : createCommandSuccess();
  },
});

export const changePasswordHandler = defineCommandHandler({
  definition: changePasswordCommand,

  async execute(input: ChangePasswordInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, changePasswordCommand.name);
    const current = await context.database
      .selectFrom('appUser')
      .select(['id', 'passwordHash'])
      .where('id', '=', actor.userId)
      .executeTakeFirst();

    if (
      current === undefined ||
      !(await isPasswordCorrect(input.currentPassword, current.passwordHash))
    ) {
      throw new InvalidCredentialsError();
    }

    const passwordHash = await hashPassword(input.newPassword);

    const outcome = await executeCommand({
      database: context.database,
      commandName: changePasswordCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await writePassword(transaction, actor.userId, passwordHash);
        await endEverySession(transaction, actor.userId);

        const session = await issueSession(transaction.database, actor.userId, context.origin);

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'user',
          aggregateId: actor.userId,
          name: 'identity.passwordChanged',
          payload: {},
        });

        return { sessionToken: session.token };
      },
    });

    if (outcome.applied) {
      context.sessionCookie.issue(outcome.result.sessionToken);
    }

    return createCommandSuccess(actor.userId);
  },
});

/** A person on this install, as every command here needs them. */
interface PersonOnInstall {
  readonly userId: string;
  readonly displayName: string;
  readonly role: MembershipRoleName;
  readonly status: string;
}

/**
 * Loads somebody the admin may change.
 *
 * Through the membership rather than by id alone: a user id from another
 * account is indistinguishable from one that does not exist, which is what
 * stops this install being used to confirm who has an account on another.
 */
async function loadPersonOnInstall(
  transaction: CommandTransaction,
  actor: RequestActor,
  userId: string,
): Promise<PersonOnInstall> {
  const person = await transaction.database
    .selectFrom('membership')
    .innerJoin('appUser', 'appUser.id', 'membership.userId')
    .select([
      'appUser.id as userId',
      'appUser.displayName as displayName',
      'appUser.status as status',
      'membership.role as role',
    ])
    .where('membership.userId', '=', userId)
    .where('membership.accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (person === undefined) {
    throw new UserNotFoundError();
  }

  return person;
}

/** Admins who can still sign in, which is what the install cannot run out of. */
async function countActiveAdmins(
  transaction: CommandTransaction,
  actor: RequestActor,
): Promise<number> {
  const result = await transaction.database
    .selectFrom('membership')
    .innerJoin('appUser', 'appUser.id', 'membership.userId')
    .select(({ fn }) => fn.countAll().as('total'))
    .where('membership.accountId', '=', actor.accountId)
    .where('membership.role', '=', ADMIN_ROLE)
    .where('appUser.status', '=', 'active')
    .executeTakeFirstOrThrow();

  return Number(result.total);
}

async function writePassword(
  transaction: CommandTransaction,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await transaction.database
    .updateTable('appUser')
    .set({ passwordHash })
    .where('id', '=', userId)
    .execute();
}

async function endEverySession(transaction: CommandTransaction, userId: string): Promise<void> {
  await transaction.database.deleteFrom('session').where('userId', '=', userId).execute();
}

/** Every command here but one is an admin's, and they all ask the same question. */
async function authoriseAdmin(context: RequestContext, commandName: string): Promise<RequestActor> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action: 'user.manage' });

  return actor;
}

/**
 * The person setup made is permanent.
 *
 * "An admin remains" keeps somebody in the chair but says nothing about who: a
 * studio could promote a contractor, demote the founder, and the rule would be
 * satisfied the whole way down. This names one account that stays.
 *
 * It refuses the actor themselves too. Locking yourself out is the same
 * outcome whoever asked for it, and an owner who wants to hand the install on
 * is doing something this product does not have a story for yet — better to
 * say no than to let them find out afterwards.
 */
async function assertNotTheInstallOwner(
  transaction: CommandTransaction,
  person: { readonly userId: string; readonly displayName: string },
  consequence: string,
): Promise<void> {
  const install = await transaction.database
    .selectFrom('installSettings')
    .select('ownerUserId')
    .executeTakeFirst();

  // Null on an install restored from a backup older than the step that started
  // recording this. Nobody is named, so nobody is protected, and the rules
  // underneath still apply.
  if (install?.ownerUserId !== person.userId) {
    return;
  }

  throw new InvariantViolatedError(
    `${person.displayName} set this install up and owns it for good. ${consequence}`,
  );
}
