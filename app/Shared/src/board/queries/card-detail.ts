import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { cardLinkKindSchema, cardPrioritySchema, cardTypeSchema } from '../board-vocabulary.js';
import { assetStatusSchema } from '../../assets/asset-vocabulary.js';
import { scmLinkKindSchema } from '../../scm/scm-vocabulary.js';
import { cardAssigneeSchema } from './board-view.js';
import { workDoneSchema } from '../../work/work-view.js';

export const subtaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  done: z.boolean(),
});

export const cardCommentSchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  /** Null once the person has been removed; the conversation stays whole. */
  author: cardAssigneeSchema.nullable(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
});

/** Enough of the card on the other end to draw a chip and open it. */
export const cardLinkSchema = z.object({
  id: z.string().uuid(),
  kind: cardLinkKindSchema,
  cardId: z.string().uuid(),
  cardKey: z.string(),
  title: z.string(),
  type: cardTypeSchema,
  closed: z.boolean(),
});

export type CardLink = z.infer<typeof cardLinkSchema>;

/**
 * A card gathered under a legend.
 *
 * Which list it is in is the useful column: the question somebody opens a
 * legend with is "what is left in this clump", and where each card sits is the
 * answer.
 */
export const legendChildSchema = z.object({
  id: z.string().uuid(),
  cardKey: z.string(),
  title: z.string(),
  type: cardTypeSchema,
  listName: z.string(),
  closed: z.boolean(),
});

export type LegendChild = z.infer<typeof legendChildSchema>;

/** The legend a card is under, as much of it as a chip needs. */
export const legendSummarySchema = z.object({
  id: z.string().uuid(),
  cardKey: z.string(),
  title: z.string(),
});

export const cardAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  filename: z.string(),
  mime: z.string(),
  bytes: z.number().nullable(),
  /**
   * A signed URL that opens the file, good for a short while.
   *
   * Signed per request rather than stored, so a link that leaves this response
   * stops working — and so nothing has to be made public to be readable.
   */
  url: z.string(),
  uploadedAt: z.string(),
});

export type CardAttachment = z.infer<typeof cardAttachmentSchema>;

/**
 * One card, in full.
 *
 * Everything the detail panel shows. Separate from the board's chip on purpose:
 * a board carrying descriptions and acceptance criteria would carry them for
 * every card on screen, and nearly all of them would never be read.
 */
/**
 * Something a repository said about this card.
 *
 * Read-only, and derived from a delivery rather than typed by anybody — which is
 * why there is no id to act on: nothing here can be edited, only looked at.
 */
export const cardScmActivitySchema = z.object({
  kind: scmLinkKindSchema,
  /** The short sha, the branch name, or `#41`. */
  ref: z.string(),
  url: z.string().nullable(),
  author: z.string().nullable(),
  message: z.string().nullable(),
  occurredAt: z.string(),
});

export type CardScmActivity = z.infer<typeof cardScmActivitySchema>;

/**
 * An asset this card is about.
 *
 * Enough to recognise it and to say how far along it is, which is what somebody
 * reading a card wants to know about the thing the card is for.
 */
export const cardAssetLinkSchema = z.object({
  linkId: z.string().uuid(),
  assetId: z.string().uuid(),
  name: z.string(),
  status: assetStatusSchema,
  categoryName: z.string(),
});

export type CardAssetLink = z.infer<typeof cardAssetLinkSchema>;

/**
 * A list the card could be moved to.
 *
 * Carried on the card rather than looked up from the board, because the panel
 * opens over the asset library as well — and a control that worked on one screen
 * and not the other would be worse than not having it.
 */
export const cardWorkflowListSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
});

export const cardDetailViewSchema = z.object({
  id: z.string().uuid(),
  cardKey: z.string(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  listId: z.string().uuid(),
  listName: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  acceptanceCriteria: z.string().nullable(),
  type: cardTypeSchema,
  priority: cardPrioritySchema.nullable(),
  points: z.number().int().nullable(),
  estimateMinutes: z.number().int().nullable(),
  assignee: cardAssigneeSchema.nullable(),
  reporter: cardAssigneeSchema.nullable(),
  /** Which milestone this is promised for, by name. Null is the normal state. */
  milestone: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  discipline: z.string().nullable(),
  fixVersion: z.string().nullable(),
  dueOn: z.string().nullable(),
  blocked: z.boolean(),
  blockedReason: z.string().nullable(),
  /**
   * When it was finished, which is a fact about the list it sits on.
   *
   * Set by landing on the list the board finishes on and cleared by leaving it,
   * so nothing sends this: it is read, never written. The card is still drawn
   * there, marked, rather than taken off the board.
   */
  closedAt: z.string().nullable(),
  /** Whether this card gathers others. True before anything is under it. */
  isLegend: z.boolean(),
  /** The legend this card is under, or null for one that stands alone. */
  legend: legendSummarySchema.nullable(),
  /**
   * The cards under this legend, empty for a card that is not one.
   *
   * On the card rather than a second request: opening a legend to see what is
   * in it is the whole reason a legend exists, so the answer arrives with it.
   */
  children: z.array(legendChildSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  attachments: z.array(cardAttachmentSchema),
  subtasks: z.array(subtaskSchema),
  comments: z.array(cardCommentSchema),
  /** The hours put into this, and what they add up to. */
  work: workDoneSchema,
  links: z.array(cardLinkSchema),
  /** What the repository has said about it, newest first. */
  scmActivity: z.array(cardScmActivitySchema),
  /** The assets this card is about. */
  assetLinks: z.array(cardAssetLinkSchema),
  /** Every list on the board, in order, so the card can be moved along it. */
  lists: z.array(cardWorkflowListSchema),
  /**
   * Whether the person reading this may delete the card.
   *
   * About the reader rather than about the card, and here because the panel has
   * no other way to ask: the board decides what it draws from whether the
   * project is archived, which is a different question from whether a studio
   * lets this person unmake work.
   */
  canDelete: z.boolean(),
});

export type CardDetailView = z.infer<typeof cardDetailViewSchema>;

/**
 * The card behind the detail panel.
 *
 * Addressed by id rather than by key, because the panel is opened from a card
 * already on screen and a modal opens over the board rather than navigating away
 * from it.
 */
export const cardDetailQuery = defineQuery(
  'board.cardDetail',
  z.object({ cardId: z.string().uuid() }),
  cardDetailViewSchema,
);
