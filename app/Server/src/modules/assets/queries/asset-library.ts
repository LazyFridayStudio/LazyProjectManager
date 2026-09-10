import { sql, type Database } from '@lpm/database';
import {
  assetLibraryQuery,
  MAXIMUM_ASSETS_PER_CATEGORY,
  type AssetCategory,
  type AssetLibraryView,
  type AssetTile,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { fileUrl } from '../../files/index.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError, type MembershipRole } from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  canReachProject,
} from '../../projects/project-access.js';

/**
 * The whole asset library.
 *
 * One statement, for the same reason the board is: categories joined laterally
 * to their assets, capped per category, with the tiles already shaped as JSON by
 * Postgres. A studio adds categories over a project's life, and a query per
 * category would make the screen slower every time they did.
 *
 * The count and the estimate are computed here rather than from the returned
 * tiles, because the tiles are capped and the numbers beside a category's name
 * are about everything in it.
 */
export const assetLibraryHandler = defineQueryHandler({
  definition: assetLibraryQuery,

  async execute(params: LibraryParams, context): Promise<AssetLibraryView> {
    const actor = requireActor(context, assetLibraryQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.view' });

    const filter = readFilter(params);
    const rows = await selectLibrary({
      database: context.database,
      actor,
      role,
      slug: params.slug,
      filter,
    });
    const first = rows[0];

    if (first === undefined) {
      // Also what another account's project looks like, and one this actor was
      // never added to. Nobody learns a project exists by guessing at its slug.
      throw new ProjectNotFoundError();
    }

    const tree = assembleTheTree(rows.filter(hasCategory).map(toCategory));

    return {
      project: {
        id: first.projectId,
        name: first.projectName,
        slug: first.projectSlug,
        currency: first.projectCurrency,
        archived: first.projectArchivedAt !== null,
      },
      // A category with nothing in it is worth showing when somebody is reading
      // the library and worth hiding when they are searching it: an empty
      // heading is a place to put something, and eight of them are what stands
      // between a search and its answer.
      //
      // Nothing in it now means nothing anywhere under it, so a search still
      // finds an asset four levels down — with the headings that hold it, which
      // is what makes the answer somewhere a person can go rather than a tile
      // floating on its own.
      categories: toCategories(isFiltering(filter) ? withoutEmptyBranches(tree) : tree),
      assetCount: first.projectAssetCount,
      availableTags: first.availableTags,
    };
  },
});

/**
 * One row per category, and one row with no category for a project that has
 * none yet — which is every project until somebody adds one.
 *
 * `CamelCasePlugin` renames these on the way back, so the aliases are snake_case
 * in the statement and camelCase here. Getting that the wrong way round returns
 * a row of undefined for every field.
 */
interface LibraryRow {
  projectId: string;
  projectName: string;
  projectSlug: string;
  projectCurrency: string;
  projectArchivedAt: Date | null;
  categoryId: string | null;
  /** Null for a category at the top, as it is in the column. */
  parentId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  budgetMinor: string | null;
  assetCount: number;
  estimatedMinor: string | null;
  assets: TileRow[];
  /** Everything in the project, whatever the filter says. */
  projectAssetCount: number;
  availableTags: string[];
}

/**
 * A tile as the statement returns it.
 *
 * It carries which file the picture is rather than a link to it. Building the
 * address is this module's business and not the database's, and there is only
 * one place that knows how to write one.
 */
type TileRow = Omit<AssetTile, 'primaryReferenceUrl'> & { primaryReferenceFileId: string | null };

/**
 * A category as the statement returns it: flat, and knowing only its own.
 *
 * `count` and `estimatedMinor` are what is filed *directly* in it at this
 * point. Both become totals for the whole branch once the tree is assembled,
 * which is the one thing about a category the database is not asked for.
 */
interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  budgetMinor: number | null;
  count: number;
  estimatedMinor: number;
  categories: CategoryRow[];
  assets: TileRow[];
}

type LibraryRowWithCategory = LibraryRow & {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
};

function hasCategory(row: LibraryRow): row is LibraryRowWithCategory {
  return row.categoryId !== null;
}

function toCategory(row: LibraryRowWithCategory): CategoryRow {
  return {
    id: row.categoryId,
    parentId: row.parentId,
    name: row.categoryName,
    color: row.categoryColor,
    // `bigint` arrives as a string, as everywhere.
    budgetMinor: row.budgetMinor === null ? null : Number(row.budgetMinor),
    count: row.assetCount,
    estimatedMinor: Number(row.estimatedMinor ?? 0),
    categories: [],
    assets: row.assets,
  };
}

