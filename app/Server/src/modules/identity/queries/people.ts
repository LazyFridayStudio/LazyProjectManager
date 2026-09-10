import { sql, type Database } from '@lpm/database';
import { peopleQuery, PEOPLE_PAGE_SIZE, type PeopleView, type Person } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { pictureUrl } from '../../files/index.js';

interface PeopleParams {
  search?: string;
  after?: string;
  inTeamId?: string;
  notInTeamId?: string;
}

/**
 * Everybody on this install, alphabetically, a page at a time.
 *
 * Admins only, and one statement: the page and the total in the same round trip,
 * because a screen that says "50 of ?" is a screen somebody has to count for
 * themselves.
 */
export const peopleHandler = defineQueryHandler({
  definition: peopleQuery,

  async execute(params: PeopleParams, context): Promise<PeopleView> {
    const actor = requireActor(context, peopleQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'user.view' });

    const rows = await selectPeople({ database: context.database, actor, params });
    const page = rows.slice(0, PEOPLE_PAGE_SIZE);

    return {
      people: page.map(toPerson),
      total: Number(rows[0]?.total ?? 0),
      // One more than a page was asked for. Getting it back is how we know there
      // is another page without counting the whole table twice.
      nextCursor: rows.length > PEOPLE_PAGE_SIZE ? (page.at(-1)?.userId ?? null) : null,
    };
  },
});

interface PersonRow {
  userId: string;
  email: string;
  displayName: string;
  initials: string;
  avatarFileId: string | null;
  avatarState: string | null;
  role: Person['role'];
  status: Person['status'];
  lastSeenAt: Date | null;
  /** Team names, aggregated by the database so this is still one statement. */
  teams: string[];
  /** The groups this person holds in their own right, not through a team. */
  permissionGroups: Person['permissionGroups'];
  /**
   * Whether this is the person setup made, who is permanent.
   *
   * A subselect in the statement rather than a join: there is exactly one
   * settings row, and joining to it once per person reads as though there
   * might be more.
   */
  isInstallOwner: boolean;
  /** The whole matching count, repeated on every row by the window function. */
  total: string;
}

function toPerson(row: PersonRow): Person {
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    initials: row.initials,
    avatarUrl: pictureUrl(row.avatarFileId, row.avatarState),
    role: row.role,
    status: row.status,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    isInstallOwner: row.isInstallOwner,
    teams: row.teams,
    permissionGroups: row.permissionGroups,
  };
}

/**
 * What the caller asked to leave out, with the absences spelled as nulls.
 *
 * Its own step because the statement below is long enough already, and because
 * an absent parameter reaching SQL as `undefined` is a different question from
 * one reaching it as null.
 */
function narrowing(params: PeopleParams): {
  search: string;
  after: string | null;
  inTeamId: string | null;
  notInTeamId: string | null;
} {
  return {
    search: params.search ?? '',
    after: params.after ?? null,
    inTeamId: params.inTeamId ?? null,
    notInTeamId: params.notInTeamId ?? null,
  };
}

interface PeopleRequest {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly params: PeopleParams;
}

/**
 * The teams this person is in, by name.
 *
 * A lateral join rather than a group-by over the whole statement, so the row
 * stays one person and the aggregate stays beside it.
 */
/**
 * People, not agents.
 *
 * An agent is a user like anybody else and belongs in the trail, on a card and
 * in a team — but it is not somebody this screen can do anything useful with:
 * no password to reset, no address to write to, and a list of its own beside
 * this one.
 */
const PEOPLE_ONLY = sql`app_user.kind = 'person'`;

const TEAMS_THEY_ARE_IN = sql`
  left join lateral (
    select json_agg(team.name order by team.name) as names
    from team_member
      join team on team.id = team_member.team_id
    where team_member.user_id = app_user.id
      and team.account_id = membership.account_id
  ) joined on true
`;

/**
 * The permission groups given to this person directly.
 *
 * Not the ones reaching them through a team. Those belong to the team and are
 * changed there, and a row offering to take one off a person would be offering
 * something the screen cannot do.
 */
const GROUPS_THEY_HOLD = sql`
  left join lateral (
    select json_agg(
             json_build_object('groupId', permission_group.id, 'name', permission_group.name)
             order by permission_group.name
           ) as groups
    from user_permission_group
      join permission_group on permission_group.id = user_permission_group.group_id
    where user_permission_group.user_id = app_user.id
      and permission_group.account_id = membership.account_id
  ) held on true
`;

/**
 * The statement.
 *
 * Ordered by name and paged by the row after a given person rather than by an
 * offset: somebody added while the list is being read would otherwise push a
 * row across the page boundary, and the reader would never see it.
 *
 * The cursor is compared as a pair — `(display_name, id) > (…)` — because names
 * are not unique. Two people called Sam Reed with an offset-free cursor on the
 * name alone would hide one of them.
 */
async function selectPeople(request: PeopleRequest): Promise<PersonRow[]> {
  const { database, actor } = request;
  const { search, after, inTeamId, notInTeamId } = narrowing(request.params);

  const result = await sql<PersonRow>`
    select
      app_user.id            as user_id,
      app_user.email         as email,
      app_user.display_name  as display_name,
      app_user.initials      as initials,
      app_user.avatar_file_id as avatar_file_id,
      avatar.state           as avatar_state,
      app_user.status        as status,
      app_user.last_seen_at  as last_seen_at,
      membership.role        as role,
      (app_user.id = (select owner_user_id from install_settings limit 1))
                             as is_install_owner,
      coalesce(joined.names, '[]'::json) as teams,
      coalesce(held.groups, '[]'::json) as permission_groups,
      count(*) over ()       as total
    from membership
      join app_user on app_user.id = membership.user_id
      left join file as avatar on avatar.id = app_user.avatar_file_id
      ${TEAMS_THEY_ARE_IN}
      ${GROUPS_THEY_HOLD}
    where membership.account_id = ${actor.accountId}
      and ${PEOPLE_ONLY}
      and (
        ${search} = ''
        or app_user.display_name ilike ${'%' + search + '%'}
        or app_user.email::text ilike ${'%' + search + '%'}
      )
      and (
        ${inTeamId}::uuid is null
        or exists (
          select 1 from team_member
          where team_member.user_id = app_user.id
            and team_member.team_id = ${inTeamId}::uuid
        )
      )
      and (
        ${notInTeamId}::uuid is null
        or not exists (
          select 1 from team_member
          where team_member.user_id = app_user.id
            and team_member.team_id = ${notInTeamId}::uuid
        )
      )
      and (
        ${after}::uuid is null
        or (app_user.display_name, app_user.id) > (
          select display_name, id from app_user where id = ${after}::uuid
        )
      )
    order by app_user.display_name, app_user.id
    limit ${PEOPLE_PAGE_SIZE + 1}
  `.execute(database);

  return result.rows;
}
