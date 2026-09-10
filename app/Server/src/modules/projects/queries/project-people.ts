import { sql, type Database } from '@lpm/database';
import {
  projectPeopleQuery,
  PROJECT_PEOPLE_SHOWN,
  type ProjectPeopleAsked,
  type ProjectPeopleView,
  type ProjectPerson,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import type { RequestActor } from '../../../cqrs/request-context.js';
import { pictureUrl } from '../../files/index.js';
import { authoriseWithinProject } from '../project-access.js';

/**
 * Everybody who reaches this project, by name or through a team.
 *
 * What the mention picker offers. Behind `card.comment` on this project rather
 * than behind `user.view`: naming somebody in a remark is part of writing the
 * remark, and a producer who may comment should not need the keys to the
 * install to find out who is on the board with them.
 */
export const projectPeopleHandler = defineQueryHandler({
  definition: projectPeopleQuery,

  async execute(
    params: { projectId: string; search?: string; limit?: number; who?: ProjectPeopleAsked },
    context,
  ): Promise<ProjectPeopleView> {
    const actor = await authoriseWithinProject({
      context,
      handlerName: projectPeopleQuery.name,
      projectId: params.projectId,
      action: 'card.comment',
    });

    const limit = params.limit ?? PROJECT_PEOPLE_SHOWN;

    const rows = await selectPeople({
      database: context.database,
      actor,
      projectId: params.projectId,
      search: params.search ?? '',
      limit,
      who: params.who ?? 'reaches',
    });

    return {
      people: rows.map(toPerson),
      more: Math.max(Number(rows[0]?.total ?? 0) - limit, 0),
    };
  },
});

interface PersonRow {
  userId: string;
  displayName: string;
  initials: string;
  avatarFileId: string | null;
  avatarState: string | null;
  /** The whole matching count, repeated on every row by the window function. */
  total: string;
}

function toPerson(row: PersonRow): ProjectPerson {
  return {
    userId: row.userId,
    displayName: row.displayName,
    initials: row.initials,
    avatarUrl: pictureUrl(row.avatarFileId, row.avatarState),
  };
}

interface PeopleRequest {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly projectId: string;
  readonly search: string;
  readonly limit: number;
  readonly who: ProjectPeopleAsked;
}

/**
 * The three ways somebody reaches a project, asked the other way round.
 *
 * `reachedLevel` answers "which projects does this person get to", compiled into
 * whatever statement is listing projects. This is the same rule read backwards —
 * "who gets to this project" — and it cannot borrow that expression, because
 * that one is written about one person and this is written about all of them.
 *
 * So it is stated again here, and the two must move together. The test that
 * holds them is `a team is people and permissions, and reaches no project by
 * itself` in the journey plus the reach tests around `projects.addTeam`: a
 * mention picker that offered somebody the board would refuse is the failure
 * this shape risks.
 */
async function selectPeople(request: PeopleRequest): Promise<PersonRow[]> {
  const { database, projectId, search, limit, who } = request;

  const result = await sql<PersonRow>`
    select
      app_user.id            as user_id,
      app_user.display_name  as display_name,
      app_user.initials      as initials,
      app_user.avatar_file_id as avatar_file_id,
      avatar.state           as avatar_state,
      count(*) over ()       as total
    from project
      join membership on membership.account_id = project.account_id
      join app_user on app_user.id = membership.user_id
      left join file as avatar on avatar.id = app_user.avatar_file_id
    where project.id = ${projectId}::uuid
      and (${search} = '' or app_user.display_name ilike ${'%' + search + '%'})
      and (
        -- The role: an owner administers the install and a lead makes the
        -- projects, so both reach every one of them — and neither is on this
        -- one because of it. Asked for the crew, that branch is off: a dropdown
        -- offering every lead in the studio for a project none of them touch is
        -- noise, and whoever made this project was put on it by name anyway.
        (${who === 'reaches'} and membership.role in ('owner', 'lead'))
        -- On it by name.
        or exists (
          select 1 from project_member
          where project_member.project_id = project.id
            and project_member.user_id = app_user.id
        )
        -- Or in a team that is on it, which is a standing grant.
        or exists (
          select 1 from project_team
            join team_member on team_member.team_id = project_team.team_id
          where project_team.project_id = project.id
            and team_member.user_id = app_user.id
        )
      )
    order by app_user.display_name, app_user.id
    limit ${limit}
  `.execute(database);

  return result.rows;
}
