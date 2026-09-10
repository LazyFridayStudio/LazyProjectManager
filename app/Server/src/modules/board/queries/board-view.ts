import { sql, type Database } from '@lpm/database';
import {
  boardViewQuery,
  MAXIMUM_CARDS_PER_LIST,
  type BoardList,
  type BoardView,
  type CardChip,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError, type MembershipRole } from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  canReachProject,
} from '../../projects/project-access.js';

/**
 * The whole board.
 *
 * One statement, as `API.md` requires: lists joined laterally to their cards,
 * capped per list, with the cards already shaped as JSON by Postgres. A query
 * per list would be invisible on the four lists a new project has and would be
 * the whole cost of the screen on a board with thirty.
 *
 * If this ever passes ~50ms at ten thousand cards, that is the moment to add a
 * materialised read table — not before.
 */
export const boardViewHandler = defineQueryHandler({
  definition: boardViewQuery,

  async execute(params: { slug: string }, context): Promise<BoardView> {
    const actor = requireActor(context, boardViewQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'board.viewList' });

    const rows = await selectBoard({
      database: context.database,
      actor,
      role,
      slug: params.slug,
    });
    const first = rows[0];

    if (first === undefined) {
      // Also what another account's project looks like, and one this actor was
      // never added to. Nobody learns a board exists by guessing at its address.
      throw new ProjectNotFoundError();
    }

    return {
      boardId: first.boardId,
      project: {
        id: first.projectId,
        name: first.projectName,
        code: first.projectCode,
        slug: first.projectSlug,
        archived: first.projectArchivedAt !== null,
        wipIsAdvisory: first.wipIsAdvisory,
      },
      // A project with no lists still returns one row, with nothing on it.
      lists: rows.filter(hasList).map(toBoardList),
      issues: toIssueSync(first),
    };
  },
});

/**
 * One row per list, or a single row with no list when the board is empty.
 *
 * The column aliases in the statement are snake_case, because a raw fragment is
 * passed to Postgres untouched — but the `CamelCasePlugin` renames them on the
 * way back, so this is what actually arrives.
 *
 * `cards` is already built by `json_agg`, so the chips are shaped once, in the
 * database, rather than assembled from a flat result set here.
 */
interface BoardRow {
  boardId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  projectSlug: string;
  projectArchivedAt: Date | null;
  wipIsAdvisory: boolean;
  listId: string | null;
  listName: string | null;
  listColor: string | null;
  wipLimit: number | null;
  cardCount: number;
  cards: CardChip[];
  repoFullName: string | null;
  /** All three together or none: the database holds that. */
  canReadRepository: boolean;
  issuesSyncedAt: Date | null;
  syncFailedAt: Date | null;
}

type BoardRowWithList = BoardRow & {
  listId: string;
  listName: string;
  listColor: string;
};

function hasList(row: BoardRow): row is BoardRowWithList {
  return row.listId !== null;
}

function toBoardList(row: BoardRowWithList): BoardList {
  return {
    id: row.listId,
    name: row.listName,
    color: row.listColor,
    wipLimit: row.wipLimit,
    count: row.cardCount,
    cards: row.cards,
  };
}

/**
 * Whether this board can fill itself from a repository, and when it last did.
 *
 * Null rather than a false-everything object when there is no repository: the
 * screen draws nothing at all in that case, and "no repository" is a different
 * thing from "a repository we cannot read".
 */
