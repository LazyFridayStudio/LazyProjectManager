import type { MembershipRoleName } from './queries/me.js';

/**
 * The roles a person can hold, most trusted first.
 *
 * The order is the order a dropdown offers them in, which is the order somebody
 * reads them as a ladder.
 */
export const ROLE_ORDER: readonly MembershipRoleName[] = [
  'owner',
  'lead',
  'member',
  'outsourcer',
  'viewer',
];

/**
 * What each role is called on screen.
 *
 * `owner` is written "Admin" because that is what the person holding it is
 * called by everybody who works with them. The code name stays `owner`: it is
 * in the database, in the policy and in five years of rows, and renaming it to
 * match a label would be a migration that buys nothing.
 */
const LABEL_BY_ROLE: Readonly<Record<MembershipRoleName, string>> = {
  owner: 'Admin',
  lead: 'Lead',
  member: 'Member',
  outsourcer: 'Outsourcer',
  viewer: 'Viewer',
};

/**
 * One line on what a role may do.
 *
 * Kept in step with `minimumRoleByAction` in the server's domain by hand, and
 * deliberately not generated from it: a table of every action against every
 * role is a wall nobody reads, and what an admin needs when they are choosing
 * one is a sentence.
 */
const SUMMARY_BY_ROLE: Readonly<Record<MembershipRoleName, string>> = {
  owner: 'Everything: people, settings, connecting a repository, archiving a project.',
  lead: 'Makes projects and shapes their boards. Sees every project on the install.',
  member: 'Writes cards, moves them and comments, on the projects they are on.',
  outsourcer: 'Only the cards shared with them, which they can comment on and update.',
  viewer: 'Reads the projects they are on. Changes nothing.',
};

export function describeRole(role: MembershipRoleName): string {
  return LABEL_BY_ROLE[role];
}

export function summariseRole(role: MembershipRoleName): string {
  return SUMMARY_BY_ROLE[role];
}
