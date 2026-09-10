import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { membershipRoleSchema } from './me.js';

/**
 * How many people one request returns.
 *
 * A studio of a thousand is the size this screen is built for, and a thousand
 * rows in one response is a table nobody can find anybody in. Search narrows it;
 * this is what arrives before anybody has typed.
 */
export const PEOPLE_PAGE_SIZE = 50;

export const personStatusSchema = z.enum(['active', 'invited', 'suspended']);

export type PersonStatus = z.infer<typeof personStatusSchema>;

export const personSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  initials: z.string(),
  /** Their picture, or null for somebody drawn as their initials. */
  avatarUrl: z.string().nullable(),
  role: membershipRoleSchema,
  status: personStatusSchema,
  /** Null for somebody who has never signed in. */
  lastSeenAt: z.string().nullable(),
  /**
   * Whether this is the person who set the install up.
   *
   * They are permanent: their role cannot be changed and they cannot be
   * suspended. Here so the screen can say so, rather than offering a control
   * whose command will refuse.
   */
  isInstallOwner: z.boolean(),
  /** The teams they are in, by name, so a row says where they belong. */
  teams: z.array(z.string()),
  /**
   * The permission groups this person holds in their own right.
   *
   * Not what reaches them through a team. Those belong to the team and are
   * changed there, and offering to take one off a person here would be
   * offering something this screen cannot do.
   */
  permissionGroups: z.array(z.object({ groupId: z.string().uuid(), name: z.string() })),
});

export type Person = z.infer<typeof personSchema>;

export const peopleViewSchema = z.object({
  people: z.array(personSchema),
  /** Everybody the search matched, which is more than one page returns. */
  total: z.number().int().nonnegative(),
  /**
   * Pass back as `after` for the next page, or null at the end.
   *
   * The id of the last person on this page. A cursor rather than an offset
   * because somebody added while the list is being read would otherwise push a
   * row across the page boundary and out of sight.
   */
  nextCursor: z.string().nullable(),
});

export type PeopleView = z.infer<typeof peopleViewSchema>;

/**
 * Everybody on this install, in alphabetical order.
 *
 * Admins only. It names every person including the ones whose projects the
 * caller was never added to, which is the point of it and the reason it is
 * behind the strictest role.
 */
export const peopleQuery = defineQuery(
  'identity.people',
  z.object({
    /** Matches a name or an email address. */
    search: z.string().trim().max(120).optional(),
    after: z.string().uuid().optional(),
    /** Only the people in this team, for a team's own list of members. */
    inTeamId: z.string().uuid().optional(),
    /**
     * Only the people who are not in this team.
     *
     * What the picker that adds somebody to a team asks for. Narrowed by the
     * server rather than filtered here, because a thousand people minus the
     * eight already in the team is still a thousand people to send.
     */
    notInTeamId: z.string().uuid().optional(),
  }),
  peopleViewSchema,
);
