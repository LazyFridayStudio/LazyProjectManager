import type { FailureCode } from '@lpm/shared';

/**
 * The base class for every rule violation the domain raises.
 *
 * Handlers throw these instead of returning sentinel values, so the happy path
 * in a command handler reads as the feature rather than as a chain of result
 * checks. The API's error hook maps `code` straight onto the wire failure.
 */
export class DomainError extends Error {
  readonly code: FailureCode;
  readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(code: FailureCode, message: string, fields?: Readonly<Record<string, string>>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.fields = fields;
  }
}

/** The actor is authenticated but not permitted to perform this action. */
export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to do that.') {
    super('FORBIDDEN', message);
  }
}

/** A well-formed command that a business rule refused. */
export class InvariantViolatedError extends DomainError {
  constructor(message: string, fields?: Readonly<Record<string, string>>) {
    super('INVARIANT_VIOLATED', message, fields);
  }
}

/** A uniqueness or concurrency conflict, such as a duplicate project code. */
export class ConflictError extends DomainError {
  constructor(message: string, fields?: Readonly<Record<string, string>>) {
    super('CONFLICT', message, fields);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
