import { sql, type Database } from '@lpm/database';
import { teamListQuery, TEAM_TILE_FACES, type TeamListView, type TeamSummary } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { pictureUrl } from '../../files/index.js';

/**
 * Every team, with enough of each to draw its tile.
 *
 * One statement: the count and the first few faces come from a lateral join
 * rather than a query per team, because a grid of twenty tiles should cost one
 * round trip and not twenty-one.
 */
export const teamListHandler = defineQueryHandler({
  definition: teamListQuery,

  async execute(_params: Record<string, never>, context): Promise<TeamListView> {
    const actor = requireActor(context, teamListQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'team.view' });

    const rows = await selectTeams(context.database, actor);

    return { teams: rows.map(toSummary) };
  },
});

interface TeamRow {
  teamId: string;
  name: string;
  leadUserId: string | null;
  leadDisplayName: string | null;
  leadInitials: string | null;
  leadAvatarFileId: string | null;
  leadAvatarState: string | null;
  memberCount: number;
  faces: {
    userId: string;
    displayName: string;
    initials: string;
    avatarFileId: string | null;
    avatarState: string | null;
  }[];
}

function toSummary(row: TeamRow): TeamSummary {
  return {
    teamId: row.teamId,
    name: row.name,
    lead:
      row.leadUserId === null || row.leadDisplayName === null
        ? null
        : {
            userId: row.leadUserId,
            displayName: row.leadDisplayName,
            initials: row.leadInitials ?? '',
            avatarUrl: pictureUrl(row.leadAvatarFileId, row.leadAvatarState),
          },
    memberCount: row.memberCount,
    faces: row.faces.map(({ avatarFileId, avatarState, ...face }) => ({
      ...face,
      avatarUrl: pictureUrl(avatarFileId, avatarState),
    })),
  };
}

async function selectTeams(database: Database, actor: RequestActor): Promise<TeamRow[]> {
  const result = await sql<TeamRow>`
    select
      team.id                              as team_id,
      team.name                            as name,
      team.lead_user_id                    as lead_user_id,
      lead.display_name                    as lead_display_name,
      lead.initials                        as lead_initials,
      lead.avatar_file_id                  as lead_avatar_file_id,
      lead_avatar.state                    as lead_avatar_state,
      coalesce(members.total, 0)           as member_count,
      coalesce(shown.faces, '[]'::json)    as faces
    from team
      left join app_user as lead on lead.id = team.lead_user_id
      left join file as lead_avatar on lead_avatar.id = lead.avatar_file_id
      left join lateral (
        select count(*)::int as total
        from team_member
        where team_member.team_id = team.id
      ) members on true
      left join lateral (
        select json_agg(
                 json_build_object(
                   'userId',      face.id,
                   'displayName', face.display_name,
                   'initials',    face.initials,
                   'avatarFileId', face.avatar_file_id,
                   'avatarState', face.avatar_state
                 )
                 order by face.display_name
               ) as faces
        from (
          select
            app_user.id,
            app_user.display_name,
            app_user.initials,
            app_user.avatar_file_id,
            face_avatar.state as avatar_state
          from team_member
            join app_user on app_user.id = team_member.user_id
            left join file as face_avatar on face_avatar.id = app_user.avatar_file_id
          where team_member.team_id = team.id
          order by app_user.display_name
          limit ${TEAM_TILE_FACES}
        ) face
      ) shown on true
    where team.account_id = ${actor.accountId}
    order by team.name
  `.execute(database);

  return result.rows;
}
