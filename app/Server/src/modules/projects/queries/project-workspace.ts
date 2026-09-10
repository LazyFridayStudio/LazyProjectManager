import {
  projectSectionSchema,
  projectUsesSection,
  projectWorkspaceQuery,
  type ProjectSection,
  type ProjectWorkspaceView,
} from '@lpm/shared';

import { sql } from '@lpm/database';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { fileUrl } from '../../files/index.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import {
  ProjectNotFoundError,
  type MembershipRole,
  type PermittedAction,
} from '../../../domain/index.js';
import {
  assertProjectPermission,
  canReachProject,
  loadMembershipRole,
  loadProjectLevel,
  mayDo,
} from '../project-access.js';

/**
 * What each screen of a project is behind.
 *
 * The same action its own query asks for, which is what makes hiding it honest:
 * a section drawn here is one that opens, and one left out is one that would
 * have refused. Typed as `PermittedAction`, so an action renamed in the
 * catalogue takes this with it rather than leaving a door nobody can see.
 *
 * Settings is the one that is not a `.view`. Every control on that screen is a
 * change — the name, the dates, the pictures, who is on the project — so a
 * reader would arrive at a screen with nothing on it they could press.
 *
 * In the order the sidebar draws them.
 */
const SECTION_ACTIONS: readonly {
  readonly id: ProjectSection;
  readonly action: PermittedAction;
}[] = [
  { id: 'dashboard', action: 'dashboard.view' },
  { id: 'assets', action: 'asset.view' },
  { id: 'board', action: 'board.viewList' },
  { id: 'timeline', action: 'timeline.view' },
  { id: 'builds', action: 'release.view' },
  { id: 'budget', action: 'budget.view' },
  { id: 'docs', action: 'doc.view' },
  { id: 'settings', action: 'project.update' },
];

/**
 * What the sidebar knows about a project.
 *
 * Its own query because the sidebar is on every screen and shows the same
 * numbers on all of them: the count beside `Assets` has to be right while
 * somebody is looking at the board, and the board has no idea what it is.
 *
 * Cheap enough to ask on every screen — two counts and a short list — and
 * cached per project, so moving between screens costs nothing.
 */
export const projectWorkspaceHandler = defineQueryHandler({
  definition: projectWorkspaceQuery,

  async execute(params: { slug: string }, context): Promise<ProjectWorkspaceView> {
    const actor = requireActor(context, projectWorkspaceQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'project.view' });

    const project = await selectProject({
      database: context.database,
      actor,
      role,
      slug: params.slug,
    });

    if (project === undefined) {
      // Also what another account's project looks like, and one this actor was
      // never added to. Nobody learns a project exists by guessing at its slug.
      throw new ProjectNotFoundError();
    }

    const disabledSections = readDisabledSections(project.disabledSections);

    const [assets, openCards, categories, projectLevel] = await Promise.all([
      countAssets(context.database, project.id),
      countOpenCards(context.database, project.id),
      selectCategories(context.database, project.id),
      // How much of this project they reach, which is the other half of every
      // answer below: a rule allowing `doc.view` says they read design docs,
      // and this says whether they read *this* one.
      loadProjectLevel(context.database, { actor, role }, project.id),
    ]);

    return {
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        // Answered here rather than passed down from whichever screen is open:
        // the sidebar draws the mark on all of them, and a screen that had no
        // reason to ask for a project's picture would draw a letter instead.
        // Null until the bytes have arrived, so a logo chosen a second ago is a
        // letter for that second rather than a broken image.
        logoUrl:
          project.logoFileId === null || project.logoState !== 'stored'
            ? null
            : fileUrl(project.logoFileId),
      },
      assetCount: Number(assets.total),
      openCardCount: Number(openCards.total),
      categories: categories.rows.map((category) => ({
        id: category.id,
        depth: category.depth,
        name: category.name,
        color: category.color,
        count: Number(category.total),
      })),
      /*
       * Two questions, both of which have to answer yes.
       *
       * Permission says whether this person may open the section; the project
       * says whether it uses it at all. They are different kinds of fact — one
       * is about somebody, the other about the project — and the sidebar is
       * where they meet. Permission still wins: a section switched on that this
       * person cannot open does not draw.
       */
      sections: SECTION_ACTIONS.filter(
        (section) =>
          mayDo({ actor, role, action: section.action, projectLevel }) &&
          projectUsesSection(section.id, disabledSections),
      ).map((section) => section.id),
      disabledSections: [...disabledSections],
    };
  },
});

