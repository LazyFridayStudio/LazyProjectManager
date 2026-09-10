import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { calendarDateSchema } from '../../projects/project-vocabulary.js';
import { cardPrioritySchema, cardTitleSchema, cardTypeSchema } from '../board-vocabulary.js';

const cardIdSchema = z.string().uuid();

/** Free text everywhere it appears: a discipline or a fix version is whatever a studio calls it. */
const shortTextSchema = z.string().trim().min(1).max(80);

const longTextSchema = z.string().trim().max(20_000);

/**
 * Story points. A closed set would be an argument nobody needs to have — some
 * teams use Fibonacci, some use shirt sizes mapped to numbers.
 */
const pointsSchema = z.number().int().min(0).max(999);

/** Working minutes. The client parses `2d 4h` into this before sending it. */
const estimateMinutesSchema = z.number().int().min(0).max(48_000);

/**
 * Creates a card.
 *
 * The key is not an input: `card_sequence` issues it inside the same
 * transaction, so two people creating a card at once cannot be handed the same
 * one. Position is not an input either — a new card goes to the end of its list,
 * and moving it is `board.moveCard`.
 */
export const createCardCommand = defineCommand(
  'board.createCard',
  z.object({
    projectId: z.string().uuid(),
    listId: z.string().uuid(),
    title: cardTitleSchema,
    type: cardTypeSchema,
    priority: cardPrioritySchema.nullish(),
    points: pointsSchema.nullish(),
    estimateMinutes: estimateMinutesSchema.nullish(),
    assigneeId: z.string().uuid().nullish(),
    /** Which milestone this is promised for. Null is the normal state. */
    milestoneId: z.string().uuid().nullish(),
    discipline: shortTextSchema.nullish(),
    fixVersion: shortTextSchema.nullish(),
    dueOn: calendarDateSchema.nullish(),
    description: longTextSchema.nullish(),
    acceptanceCriteria: longTextSchema.nullish(),
  }),
);

/**
 * Edits a card from its detail panel.
 *
 * Every field is optional and only the ones present are written, so two people
 * editing different fields of the same card do not overwrite each other. `null`
 * clears a field; leaving it out keeps it.
 *
 * `listId` is absent deliberately — moving a card is `board.moveCard`, because a
 * move has to respect the work-in-progress limit and take a position, and an
 * edit that could quietly do both would bypass the first.
 *
 * `closed` is absent for the same reason carried one step further: a card is
 * closed by sitting on the list the board finishes on, so closing one is that
 * move and nothing else. A flag here would have been a second answer to what
 * finished means, and the issue sync — which has always read the last list —
 * would have spent every half hour disagreeing with it.
 */
export const updateCardCommand = defineCommand(
  'board.updateCard',
  z.object({
    cardId: cardIdSchema,
    title: cardTitleSchema.optional(),
    type: cardTypeSchema.optional(),
    priority: cardPrioritySchema.nullable().optional(),
    points: pointsSchema.nullable().optional(),
    estimateMinutes: estimateMinutesSchema.nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    /**
     * Who raised it, which is not always who typed it in.
     *
     * Set to whoever created the card and changeable afterwards, because a
     * producer files half the board on somebody else's behalf and the person
     * worth going back to is the one who saw the problem.
     */
    reporterId: z.string().uuid().nullable().optional(),
    milestoneId: z.string().uuid().nullable().optional(),
    discipline: shortTextSchema.nullable().optional(),
    fixVersion: shortTextSchema.nullable().optional(),
    dueOn: calendarDateSchema.nullable().optional(),
    description: longTextSchema.nullable().optional(),
    acceptanceCriteria: longTextSchema.nullable().optional(),
    blocked: z.boolean().optional(),
    blockedReason: shortTextSchema.nullable().optional(),
  }),
);

/**
 * Moves a card, within a list or between them.
 *
 * The destination is given as neighbours rather than an index, because an index
 * means something different by the time it arrives — somebody else may have
 * dropped a card above it. Both neighbours absent means the list was empty.
 */
export const moveCardCommand = defineCommand(
  'board.moveCard',
  z.object({
    cardId: cardIdSchema,
    toListId: z.string().uuid(),
    /** The card it should end up above, if any. */
    beforeCardId: cardIdSchema.nullish(),
    /** The card it should end up below, if any. */
    afterCardId: cardIdSchema.nullish(),
  }),
);

/**
 * Takes a card off the board for good.
 *
 * Not the same thing as closing one. A closed card is work that finished, and
 * its key still resolves for everybody who put it in a commit message. This is
 * for a card that should never have existed — a duplicate off a sync, a line of
 * noise from an import, a title typed into the wrong project — and everything
 * hanging off it goes at the same time.
 *
 * It waits a week in the bin first, because "I deleted the wrong one" is said
 * about cards more than about anything else in the product.
 */
export const deleteCardCommand = defineCommand(
  'board.deleteCard',
  z.object({ cardId: cardIdSchema }),
);

/**
 * Puts the repository's issues on the board.
 *
 * One press rather than a stream, for the reason releases work that way: an
 * issue list is a thing the forge holds and hands over when asked, and a webhook
 * only ever speaks about the one that just changed. Pressing it is also what
 * makes the history arrive — the issues open long before anybody connected.
 *
 * What it does is two rules. An issue with no card gets one. An issue with a
 * card has that card brought back into line with it: what it says, and whether
 * it is closed. A card somebody wrote is never touched.
 */
export const syncIssuesCommand = defineCommand(
  'board.syncIssues',
  z.object({ projectId: z.string().uuid() }),
);