/**
 * The flat rows, nested into the shape the library is read in.
 *
 * Here rather than in the statement, and deliberately. The tree is one pass over
 * rows already fetched — every category comes back either way, because the
 * screen draws all of them — where a recursive CTE would be a second traversal
 * inside the database to produce a shape SQL cannot return anyway. The rule this
 * query is held to is one statement, not one algorithm.
 *
 * The rows arrive ordered by position, and grouping preserves that, so siblings
 * come out in the order somebody arranged them without being sorted again.
 *
 * A category whose parent is missing — archived, or gone between two statements
 * that are not one transaction — is treated as a root rather than dropped. A
 * heading in the wrong place is a thing somebody can fix; a heading that is not
 * drawn at all is assets nobody can reach.
 */
function assembleTheTree(rows: readonly CategoryRow[]): CategoryRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const roots: CategoryRow[] = [];

  for (const row of rows) {
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);

    if (parent === undefined) {
      roots.push(row);
    } else {
      parent.categories.push(row);
    }
  }

  for (const root of roots) {
    rollUp(root);
  }

  return roots;
}

/**
 * A category counts everything under it, not only what is filed directly in it.
 *
 * A parent whose assets all live in its children would otherwise read as empty,
 * which is the opposite of what grouping them was for — and the spend beside its
 * budget would say nothing is being spent while five sub-categories spend it.
 *
 * Returns the branch's totals as it goes, so the whole tree is one walk.
 */
function rollUp(category: CategoryRow): { count: number; estimatedMinor: number } {
  for (const child of category.categories) {
    const branch = rollUp(child);

    category.count += branch.count;
    category.estimatedMinor += branch.estimatedMinor;
  }

  return { count: category.count, estimatedMinor: category.estimatedMinor };
}

/**
 * What a filtered library keeps: the branches with something in them.
 *
 * Pruned from the leaves up, because a parent is worth drawing when anything
 * under it matched — that is how a search four levels down arrives with the
 * headings that say where it was found rather than as a tile from nowhere.
 */
function withoutEmptyBranches(categories: readonly CategoryRow[]): CategoryRow[] {
  return categories
    .map((category) => ({ ...category, categories: withoutEmptyBranches(category.categories) }))
    .filter((category) => category.count > 0);
}

/**
 * Turns each tile's storage key into a link the browser can load.
 *
 * Written here rather than in the statement: how a file is addressed is this
 * server's business, and the database has no reason to know the shape of a URL.
 *
 * The address is the same one everything else uses, and the route behind it
 * sends the thumbnail — a library of forty assets would otherwise be forty
 * full-size renders on one screen.
 */
function toCategories(categories: readonly CategoryRow[]): AssetCategory[] {
  return categories.map(({ parentId: _parentId, ...category }) => ({
    ...category,
    categories: toCategories(category.categories),
    assets: category.assets.map(toTile),
  }));
}

function toTile({ primaryReferenceFileId, ...tile }: TileRow): AssetTile {
  return {
    ...tile,
    primaryReferenceUrl: primaryReferenceFileId === null ? null : fileUrl(primaryReferenceFileId),
  };
}

interface LibraryParams {
  readonly slug: string;
  readonly search?: string;
  readonly tags?: readonly string[];
  readonly statuses?: readonly string[];
}

/**
 * The filter, with every absent part turned into an empty one.
 *
 * The statement then has one shape rather than eight, and "no tags chosen"
 * becomes a comparison against an empty array instead of a branch in the SQL.
 */
interface LibraryFilter {
  readonly search: string;
  readonly tags: readonly string[];
  readonly statuses: readonly string[];
}

function readFilter(params: LibraryParams): LibraryFilter {
  return {
    search: params.search?.trim() ?? '',
    tags: params.tags ?? [],
    statuses: params.statuses ?? [],
  };
}

function isFiltering(filter: LibraryFilter): boolean {
  return filter.search !== '' || filter.tags.length > 0 || filter.statuses.length > 0;
}

/**
 * What the filter lets through, written once and used twice.
 *
 * Both the count beside a category's name and the tiles under it read this,
 * because a screen that filtered the tiles and left the counts alone is a
 * screen that says eight and shows three.
 *
 * An empty search and an empty array both mean "everything", which is what
 * keeps this one expression rather than several assembled ones.
 */
function buildMatches(filter: LibraryFilter) {
  const statuses = sql.val<readonly string[]>(filter.statuses);
  const tags = sql.val<readonly string[]>(filter.tags);

  return sql`
    (
      ${filter.search} = ''
      -- The key as well as the name: somebody who has been handed DRCH-AST-6
      -- in a stand-up pastes it here, which is most of the point of having one.
      or asset.asset_key ilike ${`%${filter.search}%`}
      or asset.name ilike ${`%${filter.search}%`}
    )
    and (
      cardinality(${statuses}::text[]) = 0
      or asset.status = any(${statuses}::text[])
    )
    and (
      cardinality(${tags}::text[]) = 0
      or (
        -- Every selected tag, not any of them, as the design says.
        select count(distinct chosen.tag)
        from asset_tag as chosen
        where chosen.asset_id = asset.id
          and chosen.tag = any(${tags}::text[])
      ) = cardinality(${tags}::text[])
    )
  `;
}

