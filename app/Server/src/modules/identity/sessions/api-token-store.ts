import { createHash, randomBytes } from 'node:crypto';

import type { Database, DatabaseTransaction } from '@lpm/database';
import type { FastifyRequest } from 'fastify';

import type { RequestActor } from '../../../cqrs/request-context.js';
import { RULES_REACHING_THIS_PERSON, readRules } from './session-store.js';

const TOKEN_BYTES = 32;

/**
 * What every key starts with.
 *
 * So that one pasted into a chat, a log or a commit is recognisable as a
 * credential at a glance — by a person reading it, and by the secret scanners
 * that look for exactly this shape.
 */
export const API_TOKEN_PREFIX = 'lpm_';

/**
 * Hashes a key for storage.
 *
 * Plain SHA-256 and no salt, for the reason the session token gives: this is
 * 256 bits of randomness, so there is no dictionary to attack, and a slow hash
 * would only tax every request that presents one.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Makes a key, and returns the secret to show once.
 *
 * The only moment it exists in readable form. Nothing stores it and no query
 * can return it, which is what makes losing one merely annoying — the answer is
 * to revoke it and make another.
 */
export async function issueApiToken(
  transaction: DatabaseTransaction,
  userId: string,
  name: string,
): Promise<{ id: string; token: string }> {
  const token = `${API_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;

  const row = await transaction
    .insertInto('apiToken')
    .values({ userId, name, tokenHash: hashToken(token) })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { id: row.id, token };
}

/**
 * Resolves a key to the actor it belongs to, or null.
 *
 * The same rules a session resolves, read the same way — an agent's permissions
 * are permissions, and nothing downstream should be able to tell how the actor
 * arrived. That is the property worth protecting: every one of the two hundred
 * places that asks whether something is permitted keeps working for an agent
 * without knowing agents exist.
 *
 * A revoked key is not found. A suspended user's key is not found either, which
 * is what makes suspending an agent a way to stop it.
 */
export async function findActorForApiToken(
  database: Database,
  token: string,
): Promise<RequestActor | null> {
  const found = await database
    .selectFrom('apiToken')
    .innerJoin('appUser', 'appUser.id', 'apiToken.userId')
    .innerJoin('membership', 'membership.userId', 'appUser.id')
    .select([
      'appUser.id as userId',
      'membership.accountId',
      'appUser.status',
      'apiToken.id as tokenId',
    ])
    .select(RULES_REACHING_THIS_PERSON.as('rules'))
    .where('apiToken.tokenHash', '=', hashToken(token))
    .where('apiToken.revokedAt', 'is', null)
    .executeTakeFirst();

  if (found?.status !== 'active') {
    return null;
  }

  /*
   * Written without waiting, and a failure is swallowed.
   *
   * "When was this last used" is worth knowing and worth nothing: it decides
   * whether somebody revokes a key they have forgotten about. Making every
   * request wait on that write, or fail because of it, would be paying for it
   * at the wrong rate.
   */
  void database
    .updateTable('apiToken')
    .set({ lastUsedAt: new Date() })
    .where('id', '=', found.tokenId)
    .execute()
    .catch(() => undefined);

  return {
    userId: found.userId,
    accountId: found.accountId,
    rules: readRules(found.rules),
  };
}

/**
 * The key presented on this request, if there is one.
 *
 * `Authorization: Bearer lpm_…`, which is what every client that is not a
 * browser already knows how to send. A cookie would be the wrong shape: there
 * is no browser here to keep one, and `sameSite` means nothing to a program.
 */
export function readApiToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;

  if (header?.startsWith('Bearer ') !== true) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();

  return token === '' ? null : token;
}
