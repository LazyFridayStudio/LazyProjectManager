import { createSortableId, type Database } from '@lpm/database';
import sharp from 'sharp';

import type { ObjectStore } from '../storage/index.js';
import type { DomainEventConsumer, DomainEventRecord } from './drain-domain-events.js';

/**
 * The box a thumbnail is made to fit inside.
 *
 * Bounded rather than cropped. This was a 16:7 crop when a launcher tile was the
 * only thing that drew one; an asset's reference sheet draws the same file at
 * 16:10 and again as a square, and a 16:7 crop of a character render is a slice
 * of its chest. Every screen already crops with `object-fit`, so fitting inside
 * the box keeps the whole picture and lets each one take the shape it needs.
 *
 * Square, so a portrait is bounded as tightly as a landscape.
 */
const THUMBNAIL_BOX = 640;

/**
 * The largest file worth pulling through this process to resize.
 *
 * The worker downloads the whole object to make a thumbnail, which is the one
 * place bytes come through here at all. A 4GB source file would cost minutes and
 * a great deal of memory to produce a 640px image nobody would look at closely.
 */
const LARGEST_WORTH_RESIZING_BYTES = 200 * 1024 * 1024;

/**
 * Makes a thumbnail for an uploaded image.
 *
 * Anything it cannot decode is left alone rather than retried: a `.blend` is not
 * a broken image, it is a file with no picture in it, and a queue that kept
 * trying would stall behind the first one somebody uploaded.
 */
export function createThumbnailMaker(
  database: Database,
  storage: ObjectStore,
): DomainEventConsumer {
  return {
    name: 'thumbnails',

    async handle(event: DomainEventRecord): Promise<void> {
      if (event.name !== 'files.uploaded') {
        return;
      }

      const fileId = readFileId(event);

      if (fileId === null) {
        return;
      }

      const file = await database
        .selectFrom('file')
        .select(['id', 'storageKey', 'mime', 'bytes'])
        .where('id', '=', fileId)
        .where('state', '=', 'stored')
        .executeTakeFirst();

      if (file === undefined || !isWorthResizing(file.mime, file.bytes)) {
        return;
      }

      const original = await storage.read(file.storageKey);

      if (original === null) {
        return;
      }

      const thumbnail = await resize(original);

      if (thumbnail === null) {
        // Something with an image media type that is not an image after all.
        // Recorded as having no thumbnail, which is what a screen reads as
        // "draw the filename".
        return;
      }

      const thumbnailKey = `${file.storageKey}.thumb.webp`;

      await storage.write(thumbnailKey, thumbnail, 'image/webp');

      await database.updateTable('file').set({ thumbnailKey }).where('id', '=', file.id).execute();

      await announceThumbnail(database, event);
    },
  };
}

/**
 * Says a thumbnail now exists, so whoever is looking at it finds out.
 *
 * The picture itself appears the moment it is uploaded — the query hands back
 * the original until this has run — but the tile and the panel are still
 * pointing at a forty-megabyte file, and nothing would have told them a small
 * one is ready. This is also the only thing that reaches somebody else's tab,
 * where the upload never happened at all.
 *
 * An event rather than a Redis publish, because the drain that called this is
 * the thing that turns events into invalidations, and a second path to the same
 * socket is a second path to keep in step.
 */
async function announceThumbnail(database: Database, uploaded: DomainEventRecord): Promise<void> {
  const payload = uploaded.payload as { projectId?: unknown };

  if (typeof payload.projectId !== 'string') {
    // Nothing is watching a file that hangs on nothing.
    return;
  }

  await database
    .insertInto('domainEvent')
    .values({
      // Time-ordered, as every event is: the drain reads them in the order they
      // happened rather than in whatever order a uuid falls in.
      id: createSortableId(),
      accountId: uploaded.accountId,
      aggregateType: uploaded.aggregateType,
      aggregateId: uploaded.aggregateId,
      name: 'files.thumbnailed',
      payload: JSON.stringify({ projectId: payload.projectId }),
      actorId: null,
    })
    .execute();
}

/**
 * Whether this is a file with a picture in it, small enough to be worth it.
 *
 * The media type is what the browser said, so it is a hint rather than a fact —
 * `resize` is what actually decides, by failing.
 */
function isWorthResizing(mime: string, bytes: string | null): boolean {
  if (!mime.startsWith('image/')) {
    return false;
  }

  return bytes === null || Number(bytes) <= LARGEST_WORTH_RESIZING_BYTES;
}

/**
 * Returns null rather than throwing when the bytes are not a picture.
 *
 * A file nothing can decode is an outcome, not a failure: letting it throw would
 * mark the event unprocessed and the drain would offer it again forever.
 */
async function resize(original: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(original)
      // Never upscaled: a 96px icon blown up to 640 is a blurry 96px icon in a
      // file six times the size.
      .resize(THUMBNAIL_BOX, THUMBNAIL_BOX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    return null;
  }
}

function readFileId(event: DomainEventRecord): string | null {
  const payload = event.payload as { fileId?: unknown };

  return typeof payload.fileId === 'string' ? payload.fileId : null;
}