interface LibraryQuery {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
  readonly slug: string;
  readonly filter: LibraryFilter;
}

/**
 * The statement itself. It is long because it is one statement — cutting it into
 * fragments to satisfy a line count would hide the shape that makes it fast.
 */
// eslint-disable-next-line max-lines-per-function -- see above
async function selectLibrary(query: LibraryQuery): Promise<LibraryRow[]> {
  const { database, actor, slug, filter } = query;

  // Their role, the projects they are on, and what their teams were granted,
  // resolved in one expression. Folded into the statement so visibility costs no
  // extra round trip.
  const reachesTheProject = canReachProject(query);

  const matches = buildMatches(filter);

  const result = await sql<LibraryRow>`
    select
      project.id                          as project_id,
      project.name                        as project_name,
      project.slug                        as project_slug,
      project.currency                    as project_currency,
      project.archived_at                 as project_archived_at,
      whole.total                         as project_asset_count,
      coalesce(whole.tags, '[]'::json)    as available_tags,
      asset_category.id                   as category_id,
      asset_category.parent_id            as parent_id,
      asset_category.name                 as category_name,
      asset_category.color                as category_color,
      asset_category.budget_minor         as budget_minor,
      coalesce(totals.total, 0)           as asset_count,
      coalesce(totals.estimated, 0)       as estimated_minor,
      coalesce(tiles.assets, '[]'::json)  as assets
    from project
      left join lateral (
        -- The project's own numbers, outside the filter: the header says
        -- "12 of 39" rather than telling somebody their library shrank, and the
        -- tags on offer are every tag the project uses rather than only those
        -- surviving the filter already applied.
        select
          count(*)::int as total,
          (
            select json_agg(used.tag order by used.tag)
            from (
              select distinct asset_tag.tag
              from asset_tag
                join asset as tagged on tagged.id = asset_tag.asset_id
              where tagged.project_id = project.id
            ) used
          ) as tags
        from asset
        where asset.project_id = project.id
      ) whole on true
      left join asset_category
        on asset_category.project_id = project.id
       and asset_category.archived_at is null
      left join lateral (
        select
          count(*)::int                             as total,
          coalesce(sum(asset.estimated_cost_minor), 0) as estimated
        from asset
        where asset.category_id = asset_category.id
          and ${matches}
      ) totals on true
      left join lateral (
        select json_agg(ordered.tile order by ordered.tile_position) as assets
        from (
          select
            json_build_object(
              'id',                  asset.id,
              'name',                asset.name,
              'status',              asset.status,
              'estimatedCostMinor',  asset.estimated_cost_minor,
              'dueOn',               asset.due_on,
              'primaryReferenceFileId', primary_reference.file_id,
              'referenceCount',      sheet.total,
              'linkedCardCount',     linked.total,
              'subtaskCount',        stages.total,
              'subtasksDone',        stages.done,
              'tags',                coalesce(tags.list, '[]'::json)
            )           as tile,
            asset.position as tile_position
          from asset
            left join lateral (
              select count(*)::int as total
              from asset_reference
              where asset_reference.asset_id = asset.id
            ) sheet on true
            left join lateral (
              -- Only once it has arrived, so a tile never draws a picture that
              -- is still on its way. Which of the two files behind that id gets
              -- sent — the thumbnail, or the original until the worker has made
              -- one — is the file route's decision rather than this one's.
              select
                case when file.state = 'stored' then file.id end as file_id
              from asset_reference
                join file on file.id = asset_reference.file_id
              where asset_reference.asset_id = asset.id
              order by asset_reference.position
              limit 1
            ) primary_reference on true
            left join lateral (
              select count(*)::int as total
              from card_asset_link
              where card_asset_link.asset_id = asset.id
            ) linked on true
            left join lateral (
              -- Both in one pass. The tile draws three of five, so asking
              -- twice would be two scans of the same rows for two halves of
              -- one fact.
              select
                count(*)::int                                   as total,
                count(*) filter (where asset_subtask.done)::int as done
              from asset_subtask
              where asset_subtask.asset_id = asset.id
            ) stages on true
            left join lateral (
              -- Alphabetical, because a row of chips is scanned rather than
              -- read in the order somebody happened to type them.
              select json_agg(asset_tag.tag order by asset_tag.tag) as list
              from asset_tag
              where asset_tag.asset_id = asset.id
            ) tags on true
          where asset.category_id = asset_category.id
            and ${matches}
          order by asset.position
          limit ${MAXIMUM_ASSETS_PER_CATEGORY}
        ) ordered
      ) tiles on true
    where project.slug = ${slug}
      and project.account_id = ${actor.accountId}
      and ${reachesTheProject}
    order by asset_category.position
  `.execute(database);

  return result.rows;
}
