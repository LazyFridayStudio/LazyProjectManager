import { InvariantViolatedError } from '../errors/domain-error.js';

/** What a change is about to do to the set of people who can administer the install. */
export interface AdminCover {
  /** Owners who can still sign in, counted before the change. */
  readonly activeAdminCount: number;
  /** Whether the person being changed is one of them. */
  readonly subjectIsActiveAdmin: boolean;
}

/**
 * Refuses a change that would leave nobody able to administer the install.
 *
 * A self-hosted box has no support desk and no password-reset email. An install
 * with no admin is one nobody can add a person to, reset a password on, or hand
 * over — the only way back in is the database, and that should not be one click
 * away.
 *
 * Counted rather than compared against the actor, because the change that does
 * this is usually not somebody demoting themselves: it is the last admin being
 * suspended by the second-to-last one on their way out.
 */
export function assertAnAdminRemains(cover: AdminCover): void {
  if (cover.subjectIsActiveAdmin && cover.activeAdminCount <= 1) {
    throw new InvariantViolatedError(
      'This is the only admin left. Make somebody else an admin first.',
    );
  }
}
