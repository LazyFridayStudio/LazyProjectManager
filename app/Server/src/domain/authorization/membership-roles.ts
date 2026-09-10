/**
 * Roles a user can hold within an account, ordered from most to least trusted.
 *
 * `outsourcer` is the role that shapes the schema: an outsourcer sees only the
 * cards explicitly shared with them, never the whole board. v1 has a single user
 * and will never exercise it, but every query has to be written against that
 * boundary from the start — adding it later means revisiting all of them.
 */
export const membershipRoles = ['owner', 'lead', 'member', 'outsourcer', 'viewer'] as const;

export type MembershipRole = (typeof membershipRoles)[number];

/**
 * How much authority a role carries. Higher wins.
 *
 * `outsourcer` deliberately sits outside this ladder: it is not "less than a
 * member", it is a different shape of access, so it is never compared by rank.
 */
const rankByRole: Readonly<Record<Exclude<MembershipRole, 'outsourcer'>, number>> = {
  owner: 40,
  lead: 30,
  member: 20,
  viewer: 10,
};

export function isOutsourcer(role: MembershipRole): role is 'outsourcer' {
  return role === 'outsourcer';
}

/**
 * The top of the ladder, and the one role a permission group cannot narrow.
 *
 * Its own function rather than `hasAtLeastRole(role, 'owner')`, which says the
 * same thing and reads as a threshold. This is not a threshold — it is an
 * identity, asked in the one place where being at the top means the rules do
 * not apply to you.
 */
export function isOwner(role: MembershipRole): role is 'owner' {
  return role === 'owner';
}

/**
 * Answers whether `role` carries at least the authority of `requiredRole`.
 *
 * An outsourcer never satisfies a rank check — their access is decided entirely
 * by which cards have been shared with them.
 */
export function hasAtLeastRole(role: MembershipRole, requiredRole: MembershipRole): boolean {
  if (isOutsourcer(role) || isOutsourcer(requiredRole)) {
    return role === requiredRole;
  }

  return rankByRole[role] >= rankByRole[requiredRole];
}
