import { sql, type Database } from '@lpm/database';
import {
  projectDashboardQuery,
  ASSET_STATUSES,
  CARD_TYPES,
  type ProjectDashboardView,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError, type MembershipRole } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole, canReachProject } from '../project-access.js';

/** The horizon anybody plans on, and the one the design's "due soon" means. */
const DUE_SOON_DAYS = 7;

/**
 * The state of a project, on one screen.
 *
 * One statement, for the reason the board and the library are one statement: a
 * dashboard is read constantly and by everybody, and a screen that costs eight
 * round trips is a screen that gets slower every time somebody adds a block to
 * it.
 *
 * Everything is counted from what the product already holds. Nothing is stored
 * twice and nothing is cached — a dashboard that could disagree with the board
 * it summarises is worse than no dashboard at all.
 */
export const projectDashboardHandler = defineQueryHandler({
  definition: projectDashboardQuery,

  async execute(params: { slug: string }, context): Promise<ProjectDashboardView> {
    const actor = requireActor(context, projectDashboardQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'dashboard.view' });

    const row = await selectDashboard({
      database: context.database,
      actor,
      role,
      slug: params.slug,
    });

    if (row === undefined) {
      // Also what another account's project looks like, and one this actor was
      // never added to. Nobody learns a project exists by guessing at its slug.
      throw new ProjectNotFoundError();
    }

    return {
      project: {
        id: row.projectId,
        name: row.projectName,
        slug: row.projectSlug,
        code: row.projectCode,
        currency: row.projectCurrency,
        startsOn: row.startsOn,
        shipsOn: row.shipsOn,
        datesTbd: row.datesTbd,
        archived: row.projectArchivedAt !== null,
      },
      work: {
        openCount: row.openCount,
        closedCount: row.closedCount,
        blockedCount: row.blockedCount,
        overdueCount: row.overdueCount,
        dueSoonCount: row.dueSoonCount,
        pointsClosed: row.pointsClosed,
        pointsTotal: row.pointsTotal,
        openByType: countBy(CARD_TYPES, row.openByType),
      },
      pipeline: {
        total: row.assetCount,
        byStatus: countBy(ASSET_STATUSES, row.assetsByStatus),
        overdueCount: row.assetsOverdue,
        unassignedCount: row.assetsUnassigned,
      },
      budget: {
        // `bigint` arrives from `pg` as a string, as everywhere.
        budgetMinor: row.budgetMinor === null ? null : Number(row.budgetMinor),
        estimatedMinor: Number(row.estimatedMinor),
        committedMinor: Number(row.committedMinor),
      },
    };
  },
});

/**
 * Every name in the set, including the ones with nothing in them.
 *
 * A pipeline drawn from only the statuses that happen to have assets is a
 * pipeline whose shape changes as it fills, and the empty stages are half of
 * what the shape says.
 */
function countBy<TName extends string>(
  names: readonly TName[],
  counted: Readonly<Record<string, number>>,
): Record<TName, number> {
  return Object.fromEntries(names.map((name) => [name, counted[name] ?? 0])) as Record<
    TName,
    number
  >;
}

/**
 * The row the statement returns.
 *
 * `CamelCasePlugin` renames these on the way back, so the aliases are snake_case
 * in the statement and camelCase here. Getting that the wrong way round returns
 * a row of undefined for every field.
 */
interface DashboardRow {
  projectId: string;
  projectName: string;
  projectSlug: string;
  projectCode: string;
  projectCurrency: string;
  projectArchivedAt: Date | null;
  startsOn: string | null;
  shipsOn: string | null;
  datesTbd: boolean;
  budgetMinor: string | null;
  openCount: number;
  closedCount: number;
  blockedCount: number;
  overdueCount: number;
  dueSoonCount: number;
  pointsClosed: number;
  pointsTotal: number;
  openByType: Record<string, number>;
  assetCount: number;
  assetsByStatus: Record<string, number>;
  assetsOverdue: number;
  assetsUnassigned: number;
  estimatedMinor: string;
  committedMinor: string;
}

