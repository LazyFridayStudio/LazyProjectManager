import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { cardLinkKindSchema } from '../board-vocabulary.js';

const cardIdSchema = z.string().uuid();

export const subtaskTitleSchema = z.string().trim().min(1, 'Say what the step is.').max(200);

export const commentBodySchema = z
  .string()
  .trim()
  .min(1, 'Write something first.')
  // Long enough for anything worth saying on a card, short enough that a paste
  // accident does not become a row nobody can render.
  .max(10_000);

/** Adds a step to a card. It goes to the end of the list of them. */
export const addSubtaskCommand = defineCommand(
  'board.addSubtask',
  z.object({ cardId: cardIdSchema, title: subtaskTitleSchema }),
);

/**
 * Ticks a step off, unticks it, or renames it.
 *
 * One command rather than three: they are the same row, and a checkbox that took
 * a different code path from a rename is how the two drift apart.
 */
export const updateSubtaskCommand = defineCommand(
  'board.updateSubtask',
  z.object({
    subtaskId: z.string().uuid(),
    title: subtaskTitleSchema.optional(),
    done: z.boolean().optional(),
  }),
);

/** Removes a step. Subtasks are working notes, so this one really does delete. */
export const removeSubtaskCommand = defineCommand(
  'board.removeSubtask',
  z.object({ subtaskId: z.string().uuid() }),
);

/** Says something on a card. */
export const commentCommand = defineCommand(
  'board.comment',
  z.object({ cardId: cardIdSchema, body: commentBodySchema }),
);

/**
 * Ties one card to another.
 *
 * The other card is named by its key rather than its id, because a key is what
 * people have to hand — it is what is in the commit message they are looking at.
 * Keys are unique within a project, so looking one up is also what scopes the
 * link to the board it belongs on.
 *
 * `blocks` and `blocked_by` are the same fact told from either end, so writing
 * one writes both — otherwise a card can be blocked by something that does not
 * know it is blocking.
 */
export const linkCardCommand = defineCommand(
  'board.linkCard',
  z.object({
    cardId: cardIdSchema,
    toCardKey: z.string().trim().toUpperCase().min(1, 'Give the card key.').max(40),
    kind: cardLinkKindSchema,
  }),
);

/** Removes a link, and its other half where it has one. */
export const unlinkCardCommand = defineCommand(
  'board.unlinkCard',
  z.object({ linkId: z.string().uuid() }),
);

/**
 * Makes a card a legend, or stops it being one.
 *
 * Its own command rather than a field on `board.updateCard`, because it is not
 * a property of the card so much as a statement about what the card is for, and
 * because unmaking one has a consequence — everything under it comes out — that
 * a general update would perform silently.
 */
export const setLegendCommand = defineCommand(
  'board.setLegend',
  z.object({ cardId: cardIdSchema, isLegend: z.boolean() }),
);

/**
 * Puts a card under a legend, or takes it out from under one.
 *
 * By key rather than by id, as `board.linkCard` is: the key is what people have
 * to hand. `null` is how a card leaves its legend, so there is no second command
 * that only ever undoes this one.
 */
export const putUnderLegendCommand = defineCommand(
  'board.putUnderLegend',
  z.object({
    cardId: cardIdSchema,
    legendKey: z.string().trim().toUpperCase().min(1, 'Give the legend key.').max(40).nullable(),
  }),
);
