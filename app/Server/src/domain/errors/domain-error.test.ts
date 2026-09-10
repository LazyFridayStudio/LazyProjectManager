import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  DomainError,
  ForbiddenError,
  InvariantViolatedError,
  isDomainError,
} from './domain-error.js';
import {
  AccountSuspendedError,
  InvalidCredentialsError,
  SetupAlreadyCompletedError,
  SetupRequiredError,
} from '../identity/identity-errors.js';

describe('GIVEN a domain error', () => {
  describe('WHEN one is raised', () => {
    it('THEN it carries the wire failure code the API will answer with', () => {
      expect(new ForbiddenError().code).toBe('FORBIDDEN');
      expect(new ConflictError('Taken.').code).toBe('CONFLICT');
      expect(new InvariantViolatedError('No.').code).toBe('INVARIANT_VIOLATED');
    });

    it('THEN its name is the subclass, so a log says which rule refused', () => {
      expect(new ForbiddenError().name).toBe('ForbiddenError');
      expect(new ConflictError('Taken.').name).toBe('ConflictError');
    });

    it('THEN it is a real Error, so a stack trace survives', () => {
      expect(new ForbiddenError()).toBeInstanceOf(Error);
    });
  });

  describe('WHEN field detail is supplied', () => {
    it('THEN it is carried through for the form to highlight', () => {
      const error = new ConflictError('That code is taken.', { code: 'Already used.' });

      expect(error.fields).toEqual({ code: 'Already used.' });
    });
  });

  describe('WHEN no field detail is supplied', () => {
    it('THEN fields is undefined rather than an empty object', () => {
      expect(new InvariantViolatedError('No.').fields).toBeUndefined();
    });
  });

  describe('WHEN an unknown value is checked', () => {
    it('THEN only domain errors are recognised', () => {
      expect(isDomainError(new ForbiddenError())).toBe(true);
      expect(isDomainError(new DomainError('NOT_FOUND', 'Gone.'))).toBe(true);
      expect(isDomainError(new Error('plain'))).toBe(false);
      expect(isDomainError(null)).toBe(false);
      expect(isDomainError('FORBIDDEN')).toBe(false);
    });
  });

  describe('WHEN a default message is relied on', () => {
    it('THEN ForbiddenError still says something useful', () => {
      expect(new ForbiddenError().message).toMatch(/permission/i);
    });
  });
});

describe('GIVEN the identity errors', () => {
  describe('WHEN credentials do not match', () => {
    it('THEN the message names neither the email nor the password', () => {
      const error = new InvalidCredentialsError();

      // Saying which half was wrong would let anyone enumerate the accounts on
      // this install.
      expect(error.code).toBe('UNAUTHENTICATED');
      expect(error.message).toBe('That email or password is not right.');
    });
  });

  describe('WHEN setup state is wrong for the request', () => {
    it('THEN the two directions are distinguishable', () => {
      expect(new SetupAlreadyCompletedError().code).toBe('SETUP_ALREADY_COMPLETED');
      expect(new SetupRequiredError().code).toBe('SETUP_REQUIRED');
    });
  });

  describe('WHEN the account is suspended', () => {
    it('THEN it is forbidden rather than unauthenticated', () => {
      // The credentials were right; the account is not allowed. Reporting
      // UNAUTHENTICATED would send the user round the sign-in loop forever.
      expect(new AccountSuspendedError().code).toBe('FORBIDDEN');
    });
  });
});
