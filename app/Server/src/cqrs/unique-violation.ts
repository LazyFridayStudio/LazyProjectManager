/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether an error is Postgres refusing a duplicate on one named constraint.
 *
 * The constraint name is part of the question on purpose. A handler that catches
 * the code alone will one day swallow a different uniqueness failure and report
 * the wrong thing to the user.
 */
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return candidate.code === UNIQUE_VIOLATION && candidate.constraint === constraintName;
}
