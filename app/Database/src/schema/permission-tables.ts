import type { ColumnType, Generated } from 'kysely';

type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

/**
 * A named set of things a team may and may not do.
 *
 * A group rather than rules straight on a team, because the same set is wanted
 * for several teams and a change to it should be one edit rather than three.
 */
export interface PermissionGroupTable {
  id: Generated<string>;
  accountId: string;
  name: string;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

/** One action, allowed or denied. */
export interface PermissionRuleTable {
  id: Generated<string>;
  accountId: string;
  groupId: string;
  /** An action name, or a coarse rule standing for a set of them. */
  action: string;
  /** `allow` or `deny`. Deny wins wherever both reach the same person. */
  effect: string;
  createdAt: CreatedAt;
}

/** A group given to a team. */
export interface TeamPermissionGroupTable {
  id: Generated<string>;
  accountId: string;
  teamId: string;
  groupId: string;
  /** Where it sits in the team's list. Reading order, not precedence. */
  position: Generated<number>;
  createdAt: CreatedAt;
}

/**
 * A group given to a person, rather than to a team they are in.
 *
 * The same shape as the team's, because it answers the same question from the
 * other side: a rule reaches somebody through a team or directly, and `deny`
 * wins wherever two of them disagree.
 */
export interface UserPermissionGroupTable {
  id: Generated<string>;
  accountId: string;
  userId: string;
  groupId: string;
  createdAt: CreatedAt;
}
