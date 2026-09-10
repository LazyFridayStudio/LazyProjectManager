import type { DatabaseTransaction } from '@lpm/database';

import { POSITION_STEP } from '../domain/index.js';
import { buildStorageKey, type ObjectStore } from '../storage/index.js';
import {
  DEMO_ASSET_PICTURES,
  DEMO_AVATARS,
  DEMO_CARD_SHEETS,
  DEMO_KEY_ART,
  DEMO_LOGO,
  DEMO_OWNER_AVATAR,
  type DemoPicture,
} from './art/demo-pictures.js';

/**
 * Puts the demo's pictures in the store and hangs them on the things they are
 * pictures of.
 *
 * The demo used to seed no files at all, which meant every screen that draws a
 * picture drew a filename instead: the launcher said the project's name in
 * letters, the library was a grid of grey boxes, and the people on the board
 * were monograms. None of that is what the product looks like once somebody has
 * used it for a week.
 *
 * SVG rather than PNG, and made here rather than committed: the pictures are a
 * few hundred lines of arithmetic (see `art/`), they are the same bytes on every
 * run, and a screenshot taken at any size is sharp. No thumbnail is made for
 * them — the largest is a hundred and thirty kilobytes, and `/api/f/<id>` sends
 * the original when there is no smaller one.
 *
 * Everything is matched by name, as the rest of the seed is, and nothing is
 * overwritten: a project that already has key art keeps it, and an asset
 * somebody has since put a real reference on is left alone.
 */

/** What the store is told these are, and what the browser draws them as. */
const PICTURE_MIME = 'image/svg+xml';

export interface SeedArtworkRequest {
  readonly transaction: DatabaseTransaction;
  readonly accountId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly storage: ObjectStore;
  readonly today: Date;
  /** The demo teammates, by the initials the fixture refers to them by. */
  readonly people: Map<string, string>;
}

/** How many pictures this run added, which is nought on a second run. */
export async function seedDemoArtwork(request: SeedArtworkRequest): Promise<number> {
  const madeForProject = await dressTheProject(request);
  const madeForLibrary = await dressTheLibrary(request);
  const madeForPeople = await dressThePeople(request);
  const madeForCards = await pinSheetsToCards(request);

  return madeForProject + madeForLibrary + madeForPeople + madeForCards;
}

/** The key art on the launcher tile, and the mark beside the project's name. */
async function dressTheProject(request: SeedArtworkRequest): Promise<number> {
  const project = await request.transaction
    .selectFrom('project')
    .select(['id', 'keyArtFileId', 'logoFileId'])
    .where('id', '=', request.projectId)
    .executeTakeFirstOrThrow();

  let made = 0;

  // Only when there is nothing there: somebody may have chosen their own since,
  // and a top-up that replaced it would be a seed undoing a person's work.
  if (project.keyArtFileId === null) {
    const keyArt = await findOrCreatePicture(request, DEMO_KEY_ART);

    await request.transaction
      .updateTable('project')
      .set({ keyArtFileId: keyArt.id })
      .where('id', '=', project.id)
      .execute();

    made += keyArt.isNew ? 1 : 0;
  }

  if (project.logoFileId === null) {
    const logo = await findOrCreatePicture(request, DEMO_LOGO);

    await request.transaction
      .updateTable('project')
      .set({ logoFileId: logo.id })
      .where('id', '=', project.id)
      .execute();

    made += logo.isNew ? 1 : 0;
  }

  return made;
}

/**
 * A picture on every asset, which is what makes the library a library.
 *
 * The first reference on an asset is the one its tile draws, so an asset that
 * already has any is left alone entirely rather than having one added behind
 * whatever somebody put there.
 */
async function dressTheLibrary(request: SeedArtworkRequest): Promise<number> {
  const assets = await request.transaction
    .selectFrom('asset')
    .select(['id', 'name'])
    .where('projectId', '=', request.projectId)
    .execute();

  const assetsByName = new Map(assets.map((asset) => [asset.name, asset.id]));
  let made = 0;

  for (const picture of DEMO_ASSET_PICTURES) {
    const assetId = assetsByName.get(picture.name);

    if (assetId === undefined) continue;

    const alreadyThere = await request.transaction
      .selectFrom('assetReference')
      .select('id')
      .where('assetId', '=', assetId)
      .executeTakeFirst();

    if (alreadyThere !== undefined) continue;

    const file = await findOrCreatePicture(request, picture);

    await request.transaction
      .insertInto('assetReference')
      .values({
        accountId: request.accountId,
        assetId,
        fileId: file.id,
        position: POSITION_STEP,
      })
      .execute();

    made += file.isNew ? 1 : 0;
  }

  return made;
}

