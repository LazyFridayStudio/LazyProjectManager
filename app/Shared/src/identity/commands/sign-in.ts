import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { emailSchema } from './complete-setup.js';

/**
 * Exchanges credentials for a session cookie.
 *
 * The password is only length-bounded here, not checked against the password
 * policy: an existing account may predate a policy change, and rejecting a
 * correct password at the schema would lock its owner out.
 */
export const signInCommand = defineCommand(
  'identity.signIn',
  z.object({
    email: emailSchema,
    password: z.string().min(1, 'Enter your password.').max(200),
  }),
);

export const signOutCommand = defineCommand('identity.signOut', z.object({}));
