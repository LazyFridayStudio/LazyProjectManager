import { afterEach, describe, expect, it } from 'vitest';

import { createCommandId, uuidFromBytes } from './command-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Puts `crypto.randomUUID` back, whatever a test did to it. */
const restore = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');

/**
 * A browser on a plain-HTTP address that is not localhost.
 *
 * `crypto.randomUUID` is available only in a secure context, so on
 * `http://192.168.1.10:24571` it is not there at all. This is that browser.
 */
function withoutRandomUuid(): void {
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
}

describe('GIVEN the identifier a command is sent with', () => {
  afterEach(() => {
    if (restore !== undefined) {
      Object.defineProperty(crypto, 'randomUUID', restore);
    }
  });

  describe('WHEN the page is in a secure context', () => {
    it('THEN it is a version 4 UUID', () => {
      expect(createCommandId()).toMatch(UUID);
    });
  });

  describe('WHEN the page is served over plain HTTP from a LAN address', () => {
    it('THEN it still makes one, rather than throwing before the request', () => {
      // This is the whole bug: `crypto.randomUUID` is not there, the call threw
      // inside the API client, and every command failed with nothing in the
      // network tab and "could not reach the server" on screen.
      withoutRandomUuid();

      expect(createCommandId()).toMatch(UUID);
    });

    it('THEN two of them differ, so a retry is not mistaken for the first try', () => {
      withoutRandomUuid();

      expect(createCommandId()).not.toBe(createCommandId());
    });
  });
});

describe('GIVEN sixteen random bytes', () => {
  describe('WHEN they are written out as a UUID', () => {
    it('THEN it is grouped the way a UUID is written', () => {
      expect(uuidFromBytes(new Uint8Array(16))).toMatch(UUID);
    });

    it('THEN it says it is version 4, whatever the bytes were', () => {
      // A string that skipped these would look like a UUID and be refused by
      // anything that checks one — which the command envelope does.
      const allOnes = uuidFromBytes(new Uint8Array(16).fill(0xff));

      expect(allOnes[14]).toBe('4');
      expect(['8', '9', 'a', 'b']).toContain(allOnes[19]);
    });

    it('THEN it keeps the randomness it was given', () => {
      const bytes = new Uint8Array(16).fill(0xab);

      expect(uuidFromBytes(bytes)).toContain('abab');
    });

    it('THEN it does not write on the bytes it was handed', () => {
      const bytes = new Uint8Array(16).fill(0xff);

      uuidFromBytes(bytes);

      expect(bytes[6]).toBe(0xff);
    });
  });
});
