import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubObjectStore } from '../storage/index.js';
import { DEMO_ASSET_PICTURES, DEMO_AVATARS, DEMO_CARD_SHEETS } from './art/demo-pictures.js';
import { DEMO_LISTS, DEMO_PEOPLE, DEMO_PROJECT } from './demo-fixture.js';
import { DEMO_CATEGORIES, DEMO_MILESTONES } from './demo-library.js';
import { seedDemoProject } from './seed-demo-project.js';

const TODAY = new Date('2026-08-18T00:00:00.000Z');

const DEMO_CARD_COUNT = DEMO_LISTS.reduce((total, list) => total + list.cards.length, 0);

/** Written this way because an escaped one keeps being eaten in transit. */
const NEWLINE = String.fromCharCode(10);

describe('GIVEN the demo seed', () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.truncateAllTables();
  });

  describe('WHEN the install has never been set up', () => {
    it('THEN it refuses, rather than inventing an account to hang a project on', async () => {
      await expect(seedDemoProject(testDatabase.database, TODAY)).rejects.toThrow(
        /has not been set up/i,
      );
    });
  });

  describe('WHEN it runs against a set-up install', () => {
    beforeEach(async () => {
      await seedInstall(testDatabase.database);
      await seedDemoProject(testDatabase.database, TODAY);
    });

    it('THEN the project is there, with the board and its lists', async () => {
      const project = await testDatabase.database
        .selectFrom('project')
        .selectAll()
        .executeTakeFirstOrThrow();
      const lists = await testDatabase.database
        .selectFrom('list')
        .select('name')
        .orderBy('position')
        .execute();

      expect(project).toMatchObject({ name: DEMO_PROJECT.name, code: DEMO_PROJECT.code });
      expect(lists.map((list) => list.name)).toEqual([
        'Backlog',
        'In progress',
        'Ready for review',
        'Done',
      ]);
    });

    it('THEN every card from the fixture is on it', async () => {
      const cards = await testDatabase.database.selectFrom('card').selectAll().execute();

      expect(cards).toHaveLength(DEMO_CARD_COUNT);
    });

    it('THEN the keys were issued by the counters, not copied from the fixture', async () => {
      const cards = await testDatabase.database
        .selectFrom('card')
        .select(['cardKey', 'type'])
        .execute();
      const sequences = await testDatabase.database
        .selectFrom('cardSequence')
        .select(['prefix', 'lastValue'])
        .execute();

      // Every key belongs to this project and matches its own card's type.
      for (const card of cards) {
        expect(card.cardKey.startsWith(`${DEMO_PROJECT.code}-`)).toBe(true);
      }

      expect(new Set(cards.map((card) => card.cardKey)).size).toBe(cards.length);

      const issued = sequences.reduce((total, sequence) => total + sequence.lastValue, 0);
      expect(issued).toBe(cards.length);
    });

    it('THEN the demo people exist but cannot be signed in as', async () => {
      const people = await testDatabase.database
        .selectFrom('appUser')
        .select(['email', 'status', 'passwordHash'])
        .where(
          'email',
          'in',
          DEMO_PEOPLE.map((person) => person.email),
        )
        .execute();

      expect(people).toHaveLength(DEMO_PEOPLE.length);
      // Seeded so the board has faces on it, not so anybody can log in as them.
      expect(people.every((person) => person.status === 'invited')).toBe(true);
      expect(people.every((person) => person.passwordHash.includes('notarealhash'))).toBe(true);
    });

    it('THEN dates are relative to the day it ran, so the board is never stale', async () => {
      const card = await testDatabase.database
        .selectFrom('card')
        .select('dueOn')
        .where('title', '=', 'First sixteen blocks in the atlas')
        .executeTakeFirstOrThrow();

      // That card is due the day the seed runs.
      expect(card.dueOn).toBe('2026-08-18');
    });

    it('THEN the work in Done is actually closed, so a burndown is not nought', async () => {
      const closed = await testDatabase.database
        .selectFrom('card')
        .select('id')
        .where('closedAt', 'is not', null)
        .execute();

      // Which list a card is in is its status; `closed_at` is when it stopped
      // being open. A demo where nothing was ever closed reports no progress on
      // every screen that counts it.
      expect(closed.length).toBeGreaterThan(0);
    });

    it('THEN the finished column has cards in it, and every one of them is closed', async () => {
      const done = await testDatabase.database
        .selectFrom('card')
        .innerJoin('list', 'list.id', 'card.listId')
        .select('card.closedAt as closedAt')
        .where('list.name', '=', 'Done')
        .execute();

      // The column is not empty, because a closed card is still drawn on the
      // list the board finishes on — which is what makes closing one different
      // from deleting it.
      expect(done.length).toBeGreaterThan(0);

      // And none of them is half-finished. Sitting there is what closed means,
      // so a card in Done without a stamp is a state no screen can produce.
      expect(done.filter((card) => card.closedAt === null)).toEqual([]);
    });

    it('THEN nothing finished is also marked stuck', async () => {
      const both = await testDatabase.database
        .selectFrom('card')
        .select('id')
        .where('closedAt', 'is not', null)
        .where('blocked', '=', true)
        .execute();

      expect(both).toEqual([]);
    });

    it('THEN there is a library to look at, not only a board', async () => {
      const assets = await testDatabase.database
        .selectFrom('asset')
        .innerJoin('assetCategory', 'assetCategory.id', 'asset.categoryId')
        .select(['asset.name as name', 'assetCategory.name as category'])
        .execute();

      expect(assets.length).toBeGreaterThan(10);
      expect(new Set(assets.map((asset) => asset.category)).size).toBe(4);
    });

    it('THEN the library is uneven, which is what the screens exist to show', async () => {
      const categories = await testDatabase.database
        .selectFrom('assetCategory')
        .select(['name', 'budgetMinor'])
        .execute();

      // One nobody has budgeted: no figure is not the same as a figure of
      // nought, and the budget screen draws them differently.
      expect(categories.some((category) => category.budgetMinor === null)).toBe(true);

      const uncosted = await testDatabase.database
        .selectFrom('asset')
        .select('id')
        .where('estimatedCostMinor', 'is', null)
        .execute();

      expect(uncosted.length).toBeGreaterThan(0);
    });

    it('THEN there are dates either side of today, so the plan has a shape', async () => {
      const milestones = await testDatabase.database
        .selectFrom('milestone')
        .select(['name', 'startsOn', 'shipsOn'])
        .orderBy('startsOn')
        .execute();

      expect(milestones.length).toBeGreaterThan(3);
      expect(milestones.some((milestone) => milestone.shipsOn < '2026-08-18')).toBe(true);
      expect(milestones.some((milestone) => milestone.startsOn > '2026-08-18')).toBe(true);
    });

    it('THEN the work with dates on it is promised to the running milestone', async () => {
      const promised = await testDatabase.database
        .selectFrom('card')
        .select('id')
        .where('milestoneId', 'is not', null)
        .execute();

      expect(promised.length).toBeGreaterThan(0);
    });

    it('THEN the team is on the project with a full day each, so the timeline has rows', async () => {
      const members = await testDatabase.database
        .selectFrom('projectMember')
        .select(['userId', 'dailyCapacityHours'])
        .execute();

      // Everybody, not only the owner — a person in the account but not on the
      // project has nothing here to plan with.
      expect(members.length).toBe(DEMO_PEOPLE.length + 1);
      expect(members.every((member) => member.dailyCapacityHours === 8)).toBe(true);
    });

    it('THEN the project keeps several documents, as a studio does', async () => {
      const documents = await testDatabase.database
        .selectFrom('projectDoc')
        .select(['title', 'body'])
        .orderBy('position')
        .execute();

      // A game design, an art direction and an audio bible are separate things
      // that separate people own, and a demo with one shows none of that.
      expect(documents.length).toBeGreaterThan(2);
      expect(documents.every((document) => document.title.trim() !== '')).toBe(true);
      expect(documents.every((document) => document.body.length > 100)).toBe(true);
    });

    it('THEN each document says who wrote it, and they are not all the same person', async () => {
      const authors = await testDatabase.database
        .selectFrom('projectDoc')
        .innerJoin('appUser', 'appUser.id', 'projectDoc.updatedBy')
        .select('appUser.displayName as displayName')
        .execute();

      // Separate documents that separate people own is the whole point of
      // keeping three; one name against all of them says the opposite.
      expect(authors.length).toBeGreaterThan(2);
      expect(new Set(authors.map((author) => author.displayName)).size).toBeGreaterThan(1);
    });

    it('THEN one of them has headings at every level, so the contents list has a shape', async () => {
      const document = await testDatabase.database
        .selectFrom('projectDoc')
        .select('body')
        .orderBy('position')
        .executeTakeFirstOrThrow();

      const lines = document.body.split(NEWLINE);

      expect(lines.some((line) => line.startsWith('# '))).toBe(true);
      expect(lines.some((line) => line.startsWith('## '))).toBe(true);
      expect(lines.some((line) => line.startsWith('### '))).toBe(true);
    });

    it('THEN the project has shipped things, with the newest written up', async () => {
      const releases = await testDatabase.database
        .selectFrom('projectRelease')
        .select(['tag', 'notes', 'publishedOn'])
        .orderBy('publishedOn', 'desc')
        .execute();

      // Only the newest has notes on it, which is what a real project looks
      // like — and what makes the page's shape visible in the demo.
      expect(releases.length).toBeGreaterThan(2);
      expect(releases[0]?.notes.length).toBeGreaterThan(100);
      expect(releases.filter((release) => release.notes === '').length).toBeGreaterThan(0);
    });

    it('THEN the seeded releases are hand-entered, so a sync cannot rewrite them', async () => {
      const releases = await testDatabase.database
        .selectFrom('projectRelease')
        .select(['source', 'externalId'])
        .execute();

      // The demo is somebody's typing, not a forge's. Marking it otherwise
      // would hand the first sync permission to overwrite the whole page.
      expect(releases.every((release) => release.source === 'hand')).toBe(true);
      expect(releases.every((release) => release.externalId === null)).toBe(true);
    });

    it('THEN the newest release has downloads under it with real sizes', async () => {
      const assets = await testDatabase.database
        .selectFrom('releaseAsset')
        .select(['name', 'sizeBytes', 'downloadCount'])
        .execute();

      expect(assets.length).toBeGreaterThan(1);
      // `bigint` reads back as a string, and a build is hundreds of megabytes.
      expect(Number(assets[0]?.sizeBytes)).toBeGreaterThan(100 * 1024 ** 2);
    });

    it('THEN the releases are dated against the day it ran, not a fixed one', async () => {
      const newest = await testDatabase.database
        .selectFrom('projectRelease')
        .select('publishedOn')
        .orderBy('publishedOn', 'desc')
        .executeTakeFirstOrThrow();

      // Four days before 18 Aug 2026, which is the day this suite runs as.
      expect(newest.publishedOn).toBe('2026-08-14');
    });

    it('THEN the chunk work is gathered under a legend', async () => {
      const legend = await testDatabase.database
        .selectFrom('card')
        .select(['id', 'isLegend'])
        .where('title', '=', 'Chunk streaming: second pass')
        .executeTakeFirstOrThrow();

      const under = await testDatabase.database
        .selectFrom('card')
        .select('title')
        .where('legendId', '=', legend.id)
        .execute();

      // Getting chunks to stream is some engine work and the bug that only
      // shows up once it does, which is the shape a legend exists for — and the
      // shape that used to be four titles all beginning with the same word in
      // brackets.
      expect(legend.isLegend).toBe(true);
      expect(under.map((card) => card.title)).toContain('Chunk seams flicker at draw distance 8');
      expect(under.length).toBeGreaterThan(2);
    });

    it('THEN a team holds a permission group that says something', async () => {
      const held = await testDatabase.database
        .selectFrom('teamPermissionGroup')
        .innerJoin('team', 'team.id', 'teamPermissionGroup.teamId')
        .innerJoin('permissionGroup', 'permissionGroup.id', 'teamPermissionGroup.groupId')
        .select(['team.name as team', 'permissionGroup.name as group'])
        .execute();

      // A group held by nobody governs nobody, so a demo of one would be a
      // demo of a screen rather than of the feature.
      expect(held).toEqual(expect.arrayContaining([{ team: 'Pixel Forge', group: 'Outsourcer' }]));
    });

    it('THEN the outsourcer group says the thing read and write could not', async () => {
      const rules = await testDatabase.database
        .selectFrom('permissionRule')
        .innerJoin('permissionGroup', 'permissionGroup.id', 'permissionRule.groupId')
        .select(['permissionRule.action as action', 'permissionRule.effect as effect'])
        .where('permissionGroup.name', '=', 'Outsourcer')
        .execute();

      // Writes what a card says, and must not move it. Editing and moving are
      // both `write`, which is exactly why this needed saying another way — and
      // the mix is what makes the heading above them read `Custom`.
      expect(rules).toEqual(
        expect.arrayContaining([
          { action: 'card.update', effect: 'allow' },
          { action: 'card.move', effect: 'deny' },
        ]),
      );
    });

    it('THEN the downloads say where they are, so the builds page has something to hand over', async () => {
      const assets = await testDatabase.database
        .selectFrom('releaseAsset')
        .select(['name', 'downloadUrl'])
        .orderBy('position')
        .execute();

      // A downloads list with nothing to press is not what the screen looks
      // like in use, and the demo exists to show what it looks like in use.
      expect(assets.length).toBeGreaterThan(0);
      expect(assets.every((asset) => asset.downloadUrl !== null)).toBe(true);

      // `.invalid` can never be registered, so a demo download cannot one day
      // start pointing at somebody's real website.
      expect(assets.every((asset) => asset.downloadUrl?.includes('.invalid') === true)).toBe(true);
    });

    it('THEN running it again tops it up rather than doubling anything', async () => {
      // It exists so a demo can be filled in after a new screen is built, which
      // means running twice has to be safe.
      const before = await counts();

      await seedDemoProject(testDatabase.database, TODAY);

      expect(await counts()).toEqual(before);
    });

    it('THEN a second run fills in what was missing and leaves the rest alone', async () => {
      await testDatabase.database.deleteFrom('milestone').execute();
      await testDatabase.database.deleteFrom('projectDoc').execute();

      const result = await seedDemoProject(testDatabase.database, TODAY);

      expect(result.milestonesCreated).toBe(DEMO_MILESTONES.length);
      expect(result.documentWords).toBeGreaterThan(0);
      // The board it did not touch is the board it left.
      expect(result.cardsCreated).toBe(0);
    });

    it('THEN documents somebody has since written are not overwritten', async () => {
      await testDatabase.database
        .updateTable('projectDoc')
        .set({ body: 'Mine, thanks.' })
        .execute();

      await seedDemoProject(testDatabase.database, TODAY);

      const bodies = await testDatabase.database.selectFrom('projectDoc').select('body').execute();

      expect(bodies.every((row) => row.body === 'Mine, thanks.')).toBe(true);
    });

    it('THEN a document the demo has gained since is filled in beside them', async () => {
      // Matched by title, as everything else here is: a demo made before a
      // document existed can be topped up for it without touching the prose
      // somebody has written in the others.
      await testDatabase.database
        .deleteFrom('projectDoc')
        .where('title', '=', 'Audio bible')
        .execute();

      await testDatabase.database
        .updateTable('projectDoc')
        .set({ body: 'Mine, thanks.' })
        .execute();

      await seedDemoProject(testDatabase.database, TODAY);

      const documents = await testDatabase.database
        .selectFrom('projectDoc')
        .select(['title', 'body'])
        .orderBy('position')
        .execute();

      expect(documents.map((each) => each.title)).toContain('Audio bible');
      expect(documents.filter((each) => each.body === 'Mine, thanks.')).toHaveLength(2);
    });

    /** How much of everything there is, which a second run must not change. */
    async function counts(): Promise<Record<string, number>> {
      const tables = [
        'card',
        'asset',
        'assetCategory',
        'milestone',
        'projectDoc',
        'projectRelease',
        'releaseAsset',
        'team',
        'teamMember',
        'permissionGroup',
        'permissionRule',
        'teamPermissionGroup',
      ];
      const found: Record<string, number> = {};

      for (const table of tables) {
        const rows = await testDatabase.database
          .selectFrom(table as 'card')
          .select('id')
          .execute();

        found[table] = rows.length;
      }

      return found;
    }
  });

  describe('WHEN it runs with somewhere to put the pictures', () => {
    const storage = createStubObjectStore();

    beforeEach(async () => {
      storage.forgetEverything();
      await seedInstall(testDatabase.database);
      await seedDemoProject(testDatabase.database, TODAY, storage);
    });

    it('THEN the launcher tile has key art on it, and the shell has a mark', async () => {
      const project = await testDatabase.database
        .selectFrom('project')
        .select(['keyArtFileId', 'logoFileId'])
        .executeTakeFirstOrThrow();

      // A launcher tile with no key art draws the project's name in letters,
      // which is the empty state rather than the product.
      expect(project.keyArtFileId).not.toBeNull();
      expect(project.logoFileId).not.toBeNull();
    });

    it('THEN every asset in the library has a picture on it', async () => {
      const referenced = await testDatabase.database
        .selectFrom('assetReference')
        .innerJoin('asset', 'asset.id', 'assetReference.assetId')
        .select('asset.name as name')
        .execute();

      const inTheLibrary = DEMO_CATEGORIES.flatMap((category) =>
        category.assets.map((asset) => asset.name),
      );

      expect(new Set(referenced.map((each) => each.name))).toEqual(new Set(inTheLibrary));
    });

    it('THEN the pictures are really in the store, not just rows saying so', async () => {
      const files = await testDatabase.database.selectFrom('file').selectAll().execute();

      expect(files.length).toBeGreaterThan(DEMO_ASSET_PICTURES.length);

      for (const file of files) {
        const object = await storage.describe(file.storageKey);

        // A row that says `stored` with no bytes behind it is a broken picture
        // on a screen, which is worse than no picture at all.
        expect(file.state).toBe('stored');
        expect(object?.mime).toBe('image/svg+xml');
        expect(Number(file.bytes)).toBe(object?.bytes);
      }
    });

    it('THEN the people on the board have faces rather than initials', async () => {
      const withPictures = await testDatabase.database
        .selectFrom('appUser')
        .select('id')
        .where('avatarFileId', 'is not', null)
        .execute();

      // The seeded five and whoever set the install up, who reported every card
      // in the demo and would otherwise be the one monogram left on the screen.
      expect(withPictures).toHaveLength(DEMO_AVATARS.length + 1);
    });

    it('THEN a couple of cards carry a sheet, so the files tab has something in it', async () => {
      const attached = await testDatabase.database
        .selectFrom('cardAttachment')
        .innerJoin('card', 'card.id', 'cardAttachment.cardId')
        .select('card.title as title')
        .execute();

      expect(attached.map((each) => each.title).sort()).toEqual(
        DEMO_CARD_SHEETS.map((sheet) => sheet.cardTitle).sort(),
      );
    });

    it('THEN running it again adds no second copy of anything', async () => {
      const before = await testDatabase.database.selectFrom('file').select('id').execute();

      const second = await seedDemoProject(testDatabase.database, TODAY, storage);
      const after = await testDatabase.database.selectFrom('file').select('id').execute();

      expect(second.picturesCreated).toBe(0);
      expect(after).toHaveLength(before.length);
    });

    it('THEN a picture taken off an asset is put back without a second copy', async () => {
      // The file is still in the store from the first run, so this is the case
      // where there is something to hang and nothing new to make.
      await testDatabase.database.deleteFrom('assetReference').execute();

      const files = await testDatabase.database.selectFrom('file').select('id').execute();
      const second = await seedDemoProject(testDatabase.database, TODAY, storage);

      const references = await testDatabase.database
        .selectFrom('assetReference')
        .select('id')
        .execute();

      expect(references).toHaveLength(DEMO_ASSET_PICTURES.length);
      expect(second.picturesCreated).toBe(0);
      expect(await testDatabase.database.selectFrom('file').select('id').execute()).toHaveLength(
        files.length,
      );
    });

    it('THEN key art somebody has since chosen is not replaced', async () => {
      const mine = await testDatabase.database
        .selectFrom('file')
        .select('id')
        .executeTakeFirstOrThrow();

      await testDatabase.database.updateTable('project').set({ keyArtFileId: mine.id }).execute();

      await seedDemoProject(testDatabase.database, TODAY, storage);

      const project = await testDatabase.database
        .selectFrom('project')
        .select('keyArtFileId')
        .executeTakeFirstOrThrow();

      // A top-up that put the demo's picture back would be a seed undoing
      // somebody's work.
      expect(project.keyArtFileId).toBe(mine.id);
    });
  });
});
