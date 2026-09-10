import type { Database } from '../index.js';

export interface SeededInstall {
  readonly accountId: string;
  readonly accountName: string;
  readonly userId: string;
  readonly email: string;
}

export interface SeedInstallOptions {
  readonly accountName?: string;
  readonly email?: string;
  readonly displayName?: string;
  /**
   * A pre-computed Argon2id hash. Hashing lives in `apps/api`, so a test that
   * needs a password to actually verify computes the hash there and passes it
   * in; everything else takes the placeholder, which no password matches.
   */
  readonly passwordHash?: string;
  readonly status?: 'active' | 'invited' | 'suspended';
  readonly setupCompleted?: boolean;
}

/** Matches no password. Tests that verify a password supply a real hash. */
const UNMATCHABLE_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNlZWRzZWVk$notarealhash';

/**
 * Puts a database into the state a completed first-run wizard leaves behind:
 * one account, one owner, and the install settings row.
 *
 * Most tests care about what happens *after* setup, and driving the real
 * `identity.completeSetup` command to reach that state would couple every one of
 * them to the setup handler.
 */
export async function seedInstall(
  database: Database,
  options: SeedInstallOptions = {},
): Promise<SeededInstall> {
  const accountName = options.accountName ?? 'Northwind Studio';
  const email = options.email ?? 'owner@northwind.test';

  const account = await database
    .insertInto('account')
    .values({ name: accountName, slug: 'northwind-studio' })
    .returning('id')
    .executeTakeFirstOrThrow();

  const user = await database
    .insertInto('appUser')
    .values({
      email,
      passwordHash: options.passwordHash ?? UNMATCHABLE_PASSWORD_HASH,
      displayName: options.displayName ?? 'Owner Person',
      initials: 'OP',
      status: options.status ?? 'active',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await database
    .insertInto('membership')
    .values({ accountId: account.id, userId: user.id, role: 'owner' })
    .execute();

  await database
    .insertInto('installSettings')
    .values({
      serverName: accountName,
      baseUrl: 'http://localhost:24571',
      setupCompletedAt: (options.setupCompleted ?? true) ? new Date() : null,
      // As `identity.completeSetup` does. A seeded install where nobody is the
      // owner is not the install a test means to be describing, and the rules
      // that protect that person would go untested against it.
      ownerUserId: user.id,
    })
    .execute();

  return { accountId: account.id, accountName, userId: user.id, email };
}

/** The `{ userId, accountId }` pair a request context carries for a signed-in user. */
export function createTestActor(install: SeededInstall): {
  userId: string;
  accountId: string;
} {
  return { userId: install.userId, accountId: install.accountId };
}
