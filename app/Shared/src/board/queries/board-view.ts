import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { projectSlugSchema } from '../../projects/project-vocabulary.js';
import { cardPrioritySchema, cardTypeSchema } from '../board-vocabulary.js';

/**
 * The most cards one list returns.
 *
 * A list with more than this has a filter problem, not a paging problem — and an
 * unbounded board query is how one enormous backlog takes the whole screen down.
 */
export const MAXIMUM_CARDS_PER_LIST = 200;

/** Just enough of a person to draw their avatar and say who it is. */
export const cardAssigneeSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  initials: z.string(),
  /** Their picture, or null for somebody drawn as their initials. */
  avatarUrl: z.string().nullable(),
});

/** Somebody drawn on a card: an assignee, or whoever raised it. */
export type CardAssignee = z.infer<typeof cardAssigneeSchema>;

/**
 * A card as the board draws it.
 *
 * Everything the tile shows and nothing else: the detail panel is its own query,
 * so the board does not carry descriptions and comment counts it will not paint.
 */
/**
 * A card gathered under a legend, as the legend's own chip carries it.
 *
 * Less than a chip, because it is drawn inside one: a key, what it is called,
 * and whether it is done. The list it sits in is not here — on the board you
 * are already looking at the lists.
 */
export const gatheredCardSchema = z.object({
  id: z.string().uuid(),
  cardKey: z.string(),
  type: cardTypeSchema,
  title: z.string(),
  closed: z.boolean(),
  /**
   * Who it is on, or nobody.
   *
   * Only the id, because nothing draws a face on a gathered row — it is here so
   * a legend can be judged by a filter that asks who the work is on. Without it
   * a legend clumping four cards with one of them mine could not be answered at
   * all, and the clump would either always stay or always go.
   */
  assigneeId: z.string().uuid().nullable(),
});

export type GatheredCard = z.infer<typeof gatheredCardSchema>;

export const cardChipSchema = z.object({
  id: z.string().uuid(),
  cardKey: z.string(),
  type: cardTypeSchema,
  title: z.string(),
  priority: cardPrioritySchema.nullable(),
  points: z.number().int().nullable(),
  dueOn: z.string().nullable(),
  blocked: z.boolean(),
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

  /** Finished, which on this board means sitting on the list it finishes on. */
  closed: z.boolean(),
  assignee: cardAssigneeSchema.nullable(),
  /** Whether this card gathers others, which is drawn as a different card. */
  isLegend: z.boolean(),
  /**
   * What is under it, empty for every card that is not a legend.
   *
   * On the chip rather than fetched when the card is opened out, because the
   * question a legend answers is "what is left in this clump" and a spinner
   * inside a card on a board is a worse answer than the four rows it is hiding.
   */
  gathers: z.array(gatheredCardSchema),
});

export type CardChip = z.infer<typeof cardChipSchema>;

export const boardListSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  wipLimit: z.number().int().nullable(),
  /**
   * Every open card in the list.
   *
   * Which is not the number of chips under it. It can be more, because a list
   * returns at most `MAXIMUM_CARDS_PER_LIST` of them — and on the list the board
   * finishes on it is fewer, because the cards there are closed and still drawn.
   * A column of finished work counting zero is the point of it.
   */
  count: z.number().int().nonnegative(),
  cards: z.array(cardChipSchema),
});

export type BoardList = z.infer<typeof boardListSchema>;

/**
 * The repository this board can fill itself from.
 *
 * `canRead` is separate from having a connection at all, because a project can
 * be wired up for webhooks and still have no credential to ask with — which is
 * the state every Gitea and GitLab connection is in today. A button that fails
 * on press is worse than one that is not there.
 */
export const issueSyncSchema = z.object({
  repoFullName: z.string(),
  canRead: z.boolean(),
  /** When issues were last read in. Null until somebody has pressed it once. */
  syncedAt: z.string().nullable(),
  /**
   * When the sync started failing, and is still failing now.
   *
   * `syncedAt` moves only on a sync that worked, so without this a repository
   * refusing every attempt looks exactly like one nobody has touched — an
   * ageing timestamp and no other sign. The header says only that it is
   * failing and since when; the reason is a sentence, and a sentence belongs
   * on the settings screen where somebody goes to fix it.
   */
  failingSince: z.string().nullable(),
});

export type IssueSync = z.infer<typeof issueSyncSchema>;

export const boardViewSchema = z.object({
  boardId: z.string().uuid(),
  /** Enough of the project for the header, so the screen is one request. */
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    slug: z.string(),
    archived: z.boolean(),
    /**
     * Whether a work-in-progress limit only says so.
     *
     * The board needs it to know who speaks when a card is dropped into a full
     * list. Where the limit is a rule the server refuses the move and its
     * refusal is the message; where it is advice the move happens and the
     * board's own warning is the only thing that will say so.
     */
    wipIsAdvisory: z.boolean(),
  }),
  lists: z.array(boardListSchema),
  /** Null when no repository is connected to this project at all. */
  issues: issueSyncSchema.nullable(),
});

export type BoardView = z.infer<typeof boardViewSchema>;

/**
 * The whole board in one request.
 *
 * It is also one SQL statement — lists joined laterally to their cards — because
 * a board that costs one query per list is a board that gets slower every time
 * somebody adds a column to it.
 */
export const boardViewQuery = defineQuery(
  'board.view',
  z.object({ slug: projectSlugSchema }),
  boardViewSchema,
);
