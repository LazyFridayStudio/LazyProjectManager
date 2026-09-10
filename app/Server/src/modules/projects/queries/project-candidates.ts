import { sql, type Database } from '@lpm/database';
import {
  projectCandidatesQuery,
  PROJECT_CANDIDATES_SHOWN,
  type CandidatePerson,
  type CandidateTeam,
  type ProjectCandidatesView,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import type { RequestActor } from '../../../cqrs/request-context.js';
import { authoriseWithinProject } from '../project-access.js';
import { pictureUrl } from '../../files/index.js';

/**
 * Who and what is left to put on a project.
 *
 * Behind `member.invite` on this project rather than behind `user.view`, which
 * is the keys to the install: somebody who may staff a project has to be able
 * to see who there is to staff it with, and a producer given the first without
 * the second would have a picker with nobody in it.
 *
 * Two lists in one round trip because the panel draws both, and a handful of
 * each with a count of the rest — the way to find the ninth name is to type
 * more of it, not to scroll past eight.
 */
export const projectCandidatesHandler = defineQueryHandler({
  definition: projectCandidatesQuery,

  async execute(
    params: { projectId: string; search?: string },
    context,
  ): Promise<ProjectCandidatesView> {
    const actor = await authoriseWithinProject({
      context,
      handlerName: projectCandidatesQuery.name,
      projectId: params.projectId,
      action: 'member.invite',
    });

    const request = {
      database: context.database,
      actor,
      projectId: params.projectId,
      search: params.search ?? '',
    };

    const [people, teams] = await Promise.all([selectPeople(request), selectTeams(request)]);

    return {
      people: people.map(({ avatarFileId, avatarState, ...person }) => ({
        ...person,
        avatarUrl: pictureUrl(avatarFileId, avatarState),
      })),
      teams,
      morePeople: countBeyondThePage(people),
      moreTeams: countBeyondThePage(teams),
    };
  },
});

interface CandidateRequest {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly projectId: string;
  readonly search: string;
}

/** Every row carries the whole matching count, so the extra ones need no query. */
interface Counted {
  readonly total: string;
}

/**
 * How many the picker matched and did not draw.
 *
 * The window function counts the whole match before the limit takes a page of
 * it, so this needs no second statement. Zero when nothing matched at all:
 * `rows[0]` is where the count lives, and no rows is the honest answer to
 * "how many more".
 */
function countBeyondThePage(rows: readonly Counted[]): number {
  return Math.max(Number(rows[0]?.total ?? 0) - PROJECT_CANDIDATES_SHOWN, 0);
}

type PersonRow = Omit<CandidatePerson, 'avatarUrl'> &
  Counted & { avatarFileId: string | null; avatarState: string | null };

/**
 * Everybody on the install who is not already on the project by name.
 *
 * Somebody who reaches it through a team they are in is still offered, and
 * deliberately: a team is a standing grant that ends when they leave it, and
 * putting them on by name is the different, stronger statement that they stay.
 * The teams they are in are on the row, so it is an informed press either way.
 */
async function selectPeople(request: CandidateRequest): Promise<PersonRow[]> {
  const { database, actor, projectId, search } = request;

  const result = await sql<PersonRow>`
    select
      app_user.id                        as user_id,
      app_user.display_name              as display_name,
      app_user.initials                  as initials,
      app_user.avatar_file_id            as avatar_file_id,
      avatar.state                       as avatar_state,
      app_user.email                     as email,
      coalesce(joined.names, '[]'::json) as teams,
      count(*) over ()                   as total
    from membership
      join app_user on app_user.id = membership.user_id
      left join file as avatar on avatar.id = app_user.avatar_file_id
      left join lateral (
        select json_agg(team.name order by team.name) as names
        from team_member
          join team on team.id = team_member.team_id
        where team_member.user_id = app_user.id
          and team.account_id = membership.account_id
      ) joined on true
    where membership.account_id = ${actor.accountId}
      and not exists (
        select 1 from project_member
        where project_member.project_id = ${projectId}::uuid
          and project_member.user_id = app_user.id
      )
      and (
        ${search} = ''
        or app_user.display_name ilike ${'%' + search + '%'}
        or app_user.email::text ilike ${'%' + search + '%'}
      )
    order by app_user.display_name, app_user.id
    limit ${PROJECT_CANDIDATES_SHOWN}
  `.execute(database);

  return result.rows;
}

type TeamRow = CandidateTeam & Counted;

/** Every team on the install that is not already on the project. */
async function selectTeams(request: CandidateRequest): Promise<TeamRow[]> {
  const { database, actor, projectId, search } = request;

  const result = await sql<TeamRow>`
    select
      team.id                     as team_id,
      team.name                   as name,
      coalesce(members.total, 0)  as member_count,
      count(*) over ()            as total
    from team
      left join lateral (
        select count(*)::int as total
        from team_member
        where team_member.team_id = team.id
      ) members on true
    where team.account_id = ${actor.accountId}
      and not exists (
        select 1 from project_team
        where project_team.project_id = ${projectId}::uuid
          and project_team.team_id = team.id
      )
      and (${search} = '' or team.name ilike ${'%' + search + '%'})
    order by team.name, team.id
    limit ${PROJECT_CANDIDATES_SHOWN}
  `.execute(database);

  return result.rows;
}
