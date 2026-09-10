import type { FailureCode } from '@lpm/shared';

import { ApiFailureError, UploadFailedError } from './api-failure-error.js';

/**
 * The failures that are the product saying no rather than something going
 * wrong.
 *
 * A work-in-progress limit refusing a card is the limit doing the one job it
 * has. Painting that the same red as a server fault says the software broke,
 * when what happened is that it worked.
 */
const REFUSALS = new Set<FailureCode>(['WIP_LIMIT_REACHED']);

/**
 * Whether a failure is a rule being enforced rather than a fault.
 *
 * What it decides is the colour of the message: a refusal is a warning, and
 * everything else is an error.
 */
export function isRefusal(error: Error): boolean {
  return error instanceof ApiFailureError && REFUSALS.has(error.code);
}

/**
 * Whether a request failed because this person may not make it.
 *
 * Not the same question as `isRefusal`, which is about the colour of a message.
 * This one decides whether a screen can carry on without the answer: a panel
 * somebody is not permitted to see is a panel that can say so while the rest of
 * the screen works, and a server that could not be reached is not.
 *
 * The server's refusals name what was refused — `Not permitted to
 * milestone.view.` — so the message this stands in front of is already written
 * for a reader.
 */
export function isNotPermitted(error: Error): boolean {
  return error instanceof ApiFailureError && error.code === 'FORBIDDEN';
}

/**
 * Field-level messages the server sent back, keyed by the dotted input path, so
 * each one can be shown against the control it belongs to.
 *
 * Anything that is not a reported failure — an unreachable server, a contract
 * mismatch — has no fields, and the form shows one message instead.
 */
export function readFieldProblems(error: Error | null): Readonly<Record<string, string>> {
  if (error instanceof ApiFailureError && error.fields !== undefined) {
    return error.fields;
  }

  return {};
}

/**
 * What to tell a person about a failed request.
 *
 * A failure the server reported is already written for a reader. So is a failed
 * upload, which says which file and why — those two are the messages worth
 * showing. Anything else carries a sentence about fetch or JSON that would only
 * confuse, so it is replaced with the thing they can act on.
 *
 * The upload case is here because it was not: every failure that was not an
 * `ApiFailureError` became "could not reach the server", so a file that failed
 * to upload was indistinguishable from an API that was down — and that is
 * precisely the wrong place to send somebody looking, since the API had just
 * answered.
 */
export function describeFailure(error: Error): string {
  if (error instanceof ApiFailureError || error instanceof UploadFailedError) {
    return error.message;
  }

  return 'Could not reach the server. Check your connection and try again.';
}
