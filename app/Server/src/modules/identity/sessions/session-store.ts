import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { sql, type Database, type DatabaseTransaction } from '@lpm/database';
import { calculateSessionExpiry } from '../../../domain/index.js';

import type { PermissionRule } from '../../../domain/index.js';
import type { RequestActor } from '../../../cqrs/request-context.js';

const SESSION_TOKEN_BYTES = 32;

export interface IssuedSession {
  /** Sent to the browser. Never stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface SessionOrigin {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

/**
 * Hashes a session token for storage.
 *
 * Plain SHA-256 with no salt or stretching, deliberately: the token is 256 bits
 * of cryptographic randomness, so there is no dictionary to attack and a slow
 * hash would only tax every authenticated request. The hash exists so a stolen
 * database dump does not hand over live sessions.
 */
function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a session row and returns the token to send to the browser.
 *
 * Takes the transaction rather than the pool so the session is created in the
 * same unit of work as the sign-in that caused it.
 */
export async function issueSession(
  transaction: DatabaseTransaction,
  userId: string,
  origin: SessionOrigin,
): Promise<IssuedSession> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const expiresAt = calculateSessionExpiry(new Date());

  await transaction
    .insertInto('session')
    .values({
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
      userAgent: origin.userAgent,
      ipAddress: origin.ipAddress,
    })
    .execute();

  return { token, expiresAt };
}

/**
 * Resolves a session token to the actor it belongs to, or null.
 *
 * The expiry is checked in SQL rather than in JavaScript so a clock skew between
 * the API process and Postgres cannot extend a session past its end.
 */
export async function findActorForSessionToken(
  database: Database,
  token: string,
): Promise<RequestActor | null> {
  const session = await database
    .selectFrom('session')
    .innerJoin('appUser', 'appUser.id', 'session.userId')
    .innerJoin('membership', 'membership.userId', 'appUser.id')
    .select(['appUser.id as userId', 'membership.accountId', 'appUser.status'])
    .select(RULES_REACHING_THIS_PERSON.as('rules'))
    .where('session.tokenHash', '=', hashSessionToken(token))
    .where('session.expiresAt', '>', new Date())
    .executeTakeFirst();

  if (session?.status !== 'active') {
    return null;
  }

  return {
    userId: session.userId,
    accountId: session.accountId,
    rules: readRules(session.rules),
  };
}

/**
 * Every permission rule reaching this person, through a team or directly.
 *
 * Two ways in, one list out. A group held by a team reaches everybody in it; a
 * group held by a person reaches only them. Neither outranks the other, and
 * they do not need to: `decide` takes the rules as one set and lets `deny` win
 * wherever any of them disagree, so the route a rule arrived by never has to be
 * ranked against another route.
 *
 * Each rule carries where it came from, because the two are not equal: a group
 * given to a person by name outranks one their team holds, and `decide` cannot
 * tell them apart once they are in a list together.
 *
 * `union` rather than `union all`, so one route contributing a rule twice — two
 * teams holding the same group — carries it once. The source is part of what is
 * unioned, so a rule arriving both ways survives as both, which is exactly the
 * case the ranking exists for.
 *
 * On the session's own statement rather than a second round trip. Resolving a
 * session happens on every request in the product, and `board.test.ts` counts
 * the statements a board read takes precisely so that a second one cannot be
 * added here without somebody noticing.
 *
 * Snake case throughout: `CamelCasePlugin` does not reach inside a raw `sql`
 * fragment.
 */
export const RULES_REACHING_THIS_PERSON = sql<RuleRow[] | null>`(
  select json_agg(json_build_object(
    'action', reaching.action, 'effect', reaching.effect, 'source', reaching.source
  ))
  from (
    select rule.action, rule.effect, 'team' as source
    from team_member as member
    join team_permission_group as held on held.team_id = member.team_id
    join permission_rule as rule on rule.group_id = held.group_id
    where member.user_id = app_user.id

    union

    select rule.action, rule.effect, 'person' as source
    from user_permission_group as held
    join permission_rule as rule on rule.group_id = held.group_id
    where held.user_id = app_user.id
  ) as reaching
)`;

interface RuleRow {
  action: string;
  effect: string;
  source: string;
}

/**
 * The rules as the policy takes them.
 *
 * `json_agg` over nothing is null, and somebody in no team has no rules rather
 * than a missing list. An effect this build does not recognise is dropped
 * rather than guessed at: the safe way to read a permission is to ignore what
 * you do not understand.
 */
export function readRules(rows: RuleRow[] | null): readonly PermissionRule[] {
  return (rows ?? []).flatMap((row) =>
    row.effect === 'allow' || row.effect === 'deny'
      ? [
          {
            action: row.action,
            effect: row.effect,
            // Anything this build does not recognise is read as a team's, which
            // is the weaker of the two: an unknown source should not be a way to
            // outrank a team.
            source: row.source === 'person' ? ('person' as const) : ('team' as const),
          },
        ]
      : [],
  );
}

export async function revokeSession(database: Database, token: string): Promise<void> {
  await database.deleteFrom('session').where('tokenHash', '=', hashSessionToken(token)).execute();
}

/**
 * Constant-time comparison for session tokens.
 *
 * Exported for the tests that assert token handling never short-circuits on the
 * first differing byte.
 */
export function tokensMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
