import type { ColumnType, Generated } from 'kysely';

/**
 * Table types for identity and tenancy.
 *
 * Columns are declared in camelCase and Kysely's `CamelCasePlugin` renders them
 * as snake_case SQL, so TypeScript reads the way `docs/CleanCode.md` asks while the
 * database stays idiomatic Postgres. Raw `sql` fragments bypass the plugin and
 * must be written in snake_case by hand.
 */

/** A timestamp the database fills in and application code never writes. */
type CreatedAt = ColumnType<Date, Date | undefined, never>;

/** A timestamp the database defaults but application code may update. */
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

export interface AccountTable {
  id: Generated<string>;
  name: string;
  slug: string;
  createdAt: CreatedAt;
}

/**
 * Named `app_user` rather than `user` because `user` is a reserved word in
 * Postgres and would need quoting at every call site.
 */
export interface AppUserTable {
  id: Generated<string>;
  email: string;
  passwordHash: string;
  displayName: string;
  /** Two or three letters shown on card avatars, e.g. `JW`. */
  initials: string;
  /**
   * The picture they chose, if they chose one. A `file` like any other, so it
   * gets a thumbnail and is read through `/api/f/<id>` with the permission
   * checked on the way past. Null is drawn as the initials above.
   */
  avatarFileId: string | null;
  /** Which theme they read the app in. Dark unless they said otherwise. */
  theme: Generated<string>;
  /**
   * The colours of a theme somebody wrote, or null for the two that shipped.
   *
   * A handful rather than ninety: almost every custom property is derived from
   * these, so what is stored is the small set at the root and the rest follows
   * at runtime.
   */
  themeColors: ColumnType<Record<string, string> | null, string | null, string | null>;
  /**
   * A person or an agent.
   *
   * Both are users, because everything that names somebody — a card's assignee,
   * a comment's author, a line in the trail — points at this table, and an
   * agent that could not be named by those would be a second kind of citizen
   * half the product could not talk about.
   *
   * A person signs in with a password; an agent presents a token and cannot
   * sign in at all.
   */
  kind: Generated<string>;
  status: 'active' | 'invited' | 'suspended';
  createdAt: CreatedAt;
  lastSeenAt: Date | null;
}

export interface MembershipTable {
  id: Generated<string>;
  accountId: string;
  userId: string;
  role: 'owner' | 'lead' | 'member' | 'outsourcer' | 'viewer';
  createdAt: CreatedAt;
}

/**
 * A key an agent presents instead of signing in.
 *
 * Only the hash is kept, for the reason the session table gives. The secret is
 * shown once when it is made and never again, which is what makes losing one
 * merely annoying rather than dangerous.
 */
export interface ApiTokenTable {
  id: Generated<string>;
  userId: string;
  /** What it is for, so a list of keys is a list somebody can act on. */
  name: string;
  tokenHash: string;
  createdAt: CreatedAt;
  /** Null for a key nothing has ever presented. */
  lastUsedAt: Date | null;
  /** Set rather than deleted, so a revoked key stays visible as revoked. */
  revokedAt: Date | null;
}

export interface SessionTable {
  id: Generated<string>;
  userId: string;
  /** Only the hash is stored, so a database leak does not hand over live sessions. */
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: CreatedAt;
}

/**
 * A single row describing this install. Written by the first-run setup wizard
 * and read by the connect-to-server screen.
 */
export interface InstallSettingsTable {
  id: Generated<string>;
  serverName: string;
  baseUrl: string;
  setupCompletedAt: Date | null;
  /**
   * Whoever set the install up. Permanent: their role cannot be changed and
   * they cannot be suspended.
   *
   * Null only on an install restored from a backup older than the step that
   * added this, which should still boot rather than refuse.
   */
  ownerUserId: string | null;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

/**
 * A group of people, which is how a studio says "these ones work on that".
 *
 * The lead is nullable and stays that way if they leave: a team without one is
 * a real state, and losing the person should not take the team with them.
 */
export interface TeamTable {
  id: Generated<string>;
  accountId: string;
  name: string;
  leadUserId: string | null;
  createdAt: CreatedAt;
}

export interface TeamMemberTable {
  id: Generated<string>;
  teamId: string;
  userId: string;
  createdAt: CreatedAt;
}
