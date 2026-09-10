import { readMinorUnits, sql, type Database } from '@lpm/database';
import type { ProjectScope, ProjectSummary } from '@lpm/shared';

import type { RequestActor } from '../../../cqrs/request-context.js';
import type { MembershipRole } from '../../../domain/index.js';
import { fileUrl } from '../../files/index.js';
import { canReachProject } from '../project-access.js';

/**
 * Reads project tiles.
 *
 * One builder behind both the launcher and the settings screen, so the two can
 * never drift into disagreeing about what a project is or who may see it.
 */
/**
 * Everybody who reaches one project, counted once.
 *
 * Two ways to be on a project — named on it, or in a team that is on it — and a
 * person can be both at once, so the two sets are unioned before they are
 * counted rather than added up. Raw SQL because that is a set operation rather
 * than a count of one table; snake_case throughout, since `CamelCasePlugin`
 * does not reach inside a `sql` fragment.
 *
 * Written out rather than left as the count of `project_member` it used to be:
 * a tile saying `0 team` for a project a whole department is on is a number
 * that sends somebody to go and check.
 */
const EVERYBODY_WHO_REACHES_IT = sql<string>`(
  select count(*) from (
    select project_member.user_id
    from project_member
    where project_member.project_id = project.id
    union
    select team_member.user_id
    from project_team
      join team_member on team_member.team_id = project_team.team_id
    where project_team.project_id = project.id
  ) everybody
)`;

export interface ProjectSummaryQuery {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

export function selectProjectSummaries(query: ProjectSummaryQuery, scope: ProjectScope) {
  const { database, actor, role } = query;

  let builder = database
    .selectFrom('project')
    // Left joined rather than inner joined: a lead sees every project in the
    // account, including the ones they were never added to, and this is what
    // still tells us their role on the ones they were.
    .leftJoin('file as keyArt', 'keyArt.id', 'project.keyArtFileId')
    .leftJoin('file as logo', 'logo.id', 'project.logoFileId')
    .leftJoin('projectMember', (join) =>
      join
        .onRef('projectMember.projectId', '=', 'project.id')
        .on('projectMember.userId', '=', actor.userId),
    )
    .select([
      'project.id as id',
      'project.name as name',
      'project.code as code',
      'project.slug as slug',
      'project.engine as engine',
      'project.phase as phase',
      'project.budgetMinor as budgetMinor',
      'project.currency as currency',
      'project.startsOn as startsOn',
      'project.shipsOn as shipsOn',
      'project.datesTbd as datesTbd',
      // Read by the settings screen only, which is the one place the switches
      // are drawn. Selected here because this is the one project select.
      'project.disabledSections as disabledSections',
      'project.syncOpenIssuesOnly as syncOpenIssuesOnly',
      'project.syncEverySeconds as syncEverySeconds',
      'project.archivedAt as archivedAt',
      'project.updatedAt as updatedAt',
      'projectMember.role as memberRole',
      // The file rather than the key it is stored under: what a tile draws is
      // `/api/f/<id>`, and which of the two objects behind that id gets sent —
      // the thumbnail, or the original until the worker has made one — is the
      // file route's decision. The state comes too, because a picture chosen a
      // second ago has a row and no bytes yet.
      'keyArt.id as keyArtFileId',
      'keyArt.state as keyArtState',
      'logo.id as logoFileId',
      'logo.state as logoState',
    ])
    /*
     * The three numbers a tile shows, counted here rather than left at zero.
     *
     * Subqueries rather than joins: a project joined to its cards and its
     * assets at once multiplies one by the other, and a studio would see a
     * team of forty on a project of four people who had made ten cards each.
     */
    .select((expression) => [
      EVERYBODY_WHO_REACHES_IT.as('teamCount'),
      expression
        .selectFrom('asset')
        .select(expression.fn.countAll().as('count'))
        .whereRef('asset.projectId', '=', 'project.id')
        .as('assetCount'),
      expression
        .selectFrom('card')
        .select(expression.fn.countAll().as('count'))
        .whereRef('card.projectId', '=', 'project.id')
        // Open ones only: a number counting finished work would only ever grow,
        // which makes it a number nobody reads twice.
        .where('card.closedAt', 'is', null)
        .as('openCardCount'),
    ])
    .where('project.accountId', '=', actor.accountId)
    .orderBy('project.updatedAt', 'desc');

  builder = builder.where(canReachProject({ actor, role }));

  if (scope === 'live') {
    builder = builder.where('project.archivedAt', 'is', null);
  }

  if (scope === 'archived') {
    builder = builder.where('project.archivedAt', 'is not', null);
  }

  return builder;
}

export type ProjectSummaryRow = Awaited<
  ReturnType<ReturnType<typeof selectProjectSummaries>['execute']>
>[number];

/** Turns a row into the tile the client renders. */
export function toProjectSummary(
  row: ProjectSummaryRow,
  accountRole: MembershipRole,
): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    slug: row.slug,
    engine: row.engine,
    phase: row.phase,
    // A lead looking at a project they are not on has no project role, so what
    // is shown is the authority they are actually using to look at it.
    role: row.memberRole ?? accountRole,
    budgetMinor: readMinorUnits(row.budgetMinor),
    currency: row.currency,
    startsOn: row.startsOn,
    shipsOn: row.shipsOn,
    datesTbd: row.datesTbd,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    keyArtUrl: storedFileUrl(row.keyArtFileId, row.keyArtState),
    logoUrl: storedFileUrl(row.logoFileId, row.logoState),
    counts: {
      assets: Number(row.assetCount),
      openTasks: Number(row.openCardCount),
      team: Number(row.teamCount),
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Where a picture is fetched from, once there is one to fetch.
 *
 * Null covers both a project with no picture and one chosen a moment ago whose
 * bytes have not arrived — the tile draws the first letter of the name in both
 * cases, which is better than a broken image for the second or two in between.
 */
function storedFileUrl(fileId: string | null, state: string | null): string | null {
  return fileId === null || state !== 'stored' ? null : fileUrl(fileId);
}
