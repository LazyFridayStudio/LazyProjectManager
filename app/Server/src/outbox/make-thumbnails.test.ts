import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubObjectStore } from '../storage/index.js';
import { createThumbnailMaker } from './make-thumbnails.js';
import type { DomainEventRecord } from './drain-domain-events.js';

const KEY = 'account/file/original.png';

/**
 * The event the drain hands the maker.
 *
 * `accountId` is the seeded one rather than an invention: an announcement is a
 * real row in `domain_event`, and that table means what it says about which
 * account an event belongs to.
 */
function uploadedEvent(
  fileId: string,
  options: { accountId: string; projectId?: string },
): DomainEventRecord {
  return {
    id: '018f0000-0000-7000-8000-0000000000e1',
    accountId: options.accountId,
    aggregateType: 'card',
    aggregateId: '018f0000-0000-7000-8000-0000000000c1',
    name: 'files.uploaded',
    payload:
      options.projectId === undefined ? { fileId } : { fileId, projectId: options.projectId },
    actorId: null,
    occurredAt: new Date(),
  };
}

/** A real PNG, so `sharp` is doing the work rather than a stand-in for it. */
async function createPng(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#eda363' } })
    .png()
    .toBuffer();
}

describe('GIVEN a file that has just been uploaded', () => {
  let testDatabase: TestDatabase;
  let storage: ReturnType<typeof createStubObjectStore>;
  let accountId: string;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.truncateAllTables();
    storage = createStubObjectStore();
    accountId = (await seedInstall(testDatabase.database)).accountId;
  });

  async function seedFile(options: {
    mime: string;
    bytes?: number;
    state?: 'pending' | 'stored';
  }): Promise<string> {
    const file = await testDatabase.database
      .insertInto('file')
      .values({
        accountId,
        storageKey: KEY,
        filename: 'original.png',
        mime: options.mime,
        bytes: options.bytes ?? 1_000,
        state: options.state ?? 'stored',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return file.id;
  }

  async function thumbnailKeyOf(fileId: string): Promise<string | null> {
    const file = await testDatabase.database
      .selectFrom('file')
      .select('thumbnailKey')
      .where('id', '=', fileId)
      .executeTakeFirstOrThrow();

    return file.thumbnailKey;
  }

  describe('WHEN it is an image', () => {
    it('THEN a thumbnail is written and recorded', async () => {
      const fileId = await seedFile({ mime: 'image/png' });
      storage.putBytes(KEY, await createPng(), 'image/png');

      await createThumbnailMaker(testDatabase.database, storage).handle(
        uploadedEvent(fileId, { accountId }),
      );

      const key = await thumbnailKeyOf(fileId);

      expect(key).toBe(`${KEY}.thumb.webp`);
      expect(await storage.describe(key ?? '')).toMatchObject({ mime: 'image/webp' });
    });

    it('THEN it is bounded rather than cropped, so every screen can crop it its own way', async () => {
      const fileId = await seedFile({ mime: 'image/png' });
      storage.putBytes(KEY, await createPng(2400, 400), 'image/png');

      await createThumbnailMaker(testDatabase.database, storage).handle(
        uploadedEvent(fileId, { accountId }),
      );

      const written = await storage.read(`${KEY}.thumb.webp`);
      const meta = await sharp(written ?? Buffer.alloc(0)).metadata();

      // A 6:1 banner comes back 6:1. Cropping here to one shape is what made an
      // asset's square reference thumbnail a slice of the middle of the picture.
      expect(meta).toMatchObject({ format: 'webp', width: 640, height: 107 });
    });

    it('THEN a picture smaller than the box is left at its own size', async () => {
      const fileId = await seedFile({ mime: 'image/png' });
      storage.putBytes(KEY, await createPng(96, 96), 'image/png');

      await createThumbnailMaker(testDatabase.database, storage).handle(
        uploadedEvent(fileId, { accountId }),
      );

      const written = await storage.read(`${KEY}.thumb.webp`);
      const meta = await sharp(written ?? Buffer.alloc(0)).metadata();

      // A 96px icon blown up to 640 is a blurry 96px icon in a bigger file.
      expect(meta).toMatchObject({ format: 'webp', width: 96, height: 96 });
    });
  });

  describe('WHEN the thumbnail has been made', () => {
    const PROJECT_ID = '018f0000-0000-7000-8000-0000000000b1';

    async function announcements(): Promise<string[]> {
      const rows = await testDatabase.database
        .selectFrom('domainEvent')
        .select('name')
        .where('name', '=', 'files.thumbnailed')
        .execute();

      return rows.map((row) => row.name);
    }

    it('THEN it says so, because nothing else would tell a screen it exists', async () => {
      const fileId = await seedFile({ mime: 'image/png' });
      storage.putBytes(KEY, await createPng(), 'image/png');

      await createThumbnailMaker(testDatabase.database, storage).handle(
        uploadedEvent(fileId, { accountId, projectId: PROJECT_ID }),
      );

      // The picture appears the moment it is uploaded, but the tile is still
      // pointed at a forty-megabyte file until something says a small one is
      // ready — and somebody else's tab never heard about the upload at all.
      expect(await announcements()).toEqual(['files.thumbnailed']);
    });

    it('THEN a file that hangs on nothing is not announced, since nothing watches it', async () => {
      const fileId = await seedFile({ mime: 'image/png' });
      storage.putBytes(KEY, await createPng(), 'image/png');

      await createThumbnailMaker(testDatabase.database, storage).handle(
        uploadedEvent(fileId, { accountId }),
      );

      expect(await announcements()).toEqual([]);
    });

    it('THEN nothing is announced for something that was never thumbnailed', async () => {
      const fileId = await seedFile({ mime: 'application/x-blender' });
      storage.putBytes(KEY, Buffer.from('not an image'), 'application/x-blender');

      await createThumbnailMaker(testDatabase.database, storage).handle(
        uploadedEvent(fileId, { accountId, projectId: PROJECT_ID }),
      );

      expect(await announcements()).toEqual([]);
    });
  });

  describe('WHEN it is a file with no picture in it', () => {
    it('THEN it is left alone rather than retried forever', async () => {
      // A .blend is not a broken image. A queue that kept trying would stall
      // behind the first one somebody uploaded.
      const fileId = await seedFile({ mime: 'application/x-blender' });
      storage.putBytes(KEY, Buffer.from('not an image at all'), 'application/x-blender');

      await expect(
        createThumbnailMaker(testDatabase.database, storage).handle(
          uploadedEvent(fileId, { accountId }),
        ),
      ).resolves.toBeUndefined();

      expect(await thumbnailKeyOf(fileId)).toBeNull();
    });

    it('THEN something claiming to be an image and failing to decode is the same', async () => {
      const fileId = await seedFile({ mime: 'image/png' });
      storage.putBytes(KEY, Buffer.from('PNG in name only'), 'image/png');

      await expect(
        createThumbnailMaker(testDatabase.database, storage).handle(
          uploadedEvent(fileId, { accountId }),
        ),
      ).resolves.toBeUndefined();

      expect(await thumbnailKeyOf(fileId)).toBeNull();
    });
  });

  describe('WHEN it is larger than is worth pulling through the worker', () => {
    it('THEN no thumbnail is made', async () => {
      const fileId = await seedFile({ mime: 'image/png', bytes: 300 * 1024 * 1024 });
      storage.putBytes(KEY, await createPng(), 'image/png');

      await createThumbnailMaker(testDatabase.database, storage).handle(
        uploadedEvent(fileId, { accountId }),
      );

      expect(await thumbnailKeyOf(fileId)).toBeNull();
    });
  });

  describe('WHEN the event is about something else', () => {
    it('THEN nothing happens', async () => {
      const fileId = await seedFile({ mime: 'image/png' });
      storage.putBytes(KEY, await createPng(), 'image/png');

      await createThumbnailMaker(testDatabase.database, storage).handle({
        ...uploadedEvent(fileId, { accountId }),
        name: 'board.cardMoved',
      });

      expect(await thumbnailKeyOf(fileId)).toBeNull();
    });
  });

  describe('WHEN the object is not in the store', () => {
    it('THEN it is left without one rather than throwing', async () => {
      const fileId = await seedFile({ mime: 'image/png' });

      await expect(
        createThumbnailMaker(testDatabase.database, storage).handle(
          uploadedEvent(fileId, { accountId }),
        ),
      ).resolves.toBeUndefined();

      expect(await thumbnailKeyOf(fileId)).toBeNull();
    });
  });
});
