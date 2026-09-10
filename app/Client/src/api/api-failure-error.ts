import type { Failure, FailureCode } from '@lpm/shared';

/**
 * A failure the server reported, raised as an exception.
 *
 * Returning a result object would force every call site to unwrap before it can
 * do anything, which buries the happy path. Throwing keeps a component's success
 * path readable and lets one error boundary handle the rest.
 */
export class ApiFailureError extends Error {
  readonly code: FailureCode;
  readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(failure: Failure) {
    super(failure.message);
    this.name = 'ApiFailureError';
    this.code = failure.code;
    this.fields = failure.fields;
  }
}

/** Raised when the server answered, but not with something this client understands. */
export class ApiContractError extends Error {
  constructor(operationName: string, detail: string) {
    super(`The server's response to "${operationName}" did not match the contract: ${detail}`);
    this.name = 'ApiContractError';
  }
}

/** Raised when the server could not be reached at all. */
export class ApiUnreachableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(`Could not reach a LazyProjectManager server at ${baseUrl}.`);
    this.name = 'ApiUnreachableError';
    this.cause = cause;
  }
}

/**
 * Raised when the bytes of a file did not get where they were going.
 *
 * Its own error because "could not reach the server" is wrong about what
 * happened and sends somebody to check their connection. The server answered a
 * moment earlier to say where to put the file; what failed is this one request,
 * and the message says which file and what came back.
 */
export class UploadFailedError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'UploadFailedError';
    this.cause = cause;
  }
}
