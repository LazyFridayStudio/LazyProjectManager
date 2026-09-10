import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';

/**
 * Passwords are the only credential this install has, so the floor is length
 * rather than composition rules. Long beats fiddly: a 12-character passphrase
 * resists guessing far better than eight characters with a digit bolted on, and
 * people do not write it on a monitor.
 */
export const MINIMUM_PASSWORD_LENGTH = 12;
export const MAXIMUM_PASSWORD_LENGTH = 200;

export const passwordSchema = z
  .string()
  .min(MINIMUM_PASSWORD_LENGTH, `Use at least ${String(MINIMUM_PASSWORD_LENGTH)} characters.`)
  // Argon2 is deliberately slow. Without a ceiling, a megabyte-long password is
  // a free way to tie up a CPU core.
  .max(MAXIMUM_PASSWORD_LENGTH, 'That password is too long.');

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .email('That does not look like an email address.');

export const displayNameSchema = z.string().trim().min(1, 'Enter a name.').max(80);

/**
 * The first-run wizard. Creates the account, the owner, and the install's own
 * settings row in one transaction — a half-finished install would leave the
 * server unreachable with no way to retry, since setup refuses to run twice.
 */
export const completeSetupCommand = defineCommand(
  'identity.completeSetup',
  z.object({
    serverName: z.string().trim().min(1, 'Name this server.').max(80),
    /** The public URL this install is reached on, used for links in emails. */
    baseUrl: z.string().trim().url('Enter a full URL, including https://'),
    admin: z.object({
      email: emailSchema,
      password: passwordSchema,
      displayName: displayNameSchema,
    }),
  }),
);
