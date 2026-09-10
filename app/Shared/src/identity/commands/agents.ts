import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { displayNameSchema } from './complete-setup.js';
import { initialsSchema } from './manage-users.js';

/** What a key is for, so a list of them is a list somebody can act on. */
export const tokenNameSchema = z.string().trim().min(1).max(80);

/**
 * Makes an agent.
 *
 * An agent is a user with no password. It cannot sign in — there is nothing to
 * sign in with — and reaches the install by presenting a key instead. Otherwise
 * it is somebody: it holds permission groups, it goes on projects and teams, it
 * can be a card's assignee, and every line it writes in the audit trail carries
 * its own name.
 *
 * That last part is the whole point of it being a principal rather than a
 * borrowed session. A studio should be able to look at the trail afterwards and
 * see which of these a person did and which the agent did, and turn one off
 * without turning the other off with it.
 *
 * **Nothing chooses what it may do here.** It is made able to read and nothing
 * else, and everything beyond that comes from the permission groups it is
 * given afterwards — which is how what anybody may do is decided in this
 * product. A picker offering "lead" or "member" would be a second way of
 * answering a question permissions already answer, and the two would disagree
 * the first time somebody used one and not the other.
 *
 * Read-only to start with is the safe end. Something that can do everything the
 * moment it exists is a thing somebody has to remember to narrow.
 */
export const createAgentCommand = defineCommand(
  'identity.createAgent',
  z.object({
    displayName: displayNameSchema,
    initials: initialsSchema.optional(),
  }),
);

/**
 * Changes an agent.
 *
 * Its name and the letters drawn in place of a picture. A person changes their
 * own on the account window; an agent has no window, so somebody does it here —
 * the same reason its picture is chosen for it.
 *
 * Only what was sent is written, so a form that saves one field and a form that
 * saves both are the same command and neither blanks the other's field by not
 * knowing about it.
 */
export const updateAgentCommand = defineCommand(
  'identity.updateAgent',
  z.object({
    userId: z.string().uuid(),
    displayName: displayNameSchema.optional(),
    initials: initialsSchema.optional(),
  }),
);

/**
 * Issues a key for an agent.
 *
 * The secret comes back once, in the reply, and is never readable again: only
 * its hash is stored. Losing one is annoying rather than dangerous, which is
 * the property worth having — the answer is to revoke it and make another.
 *
 * Named, because a list of keys nobody can tell apart is a list nobody dares
 * revoke anything from.
 */
export const issueAgentTokenCommand = defineCommand(
  'identity.issueAgentToken',
  z.object({ userId: z.string().uuid(), name: tokenNameSchema }),
);

/**
 * Stops a key working.
 *
 * Immediately and for good. The row stays, marked revoked, so a list still says
 * what was there and when it stopped — a key that vanished would leave somebody
 * wondering whether they had revoked it or imagined it.
 */
export const revokeAgentTokenCommand = defineCommand(
  'identity.revokeAgentToken',
  z.object({ tokenId: z.string().uuid() }),
);
