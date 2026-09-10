import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { membershipRoleSchema, themeSchema } from '../queries/me.js';
import { themeColorsSchema } from '../theme-colors.js';
import { displayNameSchema, emailSchema, passwordSchema } from './complete-setup.js';

const userIdSchema = z.string().uuid();

/**
 * The two or three letters drawn wherever there is room for a mark and not a
 * name — on a card, in a row, beside a comment.
 *
 * Upper-cased here rather than asked for in upper case: what somebody types is
 * their business and what the board draws is the product's.
 */
export const initialsSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Enter one or two letters.')
  .max(3, 'Three letters at most — it is drawn in a small square.');

/**
 * Adds a person to this install.
 *
 * There is no invitation email, because this install has no way to send one: a
 * studio running its own server has no SMTP credentials until somebody gives it
 * some. So the admin sets the first password and hands it over, and the person
 * changes it once they are in — which is `identity.changePassword`.
 *
 * **It says nothing about what they may do.** That is the permission groups
 * they hold, given from the Users screen once they exist — the one place it is
 * decided, rather than one dialog that can say it once and a screen that can
 * say it ever after. Which projects they may do it in is the team's business,
 * not this command's either.
 */
export const createUserCommand = defineCommand(
  'identity.createUser',
  z.object({
    email: emailSchema,
    displayName: displayNameSchema,
    /**
     * The floor underneath them, for a caller that has a reason to set one.
     *
     * Absent from every screen and absent by default, which is `viewer`: what
     * somebody may do is decided by their permission groups, and a dropdown
     * offering a second answer to that question is how a studio ends up having
     * set one and not the other. Left in the contract because a script seeding
     * an install and a test standing somebody up on a rung both need to say it,
     * and `identity.setUserRole` is the only other way to.
     */
    role: membershipRoleSchema.optional(),
    /** The password they sign in with the first time. */
    password: passwordSchema,
  }),
);

/**
 * Changes your own name, or the letters drawn where there is no room for it.
 *
 * Yours, and nobody else's: an admin changing somebody else's name does it from
 * the Users screen. Both fields are optional and only what is sent is written,
 * so the same command backs a form that saves one field and one that saves
 * both.
 *
 * It answers to no permission, for the reason `identity.me` does not: refusing
 * somebody their own name is not a permission worth having.
 */
export const updateProfileCommand = defineCommand(
  'identity.updateProfile',
  z.object({
    displayName: displayNameSchema.optional(),
    initials: initialsSchema.optional(),
    /** Which theme to read the app in, which is as much about them as their name. */
    theme: themeSchema.optional(),
    /**
     * The colours of their own theme, sent whole.
     *
     * Whole rather than a colour at a time, because a palette is one decision:
     * a ground saved without the text that has to be read on it is a moment
     * where somebody cannot see the panel they are typing into. `null` puts
     * them back on a theme that shipped.
     */
    themeColors: themeColorsSchema.nullable().optional(),
  }),
);

/** Changes what a person may do, everywhere on this install. */
export const setUserRoleCommand = defineCommand(
  'identity.setUserRole',
  z.object({ userId: userIdSchema, role: membershipRoleSchema }),
);

/**
 * Turns somebody's access off, or back on.
 *
 * Suspending rather than deleting: a person who has left still wrote the cards,
 * the comments and the commits, and a deleted row would take their name off all
 * of it. Suspending ends their sessions there and then — an account that cannot
 * sign in but stays signed in is not suspended.
 */
export const setUserStatusCommand = defineCommand(
  'identity.setUserStatus',
  z.object({ userId: userIdSchema, status: z.enum(['active', 'suspended']) }),
);

/**
 * Sets somebody else's password, for the admin who is the only way back in.
 *
 * With no mail server there is no "forgot my password" link that could work, so
 * this is it. It ends their sessions, because a password reset that leaves the
 * old session alive protects nobody.
 */
export const resetUserPasswordCommand = defineCommand(
  'identity.resetUserPassword',
  z.object({ userId: userIdSchema, password: passwordSchema }),
);

/**
 * Changes your own password.
 *
 * The current one is required even though the session already proves who you
 * are: it is what stops a borrowed unlocked laptop becoming a permanent
 * account. Every other session is ended, keeping this one.
 */
export const changePasswordCommand = defineCommand(
  'identity.changePassword',
  z.object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordSchema,
  }),
);
