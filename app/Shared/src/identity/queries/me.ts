import { z } from 'zod';

import { themeColorsSchema } from '../theme-colors.js';

import { defineQuery } from '../../envelope/query-definition.js';

export const membershipRoleSchema = z.enum(['owner', 'lead', 'member', 'outsourcer', 'viewer']);

export type MembershipRoleName = z.infer<typeof membershipRoleSchema>;

/**
 * The themes an install ships with.
 *
 * A closed set, matched by a check constraint on the column. Dark is what every
 * install has been looking at, so it is what somebody who has never chosen gets.
 */
/**
 * The themes a person can be on.
 *
 * `custom` is the one they wrote. It is a third choice beside the two that
 * shipped rather than a replacement for them, so Dark and Light stay exactly as
 * they are — and are what a custom one starts from.
 */
export const THEMES = ['dark', 'light', 'custom'] as const;

export const themeSchema = z.enum(THEMES);

export type Theme = z.infer<typeof themeSchema>;

export const signedInUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  /** Two or three letters, shown on card avatars across the board. */
  initials: z.string(),
  avatarUrl: z.string().nullable(),
  /**
   * Which theme they read the app in.
   *
   * On the person rather than in the browser, so it follows them to a second
   * machine. It rides here because this is the query the app waits for before
   * it draws anything, which is the one place a theme can arrive without a
   * second round trip.
   */
  theme: themeSchema,
  /**
   * The colours of their own theme, or null.
   *
   * Null while they are on one of the two that shipped, and also while `theme`
   * says `custom` but nothing has been written yet — which the client reads as
   * dark, so a half-finished row cannot leave anybody staring at nothing.
   */
  themeColors: themeColorsSchema.nullable(),
});

export const membershipSchema = z.object({
  accountId: z.string().uuid(),
  accountName: z.string(),
  role: membershipRoleSchema,
});

export const meViewSchema = z.object({
  user: signedInUserSchema,
  memberships: z.array(membershipSchema),
  /**
   * What this person may do on the install, by action name.
   *
   * Their role and every permission group they hold, already decided — so the
   * shell can leave out a tab whose screen would refuse them, and a screen can
   * leave out a button whose command would.
   *
   * Strings rather than an enum, for the reason `ruleActionSchema` gives: the
   * list of actions lives in the server's authorisation policy, which is the
   * only place that can be right about it. A copy here would be a second list
   * to keep in step.
   *
   * Install-wide only. Whether somebody reaches a particular project is a
   * question about that project, asked when they open it.
   */
  may: z.array(z.string()),
  install: z.object({
    serverName: z.string(),
    baseUrl: z.string(),
  }),
});

export type MeView = z.infer<typeof meViewSchema>;

/**
 * Who the caller is. The web client's first request after a sign-in, and the
 * check on every page load that decides whether to show the app or the login
 * screen.
 */
export const meQuery = defineQuery('identity.me', z.object({}), meViewSchema);
