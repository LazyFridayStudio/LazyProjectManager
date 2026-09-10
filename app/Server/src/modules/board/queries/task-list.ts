import { sql, type Database } from '@lpm/database';
import { MAXIMUM_TASKS_LISTED, taskListQuery, type TaskListView, type TaskRow } from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { pictureUrl } from '../../files/index.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError, type MembershipRole } from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  canReachProject,
} from '../../projects/project-access.js';

/**
 * Every card in the project, as a list.
 *
 * The board is the answer to what is happening; this is the answer to what is
 * there. It is a different question, so it is a different query rather than the
 * board's with a flag: this one carries the milestone and the linked asset that
 * a chip has no room for, and it does not hide a closed card.
 *
 * One statement, as the board's is, and for the same reason — a project with
 * five hundred cards must not cost five hundred round trips.
 */
export const taskListHandler = defineQueryHandler({
  definition: taskListQuery,

  async execute(params: { slug: string }, context): Promise<TaskListView> {
    const actor = requireActor(context, taskListQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'card.view' });

    const rows = await selectTasks({
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

    const listed = rows.filter(hasCard).slice(0, MAXIMUM_TASKS_LISTED);

    return {
      project: {
        id: first.projectId,
        name: first.projectName,
        code: first.projectCode,
        slug: first.projectSlug,
        archived: first.projectArchivedAt !== null,
      },
      milestones: readMilestones(rows),
      lists: readLists(rows),
      issues: toIssueSync(first),
      rows: listed.map(toRow),
      omitted: Math.max(rows.filter(hasCard).length - listed.length, 0),
    };
  },
});

/**
 * One row per card, or a single row with no card when the project is empty.
 *
 * The milestones come back on every row rather than in a second query: there
 * are a handful of them, the join costs nothing, and one statement is worth
 * more than the bytes.
 */
interface TaskRowRecord {
  projectId: string;
  projectName: string;
  projectCode: string;
  projectSlug: string;
  projectArchivedAt: Date | null;
  listId: string | null;
  cardId: string | null;
  cardKey: string | null;
  cardType: string | null;
  title: string | null;
  listName: string | null;
  listColor: string | null;
  milestoneId: string | null;
  milestoneName: string | null;
  priority: string | null;
  points: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeInitials: string | null;
  assigneeAvatarFileId: string | null;
  assigneeAvatarState: string | null;
  blocked: boolean;
  estimateMinutes: number | null;
  loggedMinutes: number;
  assetKey: string | null;
  closedAt: Date | null;
  repoFullName: string | null;
  canReadRepository: boolean;
  issuesSyncedAt: Date | null;
  syncFailedAt: Date | null;
}

type WithCard = TaskRowRecord & {
  cardId: string;
  cardKey: string;
  cardType: string;
  title: string;
  listName: string;
  listColor: string;
};

function hasCard(row: TaskRowRecord): row is WithCard {
  return row.cardId !== null;
}

function toRow(row: WithCard): TaskRow {
  return {
    id: row.cardId,
    cardKey: row.cardKey,
    type: row.cardType as TaskRow['type'],
    title: row.title,
    listName: row.listName,
    listColor: row.listColor,
    milestone:
      row.milestoneId === null || row.milestoneName === null
        ? null
        : { id: row.milestoneId, name: row.milestoneName },
    priority: row.priority as TaskRow['priority'],
    points: row.points,
    blocked: row.blocked,
    estimateMinutes: row.estimateMinutes,
    loggedMinutes: row.loggedMinutes,
    assignee:
      row.assigneeId === null || row.assigneeName === null || row.assigneeInitials === null
        ? null
        : {
            userId: row.assigneeId,
            displayName: row.assigneeName,
            initials: row.assigneeInitials,
            avatarUrl: pictureUrl(row.assigneeAvatarFileId, row.assigneeAvatarState),
          },
    assetKey: row.assetKey,
    closed: row.closedAt !== null,
  };
}

/**
 * The board's lists, in board order, read off the rows.
 *
 * Every list is on a row whether or not it has a card — the statement joins
 * cards to lists rather than the other way round — so an empty board still says
 * where a new card would go.
 */
function readLists(rows: readonly TaskRowRecord[]): TaskListView['lists'] {
  const byId = new Map<string, string>();

  for (const row of rows) {
    if (row.listId !== null && row.listName !== null) {
      byId.set(row.listId, row.listName);
    }
  }

  return [...byId].map(([id, name]) => ({ id, name }));
}

/**
 * Whether this project can fill itself from a repository, and when it last did.
 *
 * The same three facts the board's header carries, because it is the same
 * header: a button that fails on press is worse than one that is not there.
 */
function toIssueSync(row: TaskRowRecord): TaskListView['issues'] {
  if (row.repoFullName === null) {
    return null;
  }

  return {
    repoFullName: row.repoFullName,
    canRead: row.canReadRepository,
    syncedAt: row.issuesSyncedAt?.toISOString() ?? null,
    failingSince: row.syncFailedAt?.toISOString() ?? null,
  };
}

/**
 * The milestones on the rows, in the order they were met.
 *
 * Read off the result rather than fetched, because every card carrying one has
 * already brought it back — and a project's milestones are what the filter above
 * the table is made of.
 */
function readMilestones(rows: readonly TaskRowRecord[]): TaskListView['milestones'] {
  const byId = new Map<string, string>();

  for (const row of rows) {
    if (row.milestoneId !== null && row.milestoneName !== null) {
      byId.set(row.milestoneId, row.milestoneName);
    }
  }

  return [...byId].map(([id, name]) => ({ id, name }));
}

interface TaskListQuery {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
  readonly slug: string;
}

/**
 * The statement. Long because it is one statement, which is what keeps a
 * five-hundred-card project one round trip — cutting it into fragments to
 * satisfy a line count would hide the shape that makes it fast.
 */
/**
 * The person a card is for, and the picture they are drawn with.
 *
 * Its own fragment because it is five of this statement's columns and none of
 * what the statement is about, and because the two halves of a face — the
 * letters and the file behind them — belong together wherever they are read.
 */
const WHO_IT_IS_FOR = sql`
  assignee.id               as assignee_id,
  assignee.display_name     as assignee_name,
  assignee.initials         as assignee_initials,
  assignee.avatar_file_id   as assignee_avatar_file_id,
  assignee_avatar.state     as assignee_avatar_state
`;

/**
 * What the card was guessed at, and what it has actually taken.
 *
 * Both together because over budget is a comparison and neither half makes it
 * alone. A scalar subquery rather than a join, so a card with four days logged
 * against it stays one row rather than becoming four.
 */
/**
 * The repository this project is wired to, and whether it can be read.
 *
 * Its own fragment for the same reason as the face above it: four columns about
 * something other than a card, repeated verbatim by `board.view`.
 */
const WHAT_THE_REPOSITORY_IS = sql`
  scm_connection.repo_full_name   as repo_full_name,
  scm_connection.issues_synced_at as issues_synced_at,
  scm_connection.sync_failed_at   as sync_failed_at,
  num_nonnulls(
    scm_connection.app_id,
    scm_connection.installation_id,
    scm_connection.private_key_enc
  ) = 3                           as can_read_repository
`;

const WHAT_IT_HAS_TAKEN = sql`
  card.estimate_minutes     as estimate_minutes,
  coalesce((
    select sum(work_log.minutes)::int
    from work_log
    where work_log.card_id = card.id
  ), 0)                     as logged_minutes
`;

async function selectTasks(query: TaskListQuery): Promise<TaskRowRecord[]> {
  const { database, actor, slug } = query;
  const reachesTheProject = canReachProject(query);

  const result = await sql<TaskRowRecord>`
    select
      project.id                as project_id,
      project.name              as project_name,
      project.code              as project_code,
      project.slug              as project_slug,
      project.archived_at       as project_archived_at,
      card.id                   as card_id,
      card.card_key             as card_key,
      card.type                 as card_type,
      card.title                as title,
      list.id                   as list_id,
      list.name                 as list_name,
      list.color                as list_color,
      milestone.id              as milestone_id,
      milestone.name            as milestone_name,
      card.priority             as priority,
      card.points               as points,
      card.blocked              as blocked,
      ${WHAT_IT_HAS_TAKEN},
      ${WHO_IT_IS_FOR},
      linked.asset_key          as asset_key,
      card.closed_at            as closed_at,
      ${WHAT_THE_REPOSITORY_IS}
    from project
      join board on board.project_id = project.id
      -- One row per project at most, so this cannot multiply the rows.
      left join scm_connection on scm_connection.project_id = project.id
      left join list
        on list.board_id = board.id
       and list.archived_at is null
      left join card on card.list_id = list.id
      left join milestone on milestone.id = card.milestone_id
      left join app_user as assignee on assignee.id = card.assignee_id
      left join file as assignee_avatar on assignee_avatar.id = assignee.avatar_file_id
      -- The first asset a card is about, if it is about one. Lateral so that a
      -- card linked to four does not become four rows.
      left join lateral (
        select asset.asset_key
        from card_asset_link
          join asset on asset.id = card_asset_link.asset_id
        where card_asset_link.card_id = card.id
        order by card_asset_link.created_at
        limit 1
      ) linked on true
    where project.slug = ${slug}
      and project.account_id = ${actor.accountId}
      and ${reachesTheProject}
    order by list.position, card.position
  `.execute(database);

  return result.rows;
}
