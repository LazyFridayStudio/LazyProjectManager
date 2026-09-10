import {
  projectDetailQuery,
  switchableProjectSectionSchema,
  type ProjectDetailView,
  type SwitchableProjectSection,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { fileUrl } from '../../files/index.js';
import type { RequestContext } from '../../../cqrs/request-context.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../project-access.js';
import { selectProjectSummaries, toProjectSummary } from './project-summary-reader.js';

/**
 * One project, addressed by its slug. Backs the project settings screen.
 *
 * Scope is `all` so an archived project still opens — its settings screen is
 * where it is restored from.
 */
export const projectDetailHandler = defineQueryHandler({
  definition: projectDetailQuery,

  async execute(params: { slug: string }, context): Promise<ProjectDetailView> {
    const actor = requireActor(context, projectDetailQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'project.view' });

    const row = await selectProjectSummaries({ database: context.database, actor, role }, 'all')
      .where('project.slug', '=', params.slug)
      .executeTakeFirst();

    if (row === undefined) {
      // Also what a project in another account, or one this actor was never
      // added to, looks like. Nobody learns a project exists by guessing at it.
      throw new ProjectNotFoundError();
    }

    const project = toProjectSummary(row, role);

    const [members, teams, sequences] = await Promise.all([
      loadMembers(context, project.id),
      loadTeams(context, project.id),
      loadSequences(context, project.id),
    ]);

    return {
      project,
      members,
      teams,
      sequences,
      /*
       * A word at a time, so one name this version does not know costs that one
       * section rather than the whole setting — the same reading the sidebar
       * does in `project-workspace`.
       */
      syncOpenIssuesOnly: row.syncOpenIssuesOnly,
      syncEverySeconds: row.syncEverySeconds,
      disabledSections: row.disabledSections.filter(
        (name): name is SwitchableProjectSection =>
          switchableProjectSectionSchema.safeParse(name).success,
      ),
    };
  },
});

async function loadMembers(
  context: RequestContext,
  projectId: string,
): Promise<ProjectDetailView['members']> {
  const rows = await context.database
    .selectFrom('projectMember')
    .innerJoin('appUser', 'appUser.id', 'projectMember.userId')
    .leftJoin('file as avatar', 'avatar.id', 'appUser.avatarFileId')
    .select([
      'projectMember.userId as userId',
      'appUser.displayName as displayName',
      'appUser.initials as initials',
      'appUser.avatarFileId as avatarFileId',
      'avatar.state as avatarState',
      'projectMember.role as role',
      'projectMember.createdAt as joinedAt',
    ])
    .where('projectMember.projectId', '=', projectId)
    .orderBy('appUser.displayName')
    .execute();

  return rows.map(({ avatarFileId, avatarState, ...row }) => ({
    ...row,
    joinedAt: row.joinedAt.toISOString(),
    avatarUrl: avatarFileId === null || avatarState !== 'stored' ? null : fileUrl(avatarFileId),
  }));
}

/**
 * The teams on the project, and how many people each one puts on it.
 *
 * The count is the whole question a producer is asking of the row: a line
 * saying `Audio` means nothing until it says how many people came with it. Its
 * own statement rather than a join onto the members above, which would multiply
 * one list by the other.
 */
async function loadTeams(
  context: RequestContext,
  projectId: string,
): Promise<ProjectDetailView['teams']> {
  const rows = await context.database
    .selectFrom('projectTeam')
    .innerJoin('team', 'team.id', 'projectTeam.teamId')
    .leftJoin('appUser as lead', 'lead.id', 'team.leadUserId')
    .select((builder) => [
      'projectTeam.teamId as teamId',
      'team.name as name',
      'lead.displayName as leadDisplayName',
      builder
        .selectFrom('teamMember')
        .select(builder.fn.countAll<string>().as('total'))
        .whereRef('teamMember.teamId', '=', 'team.id')
        .as('memberCount'),
    ])
    .where('projectTeam.projectId', '=', projectId)
    .orderBy('team.name')
    .execute();

  return rows.map((row) => ({ ...row, memberCount: Number(row.memberCount) }));
}

async function loadSequences(
  context: RequestContext,
  projectId: string,
): Promise<ProjectDetailView['sequences']> {
  const rows = await context.database
    .selectFrom('cardSequence')
    .select(['prefix', 'lastValue'])
    .where('projectId', '=', projectId)
    .orderBy('prefix')
    .execute();

  // The screen shows the key that will be handed out next, not the last one
  // used, because that is the number somebody is about to see on a card.
  return rows.map((row) => ({ prefix: row.prefix, nextValue: row.lastValue + 1 }));
}
