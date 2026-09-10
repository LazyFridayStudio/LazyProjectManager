import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { projectSlugSchema } from '../../projects/project-vocabulary.js';
import { cardPrioritySchema, cardTypeSchema } from '../board-vocabulary.js';
import { cardAssigneeSchema, issueSyncSchema } from './board-view.js';

/**
 * The most rows the list returns.
 *
 * A cap rather than paging, for the reason the board has one: a project with
 * more than this has a filtering problem rather than a scrolling problem, and
 * an unbounded query is how one enormous backlog takes the screen down. What is
 * left out is said out loud at the bottom of the table.
 */
export const MAXIMUM_TASKS_LISTED = 500;

/**
 * One card, as a row rather than as a tile.
 *
 * More than the board's chip and less than the detail panel. A row is read
 * across — key, what it is, what it says, where it is up to — so it carries the
 * things somebody scans a hundred of them for, and nothing they would have to
 * open the card to act on.
 */
export const taskRowSchema = z.object({
  id: z.string().uuid(),
  cardKey: z.string(),
  type: cardTypeSchema,
  title: z.string(),
  /** The list it sits on, which is what its status is. */
  listName: z.string(),
  listColor: z.string(),
  milestone: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  priority: cardPrioritySchema.nullable(),
  points: z.number().int().nullable(),
  /**
   * What the card was estimated at, and what has been logged against it.
   *
   * Both, because over budget is a comparison and one of them alone cannot make
   * it. Null estimate means nobody has guessed, which is not the same as a guess
   * of nought — a card with no estimate is never over its budget, because it has
   * not got one.
   */
  estimateMinutes: z.number().int().nullable(),
  loggedMinutes: z.number().int(),
  /** Nobody can get on with it, which the board marks and this can narrow to. */
  blocked: z.boolean(),
  assignee: cardAssigneeSchema.nullable(),
  /** The first asset this card is about, when it is about one. */
  assetKey: z.string().nullable(),
  /** Off the board rather than on it. Listed anyway, and marked. */
  closed: z.boolean(),
});

export type TaskRow = z.infer<typeof taskRowSchema>;

export const taskListSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    slug: z.string(),
    archived: z.boolean(),
  }),
  /** Every milestone the project has, so the list can be narrowed to one. */
  milestones: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  /**
   * The board's lists, in board order.
   *
   * Here because the header is the same header: a card written from this screen
   * goes to the first list, the way one written from the board does.
   */
  lists: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  /** The repository this project reads its issues from, when it has one. */
  issues: issueSyncSchema.nullable(),
  rows: z.array(taskRowSchema),
  /** How many were left out by the cap. Zero almost always. */
  omitted: z.number().int().nonnegative(),
});

export type TaskListView = z.infer<typeof taskListSchema>;

/**
 * Every card in the project, in board order.
 *
 * The board answers "what is happening"; this answers "what is there". They
 * disagree on purpose about two things: the board hides a closed card and shows
 * only the first two hundred of a list, and this shows everything it has room
 * for, marked.
 *
 * Board order rather than by key, so the two views tell the same story: read
 * the board left to right and the list top to bottom and the work is in the
 * same sequence.
 */
export const taskListQuery = defineQuery(
  'board.taskList',
  z.object({ slug: projectSlugSchema }),
  taskListSchema,
);
