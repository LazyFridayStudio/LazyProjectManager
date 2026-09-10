import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { listColorSchema, listNameSchema, wipLimitSchema } from '../board-vocabulary.js';

const listIdSchema = z.string().uuid();

/**
 * Adds a list to a board.
 *
 * It goes to the end, because a board is read left to right and a list appearing
 * in the middle of one is a list somebody has to go looking for. Dragging it
 * somewhere else is `board.moveList`.
 */
export const createListCommand = defineCommand(
  'board.createList',
  z.object({
    boardId: z.string().uuid(),
    name: listNameSchema,
    color: listColorSchema,
    wipLimit: wipLimitSchema.nullish(),
  }),
);

/**
 * Renames a list, or changes what it looks like and what it will hold.
 *
 * `wipLimit` sent as null removes the limit; leaving it out keeps it, as
 * everywhere else.
 */
export const updateListCommand = defineCommand(
  'board.updateList',
  z.object({
    listId: listIdSchema,
    name: listNameSchema.optional(),
    color: listColorSchema.optional(),
    wipLimit: wipLimitSchema.nullable().optional(),
    /** Where a card usually goes from here. Advice the board offers, not a rule. */
    nextListId: listIdSchema.nullable().optional(),
    /** Where a card goes when it is sent back. */
    backListId: listIdSchema.nullable().optional(),
  }),
);

/**
 * Moves a list to another place on the board.
 *
 * Neighbours rather than an index, as a card move takes them: an index means
 * something different by the time it arrives, because somebody else may have
 * added a list in front of it. A list named as a neighbour that is no longer on
 * the board leaves the move unbounded on that side rather than refusing it —
 * the drop still meant somewhere.
 */
export const moveListCommand = defineCommand(
  'board.moveList',
  z.object({
    listId: listIdSchema,
    /** The list it should end up in front of. Null means it goes last. */
    beforeListId: listIdSchema.nullish(),
    /** The list it should end up behind. Null means it goes first. */
    afterListId: listIdSchema.nullish(),
  }),
);

/**
 * Takes a list off the board.
 *
 * Its cards have to go somewhere: `moveCardsToListId` says where, and the
 * command refuses rather than stranding them. A list with nothing on it can be
 * archived without naming one.
 */
export const archiveListCommand = defineCommand(
  'board.archiveList',
  z.object({
    listId: listIdSchema,
    moveCardsToListId: listIdSchema.nullish(),
  }),
);
