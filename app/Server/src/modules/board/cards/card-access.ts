import type { Database, DatabaseTransaction } from '@lpm/database';

import type { RequestActor } from '../../../cqrs/request-context.js';
import {
  CardNotFoundError,
  CardProjectArchivedError,
  ForbiddenError,
  isAtLeastLevel,
  ListNotOnBoardError,
  ProjectNotFoundError,
  type AccessLevel,
  type MembershipRole,
} from '../../../domain/index.js';
import { canReachProject, reachedLevel, toAccessLevel } from '../../projects/project-access.js';

/**
 * A card, with the parts of its project a write needs to check.
 *
 * Loaded as one row rather than three lookups: every card command needs the
 * project's archived state and its work-in-progress policy before it can decide
 * anything, and fetching them separately is three chances to forget one.
 */
export interface WritableCard {
  readonly id: string;
  readonly accountId: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly projectCode: string;
  readonly projectArchivedAt: Date | null;
  readonly wipIsAdvisory: boolean;
  readonly listId: string;
  readonly boardId: string;
  /** The stamp a move keeps or clears, rather than one it writes afresh. */
  readonly closedAt: Date | null;
  /** How much of the project the caller reaches, which the loader has checked. */
  readonly reached: AccessLevel;
}

export interface CardAccessRequest {
  readonly database: Database | DatabaseTransaction;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

/**
 * Loads a card the caller is allowed to change.
 *
 * Scoped to the actor's account and to a project they can reach, so a card id
 * guessed from another install is indistinguishable from one that does not
 * exist.
 */
export async function loadWritableCard(
  request: CardAccessRequest,
  cardId: string,
): Promise<WritableCard> {
  const card = await selectCardWithProject(request)
    .where('card.id', '=', cardId)
    .executeTakeFirst();

  if (card === undefined) {
    throw new CardNotFoundError();
  }

  if (card.projectArchivedAt !== null) {
    throw new CardProjectArchivedError();
  }

  return { ...card, reached: assertReaches(card.reached, 'write') };
}

/**
 * The project a card is about to be created in, checked the same way.
 *
 * Shares the visibility rule with `loadWritableCard` so a person cannot create a
 * card somewhere they could not have opened.
 */
export async function loadWritableProject(
  request: CardAccessRequest,
  projectId: string,
): Promise<Omit<WritableCard, 'id' | 'listId' | 'closedAt'>> {
  return loadProject(request, projectId, 'write');
}

/**
 * The same project, for something that only reads it.
 *
 * Searching a project for a card is not writing to it, and a team granted read
 * is exactly the person this exists for.
 */
export async function loadReadableProject(
  request: CardAccessRequest,
  projectId: string,
): Promise<Omit<WritableCard, 'id' | 'listId' | 'closedAt'>> {
  return loadProject(request, projectId, 'read');
}

async function loadProject(
  request: CardAccessRequest,
  projectId: string,
  needed: AccessLevel,
): Promise<Omit<WritableCard, 'id' | 'listId' | 'closedAt'>> {
  const { database, actor } = request;

  const project = await database
    .selectFrom('project')
    .innerJoin('board', 'board.projectId', 'project.id')
    .select([
      'project.accountId as accountId',
      'project.id as projectId',
      'project.slug as projectSlug',
      'project.code as projectCode',
      'project.archivedAt as projectArchivedAt',
      'project.wipIsAdvisory as wipIsAdvisory',
      'board.id as boardId',
    ])
    .select(reachedLevel(request).as('reached'))
    .where('project.id', '=', projectId)
    .where('project.accountId', '=', actor.accountId)
    .where(canReachProject(request))
    .executeTakeFirst();

  if (project === undefined) {
    throw new ProjectNotFoundError();
  }

  if (project.projectArchivedAt !== null) {
    throw new CardProjectArchivedError();
  }

  return { ...project, reached: assertReaches(project.reached, needed) };
}

export interface BoardListRow {
  readonly id: string;
  readonly name: string;
  readonly wipLimit: number | null;
}

/**
 * A list, insisted upon being on the board a card belongs to.
 *
 * The check is what stops a card being moved into another project's list, which
 * would otherwise be a valid-looking pair of ids.
 */
export async function loadListOnBoard(
  database: Database | DatabaseTransaction,
  boardId: string,
  listId: string,
): Promise<BoardListRow> {
  const list = await database
    .selectFrom('list')
    .select(['id', 'name', 'wipLimit'])
    .where('id', '=', listId)
    .where('boardId', '=', boardId)
    .where('archivedAt', 'is', null)
    .executeTakeFirst();

  if (list === undefined) {
    throw new ListNotOnBoardError();
  }

  return list;
}

/** Open cards in a list, which is what a work-in-progress limit counts. */
export async function countOpenCards(
  database: Database | DatabaseTransaction,
  listId: string,
): Promise<number> {
  const result = await database
    .selectFrom('card')
    .select(({ fn }) => fn.countAll().as('total'))
    .where('listId', '=', listId)
    .where('closedAt', 'is', null)
    .executeTakeFirstOrThrow();

  return Number(result.total);
}

function selectCardWithProject(request: CardAccessRequest) {
  const { database, actor } = request;

  const query = database
    .selectFrom('card')
    .innerJoin('project', 'project.id', 'card.projectId')
    .innerJoin('board', 'board.projectId', 'project.id')
    .select([
      'card.id as id',
      'card.accountId as accountId',
      'card.listId as listId',
      'card.closedAt as closedAt',
      'project.id as projectId',
      'project.slug as projectSlug',
      'project.code as projectCode',
      'project.archivedAt as projectArchivedAt',
      'project.wipIsAdvisory as wipIsAdvisory',
      'board.id as boardId',
    ])
    .select(reachedLevel(request).as('reached'))
    .where('card.accountId', '=', actor.accountId)
    .where(canReachProject(request));

  return query;
}

export interface WritableBoard {
  readonly accountId: string;
  readonly projectId: string;
  readonly boardId: string;
}

/** A board the caller may change, checked the way a card is. */
export async function loadWritableBoard(
  request: CardAccessRequest,
  boardId: string,
): Promise<WritableBoard> {
  const board = await request.database
    .selectFrom('board')
    .innerJoin('project', 'project.id', 'board.projectId')
    .select([
      'project.accountId as accountId',
      'project.id as projectId',
      'board.id as boardId',
      'project.archivedAt as projectArchivedAt',
    ])
    .select(reachedLevel(request).as('reached'))
    .where('board.id', '=', boardId)
    .where('project.accountId', '=', request.actor.accountId)
    .where(canReachProject(request))
    .executeTakeFirst();

  if (board === undefined) {
    throw new ProjectNotFoundError();
  }

  if (board.projectArchivedAt !== null) {
    throw new CardProjectArchivedError();
  }

  assertReaches(board.reached, 'write');

  return board;
}

export interface WritableList extends WritableBoard {
  readonly listId: string;
}

/** A list the caller may change, reached through its board and project. */
export async function loadWritableList(
  request: CardAccessRequest,
  listId: string,
): Promise<WritableList> {
  const list = await request.database
    .selectFrom('list')
    .innerJoin('board', 'board.id', 'list.boardId')
    .innerJoin('project', 'project.id', 'board.projectId')
    .select([
      'project.accountId as accountId',
      'project.id as projectId',
      'board.id as boardId',
      'list.id as listId',
      'project.archivedAt as projectArchivedAt',
    ])
    .select(reachedLevel(request).as('reached'))
    .where('list.id', '=', listId)
    .where('list.archivedAt', 'is', null)
    .where('project.accountId', '=', request.actor.accountId)
    .where(canReachProject(request))
    .executeTakeFirst();

  if (list === undefined) {
    throw new ListNotOnBoardError();
  }

  if (list.projectArchivedAt !== null) {
    throw new CardProjectArchivedError();
  }

  assertReaches(list.reached, 'write');

  return list;
}

/**
 * Refuses a caller who can open the project but not change this much of it.
 *
 * These loaders are the one gate every write to a board, a card or a file goes
 * through, so the check is here rather than repeated in twenty handlers. A
 * refusal rather than a not-found, because they can see the thing: being told
 * it does not exist while it is on their screen is worse than being told no.
 */
function assertReaches(reached: number, needed: AccessLevel): AccessLevel {
  const level = toAccessLevel(reached);

  if (!isAtLeastLevel(level, needed)) {
    throw new ForbiddenError('You have read-only access to this project.');
  }

  return level;
}
