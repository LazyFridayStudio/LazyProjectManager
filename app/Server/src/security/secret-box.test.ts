import { describe, expect, it } from 'vitest';

import { isDomainError } from '../domain/errors/domain-error.js';

import {
  decryptSecret,
  encryptSecret,
  MissingSecretKeyError,
  UnreadableSecretError,
} from './secret-box.js';

const KEY = 'a key this server was started with';
const SECRET = 'wh_2f8c1a44d0e34b1fa9c7e5b06d1a83f4';

describe('GIVEN a secret the server has to be able to read back', () => {
  describe('WHEN it is put away and fetched out again', () => {
    it('THEN it comes back exactly as it went in', () => {
      expect(decryptSecret(encryptSecret(SECRET, KEY), KEY)).toBe(SECRET);
    });

    it('THEN what is stored is not the secret', () => {
      expect(encryptSecret(SECRET, KEY)).not.toContain(SECRET);
    });

    it('THEN encrypting the same secret twice gives two different rows', () => {
      // A fresh nonce every time, so two projects using the same secret are not
      // visibly using the same secret.
      expect(encryptSecret(SECRET, KEY)).not.toBe(encryptSecret(SECRET, KEY));
    });

    it('THEN text that is not plain ASCII survives the trip', () => {
      const awkward = 'Ötzi — 🔑 — “quoted”';

      expect(decryptSecret(encryptSecret(awkward, KEY), KEY)).toBe(awkward);
    });
  });

  describe('WHEN the key is wrong', () => {
    it('THEN it refuses rather than returning rubbish', () => {
      const stored = encryptSecret(SECRET, KEY);

      expect(() => decryptSecret(stored, 'some other key')).toThrow(UnreadableSecretError);
    });
  });

  describe('WHEN the stored value has been edited', () => {
    it('THEN the tampering is caught rather than decrypted', () => {
      const [format, nonce, tag, ciphertext] = encryptSecret(SECRET, KEY).split('.');
      const flipped = `${ciphertext?.slice(0, -2) ?? ''}AA`;

      expect(() =>
        decryptSecret(`${format ?? ''}.${nonce ?? ''}.${tag ?? ''}.${flipped}`, KEY),
      ).toThrow(UnreadableSecretError);
    });

    it('THEN a value in no recognisable shape is refused', () => {
      for (const nonsense of ['', 'v1', 'v1.a.b', 'v2.a.b.c', SECRET]) {
        expect(() => decryptSecret(nonsense, KEY)).toThrow(UnreadableSecretError);
      }
    });
  });

  describe('WHEN the server has no key at all', () => {
    it('THEN it says so rather than storing the secret in the clear', () => {
      expect(() => encryptSecret(SECRET, undefined)).toThrow(MissingSecretKeyError);
      expect(() => encryptSecret(SECRET, '')).toThrow(MissingSecretKeyError);
      expect(() => decryptSecret('v1.a.b.c', undefined)).toThrow(MissingSecretKeyError);
    });

    it('THEN it is a refusal the screen can show, not an unhandled fault', () => {
      // It arrived as a five hundred reading "something went wrong, the problem
      // has been logged" — and the problem *had* been logged, in a container
      // log, along with the exact command to fix it. Whoever pressed the button
      // saw none of that.
      const refusal = new MissingSecretKeyError();

      expect(isDomainError(refusal)).toBe(true);
      expect(refusal.code).toBe('INVARIANT_VIOLATED');
      expect(refusal.message).toContain('openssl rand -base64 32');
    });
  });

  describe('WHEN the key is not the one a secret was written with', () => {
    it('THEN that is a refusal too, because the operator changed it', () => {
      const refusal = new UnreadableSecretError();

      expect(isDomainError(refusal)).toBe(true);
      expect(refusal.code).toBe('INVARIANT_VIOLATED');
    });
  });
});
