import type { Database, DatabaseTransaction } from '@lpm/database';

import type { RequestActor } from '../../cqrs/request-context.js';
import { TeamNotFoundError, UserNotFoundError } from '../../domain/index.js';

export interface LoadedTeam {
  readonly teamId: string;
  readonly name: string;
  readonly leadUserId: string | null;
}

/**
 * A team the caller may work with.
 *
 * Scoped to their account, so a team id from another install is
 * indistinguishable from one that does not exist.
 */
export async function loadTeam(
  database: Database | DatabaseTransaction,
  actor: RequestActor,
  teamId: string,
): Promise<LoadedTeam> {
  const team = await database
    .selectFrom('team')
    .select(['id as teamId', 'name', 'leadUserId'])
    .where('id', '=', teamId)
    .where('accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (team === undefined) {
    throw new TeamNotFoundError();
  }

  return team;
}

export interface LoadedPerson {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * Somebody on this install, reached through their membership of it.
 *
 * The same rule the people list is written against: a user id from another
 * account does not exist as far as this one is concerned.
 */
export async function loadPersonOnInstall(
  database: Database | DatabaseTransaction,
  actor: RequestActor,
  userId: string,
): Promise<LoadedPerson> {
  const person = await database
    .selectFrom('membership')
    .innerJoin('appUser', 'appUser.id', 'membership.userId')
    .select(['appUser.id as userId', 'appUser.displayName as displayName'])
    .where('membership.userId', '=', userId)
    .where('membership.accountId', '=', actor.accountId)
    .executeTakeFirst();

  if (person === undefined) {
    throw new UserNotFoundError();
  }

  return person;
}