/**
 * A face for everybody on the board, instead of a row of monograms.
 *
 * The owner as well as the seeded five: they reported every card and every
 * asset in the demo, so an install where the only initials left are theirs is a
 * demo with one person missing from it.
 */
async function dressThePeople(request: SeedArtworkRequest): Promise<number> {
  const faces = [
    ...DEMO_AVATARS.map((avatar) => ({
      userId: request.people.get(avatar.initials),
      picture: avatar.picture,
    })),
    { userId: request.ownerId, picture: DEMO_OWNER_AVATAR },
  ];

  let made = 0;

  for (const face of faces) {
    if (face.userId === undefined) continue;

    const person = await request.transaction
      .selectFrom('appUser')
      .select('avatarFileId')
      .where('id', '=', face.userId)
      .executeTakeFirst();

    // A picture already there is somebody's own choice, and this leaves it.
    if (person?.avatarFileId !== null) continue;

    const file = await findOrCreatePicture(request, face.picture);

    await request.transaction
      .updateTable('appUser')
      .set({ avatarFileId: file.id })
      .where('id', '=', face.userId)
      .execute();

    made += file.isNew ? 1 : 0;
  }

  return made;
}

/** The two cards that have a sheet pinned to them, so the files tab has one. */
async function pinSheetsToCards(request: SeedArtworkRequest): Promise<number> {
  let made = 0;

  for (const sheet of DEMO_CARD_SHEETS) {
    const card = await request.transaction
      .selectFrom('card')
      .select('id')
      .where('projectId', '=', request.projectId)
      .where('title', '=', sheet.cardTitle)
      .executeTakeFirst();

    if (card === undefined) continue;

    const alreadyThere = await request.transaction
      .selectFrom('cardAttachment')
      .select('id')
      .where('cardId', '=', card.id)
      .executeTakeFirst();

    if (alreadyThere !== undefined) continue;

    const file = await findOrCreatePicture(request, sheet.picture);

    await request.transaction
      .insertInto('cardAttachment')
      .values({ cardId: card.id, fileId: file.id })
      .execute();

    made += file.isNew ? 1 : 0;
  }

  return made;
}

/**
 * The file row and the object behind it, or the ones a previous run made.
 *
 * Matched on the filename within the account, which is enough because these
 * names are this module's own and no upload goes near them.
 *
 * The object is written inside the seed's transaction, which is the one thing
 * here that cannot be rolled back. An abandoned object in the bucket costs a few
 * kilobytes and is pointed at by nothing; the alternative — a row that says
 * `stored` with no bytes behind it — is a broken picture on a screen.
 */
async function findOrCreatePicture(
  request: SeedArtworkRequest,
  picture: DemoPicture,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await request.transaction
    .selectFrom('file')
    .select('id')
    .where('accountId', '=', request.accountId)
    .where('filename', '=', picture.filename)
    .executeTakeFirst();

  if (existing !== undefined) {
    return { id: existing.id, isNew: false };
  }

  const body = Buffer.from(picture.svg, 'utf8');

  const file = await request.transaction
    .insertInto('file')
    .values({
      accountId: request.accountId,
      // Replaced below: the real key needs the id the database just made.
      storageKey: crypto.randomUUID(),
      filename: picture.filename,
      mime: PICTURE_MIME,
      bytes: body.byteLength,
      width: picture.width,
      height: picture.height,
      state: 'stored',
      // Null, as it is for every file this server made rather than one somebody
      // sent. Nobody uploaded these.
      uploadedBy: null,
      storedAt: request.today,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const storageKey = buildStorageKey(request.accountId, file.id, picture.filename);

  await request.transaction
    .updateTable('file')
    .set({ storageKey })
    .where('id', '=', file.id)
    .execute();

  await request.storage.write(storageKey, body, PICTURE_MIME);

  return { id: file.id, isNew: true };
}