function toIssueSync(row: BoardRow): BoardView['issues'] {
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

interface BoardQuery {
  readonly database: Database;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
  readonly slug: string;
}

/**
 * The statement itself. It is long because it is one statement — cutting it into
 * fragments to satisfy a line count would hide the shape that makes it fast.
 */
// eslint-disable-next-line max-lines-per-function -- see above
async function selectBoard(query: BoardQuery): Promise<BoardRow[]> {
  const { database, actor, slug } = query;

  // Their role, the projects they are on, and what their teams were granted,
  // resolved in one expression. Folded into the statement so visibility costs no
  // extra round trip.
  const reachesTheProject = canReachProject(query);

  const result = await sql<BoardRow>`
    select
      board.id                          as board_id,
      project.id                        as project_id,
      project.name                      as project_name,
      project.code                      as project_code,
      project.slug                      as project_slug,
      project.archived_at               as project_archived_at,
      project.wip_is_advisory           as wip_is_advisory,
      list.id                           as list_id,
      list.name                         as list_name,
      list.color                        as list_color,
      list.wip_limit                    as wip_limit,
      coalesce(open_cards.total, 0)     as card_count,
      coalesce(chips.cards, '[]'::json) as cards,
      scm_connection.repo_full_name     as repo_full_name,
      scm_connection.issues_synced_at   as issues_synced_at,
      scm_connection.sync_failed_at     as sync_failed_at,
      num_nonnulls(
        scm_connection.app_id,
        scm_connection.installation_id,
        scm_connection.private_key_enc
      ) = 3                             as can_read_repository
    from project
      join board on board.project_id = project.id
      -- One row per project at most, so this cannot multiply the lists.
      left join scm_connection on scm_connection.project_id = project.id
      left join list
        on list.board_id = board.id
       and list.archived_at is null
      left join lateral (
        select count(*)::int as total
        from card
        where card.list_id = list.id
          and card.closed_at is null
      ) open_cards on true
      left join lateral (
        select json_agg(ordered.chip order by ordered.chip_position) as cards
        from (
          select
            json_build_object(
              'id',       card.id,
              'cardKey',  card.card_key,
              'type',     card.type,
              'title',    card.title,
              'priority', card.priority,
              'points',   card.points,
              'estimateMinutes', card.estimate_minutes,
              -- Summed here rather than joined, so a card with four days logged
              -- against it stays one chip rather than becoming four.
              'loggedMinutes', coalesce((
                select sum(work_log.minutes)::int
                from work_log
                where work_log.card_id = card.id
              ), 0),
              'dueOn',    card.due_on,
              'blocked',  card.blocked,
              'closed',   card.closed_at is not null,
              'assignee', case
                            when assignee.id is null then null
                            else json_build_object(
                              'userId',      assignee.id,
                              'displayName', assignee.display_name,
                              'initials',    assignee.initials,
                              -- Built here rather than mapped afterwards: the
                              -- whole board is one statement, and a chip is
                              -- already json by the time it reaches JavaScript.
                              'avatarUrl',   case
                                               when assignee_avatar.state = 'stored'
                                               then '/api/f/' || assignee.avatar_file_id
                                             end
                            )
                          end,
              'isLegend', card.is_legend,
              -- Only asked for on a legend. For every other card the answer is
              -- the empty list, and running the subselect to learn that on every
              -- chip of a thirty-list board is a cost paid for nothing.
              'gathers',  case
                            when not card.is_legend then '[]'::json
                            else coalesce((
                              select json_agg(json_build_object(
                                'id',      under.id,
                                'cardKey', under.card_key,
                                'type',    under.type,
                                'title',   under.title,
                                'closed',  under.closed_at is not null,
                                'assigneeId', under.assignee_id
                              ) order by under.position)
                              from card as under
                              where under.legend_id = card.id
                            ), '[]'::json)
                          end
            )             as chip,
            card.position as chip_position
          from card
            left join app_user as assignee on assignee.id = card.assignee_id
            left join file as assignee_avatar
              on assignee_avatar.id = assignee.avatar_file_id
          where card.list_id = list.id
            /*
             * Closed cards are drawn on the list the board finishes on, and
             * nowhere else. Hiding them there would make closing a card look
             * like deleting it — it would vanish from the column it was just
             * dropped in. Anywhere else a closed card is a thing that needs
             * explaining rather than showing, and under the move rule it
             * cannot happen.
             *
             * The last list by position among those not archived, which is the
             * same reading readBoardEnds does for the move itself.
             */
            and (
              card.closed_at is null
              or list.position = (
                select max(finishing.position)
                from list as finishing
                where finishing.board_id = board.id
                  and finishing.archived_at is null
              )
            )
          order by card.position
          limit ${MAXIMUM_CARDS_PER_LIST}
        ) ordered
      ) chips on true
    where project.slug = ${slug}
      and project.account_id = ${actor.accountId}
      and ${reachesTheProject}
    order by list.position
  `.execute(database);

  return result.rows;
}
