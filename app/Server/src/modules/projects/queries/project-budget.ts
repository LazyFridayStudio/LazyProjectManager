import { sql, type Database } from '@lpm/database';
import { projectBudgetQuery, type BudgetCategory, type ProjectBudgetView } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError, type MembershipRole } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole, canReachProject } from '../project-access.js';

/**
 * What the project is going to cost, by the headings a studio files work under.
 *
 * One statement: the project and every one of its categories with the assets
 * already rolled up, because a screen that is a table of totals should not cost
 * a query per row.
 *
 * The totals are then added up from those rows here rather than asked for
 * separately. Every asset belongs to exactly one category, so the two agree by
 * construction — and a headline that could disagree with the table under it is
 * worse than no headline.
 */
export const projectBudgetHandler = defineQueryHandler({
  definition: projectBudgetQuery,

  async execute(params: { slug: string }, context): Promise<ProjectBudgetView> {
    const actor = requireActor(context, projectBudgetQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'budget.view' });

    const rows = await selectBudget({
      database: context.database,
      actor,
      role,
      slug: params.slug,
    });

    const first = rows[0];

    if (first === undefined) {
      // Also what another account's project looks like, and one this actor was
      // never added to. Nobody learns a project exists by guessing at its slug.
      throw new ProjectNotFoundError();
    }

    // A project with no categories still answers, as one row with nulls where
    // the category would be. An empty library is a normal state, not an error.
    const categories = rows.filter((row) => row.categoryId !== null).map(toCategory);

    return {
      project: {
        id: first.projectId,
        name: first.projectName,
        slug: first.projectSlug,
        code: first.projectCode,
        currency: first.projectCurrency,
      },
      totals: {
        budgetMinor: first.budgetMinor === null ? null : Number(first.budgetMinor),
        allocatedMinor: sumOf(categories, (category) => category.budgetMinor ?? 0),
        estimatedMinor: sumOf(categories, (category) => category.estimatedMinor),
        committedMinor: sumOf(categories, (category) => category.committedMinor),
        assetCount: sumOf(categories, (category) => category.assetCount),
        unestimatedCount: sumOf(categories, (category) => category.unestimatedCount),
      },
      categories,
    };
  },
});

function sumOf(
  categories: readonly BudgetCategory[],
  read: (row: BudgetCategory) => number,
): number {
  return categories.reduce((total, category) => total + read(category), 0);
}

function toCategory(row: BudgetRow): BudgetCategory {
  return {
    // Narrowed by the caller, which the row type cannot express.
    id: row.categoryId ?? '',
    name: row.categoryName ?? '',
    color: row.categoryColor ?? '',
    assetCount: row.assetCount,
    // `numeric` and `bigint` arrive from `pg` as strings, as everywhere.
    estimatedMinor: Number(row.estimatedMinor),
    committedMinor: Number(row.committedMinor),
    budgetMinor: row.categoryBudgetMinor === null ? null : Number(row.categoryBudgetMinor),
    unestimatedCount: row.unestimatedCount,
  };
}

interface BudgetRow {
  projectId: string;
  projectName: string;
  projectSlug: string;
  projectCode: string;
  projectCurrency: string;
  budgetMinor: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  categoryBudgetMinor: string | null;
  assetCount: number;
  estimatedMinor: string;
  committedMinor: string;
  unestimatedCount: number;
}

interface BudgetQuery {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
  readonly slug: string;
}

async function selectBudget(query: BudgetQuery): Promise<BudgetRow[]> {
  const { database, actor, slug } = query;

  // A lead or owner reaches every project in the account; anyone below has to be
  // a member of this one. Folded in so visibility costs no extra round trip.
  const reachesTheProject = canReachProject(query);

  const result = await sql<BudgetRow>`
    select
      project.id                                     as project_id,
      project.name                                   as project_name,
      project.slug                                   as project_slug,
      project.code                                   as project_code,
      project.currency                               as project_currency,
      project.budget_minor                           as budget_minor,
      asset_category.id                              as category_id,
      asset_category.name                            as category_name,
      asset_category.color                           as category_color,
      asset_category.budget_minor                    as category_budget_minor,
      coalesce(rollup.asset_count, 0)                as asset_count,
      coalesce(rollup.estimated, 0)                  as estimated_minor,
      coalesce(rollup.committed, 0)                  as committed_minor,
      coalesce(rollup.unestimated, 0)                as unestimated_count
    from project
      -- Left, so a project with an empty library still answers with its own
      -- figures rather than with nothing at all.
      left join asset_category
        on asset_category.project_id = project.id
       and asset_category.archived_at is null
      left join lateral (
        select
          count(*)::int                                            as asset_count,
          coalesce(sum(asset.estimated_cost_minor), 0)             as estimated,
          -- An approved estimate is a commitment: it will not now go down.
          coalesce(
            sum(asset.estimated_cost_minor) filter (
              where asset.status in ('approved', 'final')
            ),
            0
          )                                                        as committed,
          -- The part of the total that is missing rather than nought.
          count(*) filter (where asset.estimated_cost_minor is null)::int as unestimated
        from asset
        where asset.category_id = asset_category.id
      ) rollup on true
    where project.slug = ${slug}
      and project.account_id = ${actor.accountId}
      and ${reachesTheProject}
    order by asset_category.position
  `.execute(database);

  return result.rows;
}
