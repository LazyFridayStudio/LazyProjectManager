import { describe, expect, it } from 'vitest';

import { readEnvironment } from './environment.js';

/** The least an install has to be told before it can start. */
const REQUIRED = {
  BASE_URL: 'http://localhost:24571',
  DATABASE_URL: 'postgres://lpm:lpm@localhost:5432/lpm',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'lpm',
  S3_ACCESS_KEY: 'lpm',
  S3_SECRET_KEY: 'lpm-dev-secret',
};

describe('GIVEN the environment an install is started with', () => {
  describe('WHEN it says only what it has to', () => {
    it('THEN it starts', () => {
      expect(() => readEnvironment(REQUIRED)).not.toThrow();
    });

    it('THEN it does not need a key for a feature it is not using', () => {
      expect(readEnvironment(REQUIRED).APP_SECRET).toBeUndefined();
    });
  });

  describe('WHEN a value is present but empty', () => {
    it('THEN the key reads as unset rather than as a key too short to use', () => {
      // `.env.example` ships `APP_SECRET=` empty, so an operator who copies it
      // unchanged hands the process an empty string. Refusing to boot over a
      // feature they have not asked for is not a helpful reading of that.
      expect(readEnvironment({ ...REQUIRED, APP_SECRET: '' }).APP_SECRET).toBeUndefined();
    });

    it('THEN a key that is set but too short is still refused', () => {
      // Empty means "not using this". Short means "using it badly".
      expect(() => readEnvironment({ ...REQUIRED, APP_SECRET: 'hunter2' })).toThrow(/APP_SECRET/);
    });
  });

  describe('WHEN something it cannot run without is missing', () => {
    it('THEN it stops with a message naming what', () => {
      const { DATABASE_URL: _omitted, ...withoutDatabase } = REQUIRED;

      expect(() => readEnvironment(withoutDatabase)).toThrow(/DATABASE_URL/);
    });

    it('THEN a value of the wrong shape is named too', () => {
      expect(() => readEnvironment({ ...REQUIRED, BASE_URL: 'not a url' })).toThrow(/BASE_URL/);
    });
  });

  describe('WHEN a flag is given as text, which is all an environment has', () => {
    it('THEN it comes back as a boolean', () => {
      expect(readEnvironment({ ...REQUIRED, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
      expect(readEnvironment({ ...REQUIRED, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    });

    it('THEN anything that is not one of the two is refused rather than guessed at', () => {
      expect(() => readEnvironment({ ...REQUIRED, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
    });
  });
});
