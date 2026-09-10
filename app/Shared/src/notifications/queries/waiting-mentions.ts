import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';

/**
 * How many are listed before the panel stops.
 *
 * Enough that a fortnight away is still readable, few enough that the list is
 * something you work through rather than something you give up on. Past this it
 * says how many more there are, which is the honest thing for a panel that
 * cannot show them all.
 */
export const MENTIONS_LISTED = 8;

export const waitingMentionSchema = z.object({
  id: z.string().uuid(),
  /** Who said it. Null once they have been removed; the remark stays. */
  said: z
    .object({
      displayName: z.string(),
      initials: z.string(),
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
  /** What they said, with its marks written out as the words they stand for. */
  excerpt: z.string(),
  /** Where to go: the card, and the project it is on. */
  cardId: z.string().uuid(),
  cardKey: z.string(),
  cardTitle: z.string(),
  projectSlug: z.string(),
  createdAt: z.string(),
});

export type WaitingMention = z.infer<typeof waitingMentionSchema>;

export const waitingMentionsViewSchema = z.object({
  mentions: z.array(waitingMentionSchema),
  /**
   * Everything still waiting, which is more than the list holds.
   *
   * The count on the mark is this rather than `mentions.length`, or somebody
   * with twenty waiting would see an eight.
   */
  total: z.number().int().nonnegative(),
});

export type WaitingMentionsView = z.infer<typeof waitingMentionsViewSchema>;

/**
 * What is waiting for the person asking.
 *
 * Yours and nobody else's — there is no user id on it, for the reason
 * `identity.me` has none. It answers to no permission for the same reason,
 * though what it can *say* is bounded: a mention only exists at all if the
 * server decided, when the comment was posted, that the person named could
 * reach that project.
 *
 * Asked on a timer rather than pushed. The realtime hub deals in "this project
 * went stale" and a socket watches one project, so a mention arriving on a
 * different board has no route to a tab that is not looking at it — and
 * teaching the hub to address a person rather than a project is a larger change
 * than a red circle is worth. A mention is not a chat message; a minute late is
 * not late.
 */
export const waitingMentionsQuery = defineQuery(
  'notifications.waiting',
  z.object({}),
  waitingMentionsViewSchema,
);
