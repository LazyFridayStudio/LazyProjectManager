import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * `Algorithm.Argon2id` from `@node-rs/argon2`.
 *
 * Written as its numeric value because the library declares `Algorithm` as an
 * ambient `const enum`, which `verbatimModuleSyntax` refuses to import. Stating
 * it explicitly rather than relying on the library default keeps a future major
 * version from silently changing which algorithm guards these passwords.
 */
const ARGON2ID: Options['algorithm'] = 2;

/**
 * Argon2id parameters.
 *
 * These are OWASP's current minimums: 19 MiB of memory, two passes, one lane.
 * Memory cost is the part that matters — it is what makes a GPU or ASIC attack
 * expensive, and lowering it to speed up sign-in would quietly undo most of the
 * protection.
 */
const HASH_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * A valid Argon2id hash of a password nobody holds.
 *
 * Verifying against this when an email does not exist makes a failed sign-in
 * take the same time whether or not the account is real. Without it, response
 * time alone tells an attacker which addresses have accounts here.
 */
let decoyHash: string | null = null;

export function hashPassword(plainTextPassword: string): Promise<string> {
  return hash(plainTextPassword, HASH_OPTIONS);
}

export async function isPasswordCorrect(
  plainTextPassword: string,
  expectedHash: string,
): Promise<boolean> {
  try {
    return await verify(expectedHash, plainTextPassword, HASH_OPTIONS);
  } catch {
    // A malformed or truncated stored hash must read as "wrong password", never
    // as a server error that distinguishes this account from any other.
    return false;
  }
}

/**
 * Burns the same work a real password check would, for an account that does not
 * exist. Call it on every sign-in miss.
 */
export async function spendVerificationTime(plainTextPassword: string): Promise<void> {
  decoyHash ??= await hashPassword('lazyprojectmanager-decoy-password');
  await isPasswordCorrect(plainTextPassword, decoyHash);
}