interface DashboardQuery {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
  readonly slug: string;
}

/**
 * The statement itself. It is long because it is one statement — cutting it
 * into fragments to satisfy a line count would hide the shape that makes it
 * one round trip.
 */
// eslint-disable-next-line max-lines-per-function -- see above
async function selectDashboard(query: DashboardQuery): Promise<DashboardRow | undefined> {
  const { database, actor, slug } = query;

  // Their role, the projects they are on, and what their teams were granted,
  // resolved in one expression. Folded into the statement so visibility costs no
  // extra round trip.
  const reachesTheProject = canReachProject(query);

  const result = await sql<DashboardRow>`
    select
      project.id                                as project_id,
      project.name                              as project_name,
      project.slug                              as project_slug,
      project.code                              as project_code,
      project.currency                          as project_currency,
      project.archived_at                       as project_archived_at,
      project.starts_on                         as starts_on,
      project.ships_on                          as ships_on,
      project.dates_tbd                         as dates_tbd,
      project.budget_minor                      as budget_minor,
      work.open_count                           as open_count,
      work.closed_count                         as closed_count,
      work.blocked_count                        as blocked_count,
      work.overdue_count                        as overdue_count,
      work.due_soon_count                       as due_soon_count,
      work.points_closed                        as points_closed,
      work.points_total                         as points_total,
      coalesce(work.open_by_type, '{}'::json)   as open_by_type,
      pipeline.asset_count                      as asset_count,
      coalesce(pipeline.by_status, '{}'::json)  as assets_by_status,
      pipeline.overdue                          as assets_overdue,
      pipeline.unassigned                       as assets_unassigned,
      pipeline.estimated                        as estimated_minor,
      pipeline.committed                        as committed_minor
    from project
      left join lateral (
        select
          count(*) filter (where card.closed_at is null)::int              as open_count,
          count(*) filter (where card.closed_at is not null)::int          as closed_count,
          -- Blocked and overdue are counted among open cards only: a finished
          -- card that was late is history, not a thing to do something about.
          count(*) filter (where card.closed_at is null and card.blocked)::int as blocked_count,
          count(*) filter (
            where card.closed_at is null and card.due_on < current_date
          )::int                                                           as overdue_count,
          count(*) filter (
            where card.closed_at is null
              and card.due_on >= current_date
              -- Cast, because a bound parameter arrives untyped and Postgres
              -- cannot choose between adding days and adding an interval.
              and card.due_on < current_date + ${DUE_SOON_DAYS}::int
          )::int                                                           as due_soon_count,
          coalesce(sum(card.points) filter (where card.closed_at is not null), 0)::int as points_closed,
          coalesce(sum(card.points), 0)::int                               as points_total,
          (
            select json_object_agg(counted.type, counted.total)
            from (
              select open_card.type as type, count(*)::int as total
              from card as open_card
              where open_card.project_id = project.id
                and open_card.closed_at is null
              group by open_card.type
            ) counted
          )                                                                as open_by_type
        from card
        where card.project_id = project.id
      ) work on true
      left join lateral (
        select
          count(*)::int                                                    as asset_count,
          count(*) filter (
            where asset.due_on < current_date and asset.status not in ('approved', 'final')
          )::int                                                           as overdue,
          count(*) filter (where asset.assignee_id is null)::int           as unassigned,
          coalesce(sum(asset.estimated_cost_minor), 0)                     as estimated,
          -- What will not now go down: an approved estimate is a commitment.
          coalesce(
            sum(asset.estimated_cost_minor) filter (
              where asset.status in ('approved', 'final')
            ),
            0
          )                                                                as committed,
          (
            select json_object_agg(counted.status, counted.total)
            from (
              select staged.status as status, count(*)::int as total
              from asset as staged
              where staged.project_id = project.id
              group by staged.status
            ) counted
          )                                                                as by_status
        from asset
        where asset.project_id = project.id
      ) pipeline on true
    where project.slug = ${slug}
      and project.account_id = ${actor.accountId}
      and ${reachesTheProject}
  `.execute(database);

  return result.rows[0];
}
