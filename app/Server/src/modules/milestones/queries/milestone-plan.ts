import { sql, type Database } from '@lpm/database';
import {
  daysUntil,
  milestonePlanQuery,
  readMilestoneState,
  type Milestone,
  type MilestonePlanView,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';

/**
 * The release plan: every date the project is held to, in the order they land.
 *
 * All of them rather than the next few. A plan is read to see what is coming
 * after the thing that is late, and one showing only the current milestone
 * cannot answer that.
 *
 * Everything countable is counted here from the cards pointing at each
 * milestone. Nothing about progress is stored, so a milestone cannot disagree
 * with the board it summarises.
 */
export const milestonePlanHandler = defineQueryHandler({
  definition: milestonePlanQuery,

  async execute(params: { slug: string }, context): Promise<MilestonePlanView> {
    const actor = requireActor(context, milestonePlanQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'milestone.view' });

    const project = await context.database
      .selectFrom('project')
      .select(['id', 'name', 'slug', 'code'])
      .select(sql<string>`current_date`.as('today'))
      .where('slug', '=', params.slug)
      .where('accountId', '=', actor.accountId)
      .executeTakeFirst();

    if (project === undefined) {
      // Also what another account's project looks like, and one this actor was
      // never added to. Nobody learns a project exists by guessing at its slug.
      throw new ProjectNotFoundError();
    }

    const { today, ...rest } = project;

    return {
      project: rest,
      milestones: await loadMilestones(context.database, project.id, today),
      today,
    };
  },
});

interface PlanRow {
  id: string;
  name: string;
  goal: string | null;
  startsOn: string;
  shipsOn: string;
  capacityPoints: number | null;
  openCount: number;
  closedCount: number;
  pointsClosed: number;
  pointsTotal: number;
  blockedCount: number;
}

async function loadMilestones(
  database: Database,
  projectId: string,
  today: string,
): Promise<Milestone[]> {
  const result = await sql<PlanRow>`
    select
      milestone.id                                    as id,
      milestone.name                                  as name,
      milestone.goal                                  as goal,
      milestone.starts_on                             as starts_on,
      milestone.ships_on                              as ships_on,
      milestone.capacity_points                       as capacity_points,
      coalesce(work.open_count, 0)                    as open_count,
      coalesce(work.closed_count, 0)                  as closed_count,
      coalesce(work.points_closed, 0)                 as points_closed,
      coalesce(work.points_total, 0)                  as points_total,
      coalesce(work.blocked_count, 0)                 as blocked_count
    from milestone
      left join lateral (
        select
          count(*) filter (where card.closed_at is null)::int     as open_count,
          count(*) filter (where card.closed_at is not null)::int as closed_count,
          coalesce(sum(card.points) filter (where card.closed_at is not null), 0)::int
                                                                  as points_closed,
          coalesce(sum(card.points), 0)::int                      as points_total,
          -- Among open cards only: a finished card that was stuck is history.
          count(*) filter (where card.closed_at is null and card.blocked)::int
                                                                  as blocked_count
        from card
        where card.milestone_id = milestone.id
      ) work on true
    where milestone.project_id = ${projectId}
    order by milestone.starts_on, milestone.ships_on, milestone.name
  `.execute(database);

  return result.rows.map((row) => ({
    ...row,
    // Worked out from the dates rather than stored: a state somebody has to
    // remember to change is one that says "Active" about a milestone that
    // ended in March.
    state: readMilestoneState(row, today),
    daysLeft: daysUntil(row.shipsOn, today),
  }));
}
