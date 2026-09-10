import { DomainError } from '../errors/domain-error.js';

/**
 * Wrong email, wrong password, or no such account.
 *
 * Deliberately one error for all three. Distinguishing them would let anyone
 * enumerate which email addresses have accounts on this install.
 */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('UNAUTHENTICATED', 'That email or password is not right.');
  }
}

/** The first-run wizard has already been completed and cannot run again. */
export class SetupAlreadyCompletedError extends DomainError {
  constructor() {
    super('SETUP_ALREADY_COMPLETED', 'This server has already been set up. Sign in instead.');
  }
}

/** A request needs an install that has finished its first-run wizard. */
export class SetupRequiredError extends DomainError {
  constructor() {
    super('SETUP_REQUIRED', 'This server has not been set up yet.');
  }
}

/** The account exists but has been suspended. */
export class AccountSuspendedError extends DomainError {
  constructor() {
    super('FORBIDDEN', 'That account has been suspended.');
  }
}

/** No such person on this install, or none the caller may know about. */
export class UserNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'There is nobody here with that account.');
  }
}

/**
 * Somebody already signs in with that address.
 *
 * Named on the field rather than in the corner, because the admin is looking at
 * the box they typed it into — and because it is the one thing about a new
 * person that has to be unique.
 */
export class EmailAlreadyTakenError extends DomainError {
  constructor() {
    super('CONFLICT', 'Somebody already signs in with that email address.', {
      email: 'That address is already in use.',
    });
  }
}

/** No such team on this install, or none the caller may know about. */
export class TeamNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'There is no team here by that name.');
  }
}

export class PermissionGroupNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That permission group does not exist.');
  }
}
