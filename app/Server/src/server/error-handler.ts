import { createFailure, type Failure, type FailureCode } from '@lpm/shared';
import { isDomainError } from '../domain/index.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/**
 * The HTTP status each failure code answers with.
 *
 * The wire body always carries the code, so the client switches on that rather
 * than on the status. The status exists for proxies, caches and Cloudflare.
 */
const httpStatusByFailureCode: Readonly<Record<FailureCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  INVARIANT_VIOLATED: 422,
  // A limit that is currently reached, not a malformed request: the same move
  // will succeed once something leaves the list.
  WIP_LIMIT_REACHED: 409,
  SETUP_REQUIRED: 409,
  SETUP_ALREADY_COMPLETED: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export function getHttpStatusForFailure(code: FailureCode): number {
  return httpStatusByFailureCode[code];
}

/**
 * Turns a Zod error into the `fields` map a form can highlight directly.
 */
export function describeValidationFailure(error: ZodError): Failure {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    fields[issue.path.join('.')] = issue.message;
  }

  return createFailure('VALIDATION_FAILED', 'Some fields need attention.', fields);
}

/**
 * Converts anything thrown inside a route into the one wire failure shape.
 *
 * An unrecognised error is reported as INTERNAL_ERROR with a generic message —
 * the real message is logged, never returned, because it can carry connection
 * strings and SQL.
 */
export function registerErrorHandler(server: FastifyInstance): void {
  server.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const failure = toFailure(error);

    if (failure.code === 'INTERNAL_ERROR') {
      request.log.error({ err: error }, 'Unhandled error while serving request');
    }

    void reply.status(getHttpStatusForFailure(failure.code)).send(failure);
  });
}

function toFailure(error: unknown): Failure {
  if (error instanceof ZodError) {
    return describeValidationFailure(error);
  }

  if (isDomainError(error)) {
    return createFailure(error.code, error.message, error.fields);
  }

  if (isRateLimitRefusal(error)) {
    return error;
  }

  return createFailure('INTERNAL_ERROR', 'Something went wrong. The problem has been logged.');
}

/**
 * A refusal the rate limiter built, on its way out through here.
 *
 * The limiter answers by throwing what its `errorResponseBuilder` returned,
 * which is already this server's failure shape — so without this it would be
 * caught below and reported as an internal error, and a caller who asked too
 * often would be told the server was broken.
 */
function isRateLimitRefusal(error: unknown): error is Failure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'ok' in error &&
    error.ok === false &&
    'code' in error &&
    error.code === 'RATE_LIMITED'
  );
}