/**
 * The sections a project has switched off, read defensively.
 *
 * A word at a time rather than the list at once, so one name this version does
 * not know — a section since renamed, or a row somebody edited by hand — costs
 * that one section rather than the whole setting. Falling back to "none off"
 * for the lot would turn a partly-unreadable row into a project that quietly
 * grew its sections back.
 */
function readDisabledSections(stored: readonly string[]): readonly ProjectSection[] {
  return stored.filter(
    (name): name is ProjectSection => projectSectionSchema.safeParse(name).success,
  );
}

interface ProjectLookup {
  readonly database: RequestContext['database'];
  readonly actor: RequestActor;
  readonly role: MembershipRole;
  readonly slug: string;
}

function selectProject({ database, actor, role, slug }: ProjectLookup) {
  return database
    .selectFrom('project')
    .leftJoin('file as logo', 'logo.id', 'project.logoFileId')
    .select([
      'project.id as id',
      'project.name as name',
      'project.slug as slug',
      'logo.id as logoFileId',
      'logo.state as logoState',
      'project.disabledSections as disabledSections',
    ])
    .where('project.slug', '=', slug)
    .where('project.accountId', '=', actor.accountId)
    .where(canReachProject({ actor, role }))
    .executeTakeFirst();
}

function countAssets(database: RequestContext['database'], projectId: string) {
  return database
    .selectFrom('asset')
    .select((builder) => builder.fn.countAll<string>().as('total'))
    .where('projectId', '=', projectId)
    .executeTakeFirstOrThrow();
}

/** Open cards only: a badge counting finished work would only ever grow. */
function countOpenCards(database: RequestContext['database'], projectId: string) {
  return database
    .selectFrom('card')
    .select((builder) => builder.fn.countAll<string>().as('total'))
    .where('projectId', '=', projectId)
    .where('closedAt', 'is', null)
    .executeTakeFirstOrThrow();
}

/**
 * In the order the library draws them, so the nav is a table of contents.
 *
 * A library is a tree, so this walks it: parents first, each one's children
 * under it, ordered among their siblings — which is what makes an indented list
 * of links read as the same shape the screen it points into is in.
 *
 * The count is everything under a category rather than only what is filed
 * directly in it, because it is the number the library shows beside the same
 * name and two places disagreeing about one heading is worse than either being
 * wrong.
 */
function selectCategories(database: RequestContext['database'], projectId: string) {
  return sql<{
    id: string;
    depth: number;
    name: string;
    color: string;
    total: string;
  }>`
    with recursive tree as (
      select
        asset_category.id,
        asset_category.id as branch_id,
        0 as depth,
        asset_category.name,
        asset_category.color,
        array[asset_category.position]::numeric[] as path
      from asset_category
      where asset_category.project_id = ${projectId}
        and asset_category.archived_at is null
        and asset_category.parent_id is null
      union all
      select
        child.id,
        child.id as branch_id,
        tree.depth + 1,
        child.name,
        child.color,
        tree.path || child.position
      from asset_category as child
        join tree on child.parent_id = tree.id
      where child.archived_at is null
    ),
    -- Everything under each one, itself included, which is what the count means.
    under as (
      select
        top.id as branch_id,
        below.id as category_id
      from tree as top
        join tree as below on below.path[1:array_length(top.path, 1)] = top.path
    )
    select
      tree.id,
      tree.depth,
      tree.name,
      tree.color,
      count(asset.id) as total
    from tree
      join under on under.branch_id = tree.id
      left join asset on asset.category_id = under.category_id
    group by tree.id, tree.depth, tree.name, tree.color, tree.path
    order by tree.path
  `.execute(database);
}
