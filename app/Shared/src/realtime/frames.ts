import { z } from 'zod';

/**
 * What travels over the WebSocket.
 *
 * Only ever "this went stale" — never the new data. A frame carrying the change
 * itself would be a second way to learn what a project is, and the two would
 * disagree the first time one of them was written wrong. The client refetches
 * the query it already has, through the same path it always uses.
 */

/** The families of cached answer a change can invalidate. */
export const INVALIDATION_SCOPES = ['board', 'card', 'projects', 'assets', 'asset'] as const;

export type InvalidationScope = (typeof INVALIDATION_SCOPES)[number];

/**
 * Sent by the client once, naming the project it is looking at.
 *
 * A socket is told what to watch rather than being sent everything the person
 * could see: one board is what a tab has open, and filtering server-side is
 * what stops a busy studio's traffic reaching a tab that would drop it anyway.
 */
export const watchFrameSchema = z.object({
  type: z.literal('watch'),
  projectId: z.string().uuid(),
});

export type WatchFrame = z.infer<typeof watchFrameSchema>;

export const invalidationFrameSchema = z.object({
  type: z.literal('invalidate'),
  projectId: z.string().uuid(),
  scopes: z.array(z.enum(INVALIDATION_SCOPES)).min(1),
  /** Present when one card in particular changed, so its panel can refetch. */
  cardId: z.string().uuid().nullable(),
});

export type InvalidationFrame = z.infer<typeof invalidationFrameSchema>;

/** Sent once a watch has been accepted, so a client knows it is listening. */
export const watchingFrameSchema = z.object({
  type: z.literal('watching'),
  projectId: z.string().uuid(),
});

export const serverFrameSchema = z.discriminatedUnion('type', [
  invalidationFrameSchema,
  watchingFrameSchema,
]);

export type ServerFrame = z.infer<typeof serverFrameSchema>;

/** The Redis channel every invalidation for one account is published on. */
export function getInvalidationChannel(accountId: string): string {
  return `lpm:invalidate:${accountId}`;
}

/**
 * Which caches a domain event makes stale.
 *
 * Named here rather than in the worker so both sides of the socket agree about
 * what a `board.cardMoved` means without the worker having to know what the
 * browser keeps.
 */
export function getScopesForEvent(eventName: string): readonly InvalidationScope[] {
  if (eventName.startsWith('projects.')) {
    return ['projects'];
  }

  if (eventName.startsWith('assets.')) {
    // The library draws tiles, the panel draws one asset, and the sidebar
    // counts them: a tag shows in two of the three, and a category being
    // deleted rearranges all of them under whoever is reading.
    return ['assets', 'asset', 'projects'];
  }

  if (eventName.startsWith('files.')) {
    // A file could have arrived on a card or on an asset, and the event does
    // not say which. Four refetches on an upload is nothing: an upload is a
    // rare, deliberate act, and getting this wrong means somebody stares at a
    // panel that will not show the picture they just added.
    return ['board', 'card', 'assets', 'asset'];
  }

  if (eventName.startsWith('board.card') || eventName.startsWith('board.subtask')) {
    // A card's chip is on the board, its detail is in its own cache, and the
    // sidebar counts the open ones; a move or a rename shows in all three.
    return ['board', 'card', 'projects'];
  }

  if (eventName === 'board.commented' || eventName === 'scm.linked') {
    // What a repository said shows on the card and nowhere else; no chip on the
    // board carries a commit.
    return ['card'];
  }

  if (eventName.startsWith('board.list')) {
    return ['board'];
  }

  return ['board'];
}
