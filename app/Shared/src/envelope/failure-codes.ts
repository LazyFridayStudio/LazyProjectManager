/**
 * Every way a command or query is allowed to fail.
 *
 * The list is closed on purpose. A handler that needs a new failure mode adds it
 * here first, which makes the client's exhaustive switch fail to compile until
 * the new case is handled. Inventing a code string at the call site is how error
 * handling silently rots.
 */
export const failureCodes = [
  /** No session cookie, or the session has expired. */
  'UNAUTHENTICATED',
  /** Authenticated, but `can(actor, action, resource)` said no. */
  'FORBIDDEN',
  /** The addressed resource does not exist, or the actor may not know it exists. */
  'NOT_FOUND',
  /** Input failed its Zod schema. `fields` names the offending paths. */
  'VALIDATION_FAILED',
  /** A uniqueness or concurrency invariant was violated. */
  'CONFLICT',
  /** A domain invariant rejected an otherwise well-formed command. */
  'INVARIANT_VIOLATED',
  /** The list a card was moved into is already at its work-in-progress limit. */
  'WIP_LIMIT_REACHED',
  /** The install has not completed its first-run setup wizard yet. */
  'SETUP_REQUIRED',
  /** The install has already been set up; setup cannot run twice. */
  'SETUP_ALREADY_COMPLETED',
  /** Too many attempts from this actor or address. */
  'RATE_LIMITED',
  /** An unexpected server fault. The message is never shown to the user verbatim. */
  'INTERNAL_ERROR',
] as const;

export type FailureCode = (typeof failureCodes)[number];

const failureCodeLookup = new Set<string>(failureCodes);

export function isFailureCode(candidate: string): candidate is FailureCode {
  return failureCodeLookup.has(candidate);
}
