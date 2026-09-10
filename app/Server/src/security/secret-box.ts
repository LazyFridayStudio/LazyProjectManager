import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { DomainError } from '../domain/errors/domain-error.js';

/**
 * Encrypts the few secrets this server has to be able to read back.
 *
 * A password is hashed, because nothing ever needs the original. A webhook
 * secret is different: verifying a delivery means computing the same HMAC the
 * sender computed, which needs the secret itself. So it is encrypted, and the
 * key lives in the environment rather than in the database — which is the whole
 * point, because a dump of the database is then not a dump of the secrets.
 *
 * AES-256-GCM: it authenticates as well as encrypts, so a ciphertext somebody
 * has edited fails to open rather than opening as something else.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Versioned so the format can change later without guessing at old rows. */
const FORMAT = 'v1';

const SEPARATOR = '.';

/**
 * A domain error rather than a plain one, so the sentence reaches the screen.
 *
 * This is the most fixable failure in the product — an operator who has not put
 * `APP_SECRET` in their environment yet — and it used to arrive as an
 * unhandled five hundred reading "something went wrong, the problem has been
 * logged". The problem *had* been logged, in a container log, along with the
 * exact command to run. Whoever pressed the button saw none of it.
 */
export class MissingSecretKeyError extends DomainError {
  constructor() {
    super(
      'INVARIANT_VIOLATED',
      'APP_SECRET is not set, so there is nowhere safe to keep a webhook secret. ' +
        'Generate one with `openssl rand -base64 32` and put it in the environment.',
    );
    this.name = 'MissingSecretKeyError';
  }
}

/**
 * Also a domain error, for the same reason: the usual cause is an `APP_SECRET`
 * that changed, and the person who changed it is the person reading this.
 */
export class UnreadableSecretError extends DomainError {
  constructor() {
    // Deliberately says nothing about which part failed. The difference between
    // "wrong key" and "tampered ciphertext" is only useful to somebody trying
    // both.
    super(
      'INVARIANT_VIOLATED',
      'That secret could not be read with the key this server is running with.',
    );
    this.name = 'UnreadableSecretError';
  }
}

/**
 * Turns whatever is in `APP_SECRET` into a 32-byte key.
 *
 * Hashed rather than required to be exactly 32 bytes, so an operator can put a
 * passphrase there and it still works. It is not a password — there is nothing
 * to brute-force offline without the database — so a plain SHA-256 is the right
 * shape rather than a slow KDF.
 */
function deriveKey(appSecret: string): Buffer {
  return createHash('sha256').update(appSecret, 'utf8').digest().subarray(0, KEY_BYTES);
}

export function encryptSecret(plaintext: string, appSecret: string | undefined): string {
  if (appSecret === undefined || appSecret === '') {
    throw new MissingSecretKeyError();
  }

  const nonce = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(appSecret), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [FORMAT, nonce, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join(SEPARATOR);
}

export function decryptSecret(stored: string, appSecret: string | undefined): string {
  if (appSecret === undefined || appSecret === '') {
    throw new MissingSecretKeyError();
  }

  const [format, encodedNonce, tag, ciphertext] = stored.split(SEPARATOR);

  if (
    format !== FORMAT ||
    encodedNonce === undefined ||
    tag === undefined ||
    ciphertext === undefined
  ) {
    throw new UnreadableSecretError();
  }

  const authTag = Buffer.from(tag, 'base64url');
  const nonce = Buffer.from(encodedNonce, 'base64url');

  if (authTag.length !== TAG_BYTES || nonce.length !== IV_BYTES) {
    throw new UnreadableSecretError();
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(appSecret), nonce);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // `final()` throws when the tag does not match, which is exactly the case
    // this is here to turn into a readable failure.
    throw new UnreadableSecretError();
  }
}
