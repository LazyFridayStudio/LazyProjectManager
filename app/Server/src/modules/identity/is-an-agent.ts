import type { Database, DatabaseTransaction } from '@lpm/database';

import { InvariantViolatedError } from '../../domain/index.js';

/**
 * Refuses anything that is not an agent on this install.
 *
 * The guard on every command that does something *to* an agent on somebody
 * else's behalf — giving it a key, choosing its picture. Both are things a
 * person does for themselves and nobody does for a colleague, and both are
 * allowed here only because an agent has no way to do them for itself.
 *
 * Stated once and shared, because the two callers are in different modules and
 * a second copy is a second thing to be wrong about the day a third kind of
 * principal appears.
 */
export async function assertIsAnAgent(
  database: Database | DatabaseTransaction,
  accountId: string,
  userId: string,
): Promise<void> {
  const user = await database
    .selectFrom('appUser')
    .innerJoin('membership', 'membership.userId', 'appUser.id')
    .select('appUser.kind')
    .where('appUser.id', '=', userId)
    .where('membership.accountId', '=', accountId)
    .executeTakeFirst();

  if (user?.kind !== 'agent') {
    throw new InvariantViolatedError('That is not an agent.');
  }
}
