import { z } from 'zod';

import { defineCommand } from '../../envelope/command-definition.js';
import { filenameSchema, mimeSchema, uploadBytesSchema } from '../file-vocabulary.js';

/**
 * What a file is being uploaded for.
 *
 * A union rather than an optional card id, because these are genuinely different
 * things: an attachment hangs off a card, an asset gathers reference images and
 * separately the working files it is made of, and a project's key art and logo
 * are each one picture it either has or does not. Naming them apart here is
 * what stops a single nullable field meaning all of them.
 */
export const uploadTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cardAttachment'), cardId: z.string().uuid() }),
  z.object({ kind: z.literal('projectKeyArt'), projectId: z.string().uuid() }),
  z.object({ kind: z.literal('projectLogo'), projectId: z.string().uuid() }),
  z.object({ kind: z.literal('assetReference'), assetId: z.string().uuid() }),
  z.object({ kind: z.literal('assetFile'), assetId: z.string().uuid() }),
  // Whoever is asking, so there is nothing to name. A person changes their own
  // picture and nobody else's — an id here would be an invitation to try.
  z.object({ kind: z.literal('userAvatar') }),
  /*
   * An agent's picture, which somebody else has to choose for it.
   *
   * The one exception to the rule above, and it exists because an agent cannot
   * take the picture itself: it has no session, no screen and no way to sign
   * in, so "whoever is asking" can never be the thing being drawn. Whoever may
   * manage the install's people sets it, and the id is checked to be an agent —
   * this is not a way to change a colleague's picture.
   */
  z.object({ kind: z.literal('agentAvatar'), userId: z.string().uuid() }),
]);

export type UploadTarget = z.infer<typeof uploadTargetSchema>;

/**
 * Asks for somewhere to put a file.
 *
 * Returns the id of a row in `pending`, which the browser then `PUT`s the bytes
 * to at `/api/f/{id}`. It was a presigned URL at the store's own address until
 * #172, when that turned out to point at a port a released install does not
 * publish — one hostname now, and the browser never addresses the store.
 *
 * The size is declared here only so an obviously impossible upload is refused
 * before anything crosses the network. What is actually recorded is read back
 * from the store when the upload is confirmed.
 */
export const requestUploadCommand = defineCommand(
  'files.requestUpload',
  z.object({
    target: uploadTargetSchema,
    filename: filenameSchema,
    mime: mimeSchema,
    bytes: uploadBytesSchema,
  }),
);

/**
 * Says the upload finished.
 *
 * The server checks the store rather than believing this: a file the browser
 * claims to have sent and did not would otherwise show on a card as something
 * nobody can open.
 */
export const confirmUploadCommand = defineCommand(
  'files.confirmUpload',
  z.object({ fileId: z.string().uuid() }),
);

/**
 * Takes a file off a card.
 *
 * The object stays in the store: the same file can be attached to more than one
 * card, and deleting the bytes because one of them let go would break the
 * others.
 */
export const detachFileCommand = defineCommand(
  'files.detach',
  z.object({ attachmentId: z.string().uuid() }),
);
