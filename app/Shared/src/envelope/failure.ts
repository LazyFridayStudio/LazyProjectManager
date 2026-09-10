import { z } from 'zod';

import { failureCodes, type FailureCode } from './failure-codes.js';

/**
 * The single failure shape shared by every command and every query.
 *
 * `fields` maps a dotted input path to a human-readable reason, so a form can
 * highlight the offending control without the client re-deriving validation.
 */
export const failureSchema = z.object({
  ok: z.literal(false),
  code: z.enum(failureCodes),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});

export type Failure = z.infer<typeof failureSchema>;

export function createFailure(
  code: FailureCode,
  message: string,
  fields?: Readonly<Record<string, string>>,
): Failure {
  return fields === undefined ? { ok: false, code, message } : { ok: false, code, message, fields };
}

export function isFailure(result: { ok: boolean }): result is Failure {
  return !result.ok;
}
