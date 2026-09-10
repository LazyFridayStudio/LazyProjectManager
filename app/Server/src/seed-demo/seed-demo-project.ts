import type { Database, DatabaseTransaction } from '@lpm/database';
import { countWords } from '@lpm/shared';

import { ConflictError, DEFAULT_LISTS, deriveProjectSlug, POSITION_STEP } from '../domain/index.js';
import { allocateCardKey } from '../modules/board/cards/card-keys.js';
import {
  DEMO_LEGENDS,
  DEMO_LISTS,
  DEMO_PEOPLE,
  DEMO_PERMISSION_GROUPS,
  DEMO_PROJECT,
  DEMO_TEAMS,
  type DemoCard,
  type DemoPerson,
} from './demo-fixture.js';
import {
  DEMO_CATEGORIES,
  DEMO_DOCUMENTS,
  DEMO_MILESTONES,
  DEMO_RELEASES,
  type DemoCategory,
} from './demo-library.js';
import { allocateAssetKey } from '../modules/assets/asset-keys.js';
import { seedDemoArtwork } from './seed-demo-art.js';
import type { ObjectStore } from '../storage/index.js';

/**
 * A password hash no password matches.
 *
 * The demo teammates exist so the board has faces on it, not so anybody can sign
 * in as them. They are seeded `invited`, which is the state a person is in
 * before they have accepted, and there is no credential that would let them
 * past the login screen.
 */
const UNMATCHABLE_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2VlZHNlZWRzZWVk$notarealhash';

/**
 * What this run added, not what the demo contains.
 *
 * A top-up that reported the whole fixture every time would say it made five
 * milestones on a run that made none, which is the sort of number somebody
 * stops reading.
 */
export interface SeedDemoResult {
  readonly projectId: string;
  readonly slug: string;
  readonly cardsCreated: number;
  readonly peopleCreated: number;
  readonly assetsCreated: number;
  readonly milestonesCreated: number;
  readonly documentWords: number;
  readonly releasesCreated: number;
  readonly cardsGathered: number;
  readonly teamsCreated: number;
  readonly permissionGroupsCreated: number;
  readonly picturesCreated: number;
}

/**
 * Fills one account with the demo studio.
 *
 * Never runs on its own: `pnpm seed:demo` is the only caller, because an install
 * that invented a project the first time it started would be an install nobody
 * could trust to be empty.
 *
 * Tops up rather than refusing. Everything is looked up by name first and left
 * alone if it is already there, so running it again after the demo has grown a
 * new screen fills in what that screen needs without disturbing anything
 * somebody has since typed. Nothing here deletes.
 *
 * Without a store it seeds everything but the pictures, which is what a test
 * that only cares about the board wants. `pnpm seed:demo` always hands one over:
 * a demo with no key art, no library tiles and no faces is a demo of the empty
 * states rather than of the product.
 */
export async function seedDemoProject(
  database: Database,
  today: Date,
  storage?: ObjectStore,
): Promise<SeedDemoResult> {
  const account = await database
    .selectFrom('account')
    .select('id')
    .orderBy('createdAt')
    .executeTakeFirst();

  if (account === undefined) {
    throw new ConflictError(
      'This install has not been set up yet. Create the owner account first.',
    );
  }

  const owner = await database
    .selectFrom('membership')
    .select('userId')
    .where('accountId', '=', account.id)
    .where('role', '=', 'owner')
    .orderBy('createdAt')
    .executeTakeFirstOrThrow();

  return database
    .transaction()
    .execute((transaction) =>
      seed({ transaction, accountId: account.id, ownerId: owner.userId, today, storage }),
    );
}

interface SeedRequest {
  readonly transaction: DatabaseTransaction;
  readonly accountId: string;
  readonly ownerId: string;
  readonly today: Date;
  /** Absent when the caller has no store, which is a demo without pictures. */
  readonly storage?: ObjectStore | undefined;
}

async function seed(request: SeedRequest): Promise<SeedDemoResult> {
  const people = await createPeople(request);
  const project = await findOrCreateProject(request);

  await addPeopleToProject(request, project.id, people.byInitials);

  const milestones = await createMilestones(request, project.id);

  return {
    projectId: project.id,
    slug: project.slug,
    peopleCreated: people.created,
    milestonesCreated: milestones.created,
    cardsCreated: await createCards(request, project.id, {
      people: people.byInitials,
      milestones: milestones.byName,
    }),
    assetsCreated: await createLibrary(request, project.id, people.byInitials),
    documentWords: await createDocument(request, project.id, people.byInitials),
    releasesCreated: await createReleases(request, project.id),
    cardsGathered: await gatherUnderLegends(request, project.id),
    ...(await createTeamsAndPermissions(request, people.byInitials)),
    // Last, because a picture hangs on a card, an asset or a person, and all
    // three have to exist before there is anything to hang it on.
    picturesCreated: await createPictures(request, project.id, people.byInitials),
  };
}

/**
 * The pictures, once there is something to hang each of them on.
 *
 * Nought when the caller had no store to put them in, which is the only reason
 * this is a function rather than a call.
 */
async function createPictures(
  request: SeedRequest,
  projectId: string,
  people: Map<string, string>,
): Promise<number> {
  if (request.storage === undefined) return 0;

  return seedDemoArtwork({
    transaction: request.transaction,
    accountId: request.accountId,
    projectId,
    ownerId: request.ownerId,
    storage: request.storage,
    today: request.today,
    people,
  });
}

/**
 * Puts the chunk work under the legend that gathers it.
 *
 * After the cards, and by title, because a legend is a relation between two of
 * them and both have to exist first. A card that is already under a legend is
 * left alone: somebody may have moved it since, and this tops up rather than
 * insisting.
 */
async function gatherUnderLegends(request: SeedRequest, projectId: string): Promise<number> {
  const cards = new Map(
    (
      await request.transaction
        .selectFrom('card')
        .select(['id', 'title', 'legendId'])
        .where('projectId', '=', projectId)
        .execute()
    ).map((card) => [card.title, card]),
  );

  let gathered = 0;

  for (const legend of DEMO_LEGENDS) {
    const gatherer = cards.get(legend.legend);

    if (gatherer === undefined) continue;

    for (const title of legend.gathers) {
      const card = cards.get(title);

      if (card === undefined) continue;

      // Already under one: somebody may have moved it since, and this tops up
      // rather than insisting.
      if (card.legendId !== null) continue;

      await request.transaction
        .updateTable('card')
        .set({ legendId: gatherer.id })
        .where('id', '=', card.id)
        .execute();

      gathered += 1;
    }
  }

  return gathered;
}

/**
 * The teams the demo comes with, and what each may do.
 *
 * Both together, because a permission group held by nobody governs nobody and
 * a demo of one would be a demo of a screen rather than of the feature. Matched
 * by name throughout, as everything else here is.
 */
async function createTeamsAndPermissions(
  request: SeedRequest,
  people: Map<string, string>,
): Promise<{ teamsCreated: number; permissionGroupsCreated: number }> {
  const teams = new Map<string, string>();
  let teamsCreated = 0;

  for (const team of DEMO_TEAMS) {
    const found = await findOrCreateTeam(request, team.name);

    teams.set(team.name, found.id);
    teamsCreated += found.isNew ? 1 : 0;

    for (const initials of team.members) {
      const userId = people.get(initials);

      if (userId === undefined) continue;

      await request.transaction
        .insertInto('teamMember')
        .values({ teamId: found.id, userId })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }
  }

  let permissionGroupsCreated = 0;

  for (const group of DEMO_PERMISSION_GROUPS) {
    const found = await findOrCreateGroup(request, group.name);

    permissionGroupsCreated += found.isNew ? 1 : 0;

    for (const rule of group.rules) {
      await request.transaction
        .insertInto('permissionRule')
        .values({
          accountId: request.accountId,
          groupId: found.id,
          action: rule.subject,
          effect: rule.effect,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }

    for (const teamName of group.heldBy) {
      const teamId = teams.get(teamName);

      if (teamId === undefined) continue;

      await request.transaction
        .insertInto('teamPermissionGroup')
        .values({ accountId: request.accountId, teamId, groupId: found.id })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }
  }

  return { teamsCreated, permissionGroupsCreated };
}

async function findOrCreateTeam(
  request: SeedRequest,
  name: string,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await request.transaction
    .selectFrom('team')
    .select('id')
    .where('accountId', '=', request.accountId)
    .where('name', '=', name)
    .executeTakeFirst();

  if (existing !== undefined) {
    return { id: existing.id, isNew: false };
  }

  const created = await request.transaction
    .insertInto('team')
    .values({ accountId: request.accountId, name })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { id: created.id, isNew: true };
}

async function findOrCreateGroup(
  request: SeedRequest,
  name: string,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await request.transaction
    .selectFrom('permissionGroup')
    .select('id')
    .where('accountId', '=', request.accountId)
    .where('name', '=', name)
    .executeTakeFirst();

  if (existing !== undefined) {
    return { id: existing.id, isNew: false };
  }

  const created = await request.transaction
    .insertInto('permissionGroup')
    .values({ accountId: request.accountId, name })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { id: created.id, isNew: true };
}

/**
 * What the project has shipped.
 *
 * Matched by tag, as everything else here is matched by name: a demo made
 * before this page existed can be topped up for it, and one somebody has since
 * written release notes into keeps them.
 */
async function createReleases(request: SeedRequest, projectId: string): Promise<number> {
  const existing = new Set(
    (
      await request.transaction
        .selectFrom('projectRelease')
        .select('tag')
        .where('projectId', '=', projectId)
        .execute()
    ).map((release) => release.tag),
  );

  let made = 0;

  for (const release of DEMO_RELEASES) {
    if (existing.has(release.tag)) continue;

    const created = await request.transaction
      .insertInto('projectRelease')
      .values({
        accountId: request.accountId,
        projectId,
        tag: release.tag,
        name: release.name,
        publishedOn: calendarDay(request.today, -release.publishedDaysAgo),
        author: release.author,
        commitSha: release.commitSha,
        isPrerelease: release.isPrerelease,
        notes: release.notes,
        runLabel: release.runLabel,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (release.assets.length > 0) {
      await request.transaction
        .insertInto('releaseAsset')
        .values(
          release.assets.map((asset, index) => ({
            accountId: request.accountId,
            releaseId: created.id,
            name: asset.name,
            sizeBytes: asset.sizeBytes,
            downloadCount: asset.downloadCount,
            downloadUrl: asset.downloadUrl,
            position: (index + 1) * POSITION_STEP,
          })),
        )
        .execute();
    }

    made += 1;
  }

  return made;
}

/**
 * The board, and the work on it.
 *
 * Cards are matched by title: a seed run after somebody has renamed one will
 * make a second, which is the honest outcome — it cannot tell a rename from a
 * card that was never there.
 */
async function createCards(
  request: SeedRequest,
  projectId: string,
  cast: { readonly people: Map<string, string>; readonly milestones: Map<string, string> },
): Promise<number> {
  const { people, milestones } = cast;
  const lists = await findOrCreateBoard(request, projectId);
  const existing = new Set(
    (
      await request.transaction
        .selectFrom('card')
        .select('title')
        .where('projectId', '=', projectId)
        .execute()
    ).map((card) => card.title),
  );

  // Everything with a date on it belongs to whichever milestone is running, so
  // the burndown and the by-milestone timeline have something to count.
  const running = milestones.get('Vertical slice') ?? null;

  let cardCount = 0;

  for (const [listIndex, demoList] of DEMO_LISTS.entries()) {
    const listId = lists[listIndex];

    if (listId === undefined) continue;

    // Which list a card is in is its status; `closed_at` is when it stopped
    // being open. A card sitting in Done that nothing ever closed leaves every
    // burndown on the demo reading nought.
    const isDone = demoList.name === 'Done';

    for (const [cardIndex, card] of demoList.cards.entries()) {
      if (existing.has(card.title)) continue;

      const cardKey = await allocateCardKey({
        database: request.transaction,
        projectId,
        projectCode: DEMO_PROJECT.code,
        cardType: card.type,
      });

      await request.transaction
        .insertInto('card')
        .values({
          accountId: request.accountId,
          projectId,
          listId,
          cardKey,
          reporterId: request.ownerId,
          milestoneId: card.dueInDays === null ? null : running,
          position: (cardIndex + 1) * POSITION_STEP,
          ...cardValues({ card, index: cardIndex, isDone, people, today: request.today }),
        })
        .execute();

      cardCount += 1;
    }
  }

  return cardCount;
}

/** The dates the project is held to, by name. */
async function createMilestones(
  request: SeedRequest,
  projectId: string,
): Promise<{ byName: Map<string, string>; created: number }> {
  const byName = new Map<string, string>();
  let created = 0;

  for (const milestone of DEMO_MILESTONES) {
    const existing = await request.transaction
      .selectFrom('milestone')
      .select('id')
      .where('projectId', '=', projectId)
      .where('name', '=', milestone.name)
      .executeTakeFirst();

    if (existing !== undefined) {
      byName.set(milestone.name, existing.id);
      continue;
    }

    const made = await request.transaction
      .insertInto('milestone')
      .values({
        accountId: request.accountId,
        projectId,
        name: milestone.name,
        goal: milestone.goal,
        startsOn: calendarDay(request.today, milestone.startsInDays),
        shipsOn: calendarDay(request.today, milestone.shipsInDays),
        capacityPoints: milestone.capacityPoints,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    byName.set(milestone.name, made.id);
    created += 1;
  }

  return { byName, created };
}

/** The library: categories, and the things filed under them. */
async function createLibrary(
  request: SeedRequest,
  projectId: string,
  people: Map<string, string>,
): Promise<number> {
  let assetCount = 0;

  for (const [index, category] of DEMO_CATEGORIES.entries()) {
    const categoryId = await findOrCreateCategory(request, projectId, { category, index });

    assetCount += await createAssets({ request, projectId, categoryId, category, people });
  }

  return assetCount;
}

async function findOrCreateCategory(
  request: SeedRequest,
  projectId: string,
  placed: { readonly category: DemoCategory; readonly index: number },
): Promise<string> {
  const { category, index } = placed;
  const existing = await request.transaction
    .selectFrom('assetCategory')
    .select('id')
    .where('projectId', '=', projectId)
    .where('name', '=', category.name)
    .executeTakeFirst();

  if (existing !== undefined) return existing.id;

  const created = await request.transaction
    .insertInto('assetCategory')
    .values({
      accountId: request.accountId,
      projectId,
      name: category.name,
      color: category.color,
      budgetMinor: category.budgetMinor,
      position: (index + 1) * POSITION_STEP,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return created.id;
}

interface AssetRequest {
  readonly request: SeedRequest;
  readonly projectId: string;
  readonly categoryId: string;
  readonly category: DemoCategory;
  readonly people: Map<string, string>;
}

async function createAssets(input: AssetRequest): Promise<number> {
  const { request, projectId, categoryId, category, people } = input;

  const existing = new Set(
    (
      await request.transaction
        .selectFrom('asset')
        .select('name')
        .where('projectId', '=', projectId)
        .execute()
    ).map((asset) => asset.name),
  );

  let made = 0;

  for (const [index, asset] of category.assets.entries()) {
    if (existing.has(asset.name)) continue;

    const assetKey = await allocateAssetKey({
      database: request.transaction,
      projectId,
      projectCode: DEMO_PROJECT.code,
    });

    const created = await request.transaction
      .insertInto('asset')
      .values({
        accountId: request.accountId,
        projectId,
        categoryId,
        assetKey,
        name: asset.name,
        status: asset.status,
        estimatedCostMinor: asset.estimatedCostMinor,
        assigneeId: asset.assignee === null ? null : (people.get(asset.assignee) ?? null),
        // Whoever set the install up, as the demo cards are raised by. A
        // library where every Reporter reads "—" would demonstrate the field
        // by leaving it empty.
        reporterId: request.ownerId,
        dueOn: asset.dueInDays === null ? null : calendarDay(request.today, asset.dueInDays),
        position: (index + 1) * POSITION_STEP,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (asset.tags.length > 0) {
      await request.transaction
        .insertInto('assetTag')
        .values(
          asset.tags.map((tag) => ({
            accountId: request.accountId,
            assetId: created.id,
            tag,
          })),
        )
        .execute();
    }

    made += 1;
  }

  return made;
}

/**
 * The project's documents, written once.
 *
 * Left alone if the project already keeps any, so a top-up never overwrites
 * what somebody has since written.
 */
async function createDocument(
  request: SeedRequest,
  projectId: string,
  people: Map<string, string>,
): Promise<number> {
  const existing = new Set(
    (
      await request.transaction
        .selectFrom('projectDoc')
        .select('title')
        .where('projectId', '=', projectId)
        .execute()
    ).map((document) => document.title),
  );

  let words = 0;

  for (const [index, document] of DEMO_DOCUMENTS.entries()) {
    // By title, as everything else here is. A document somebody has since
    // written in keeps what is in it; one that was never made gets made, which
    // is what lets a demo be filled in after a new document is added to it.
    if (existing.has(document.title)) continue;

    await request.transaction
      .insertInto('projectDoc')
      .values({
        accountId: request.accountId,
        projectId,
        title: document.title,
        body: document.body,
        // Whoever owns it, so the header says three different names across the
        // three documents rather than the same one three times.
        updatedBy: people.get(document.writtenBy) ?? request.ownerId,
        position: (index + 1) * POSITION_STEP,
      })
      .execute();

    words += countWords(document.body);
  }

  return words;
}

/**
 * Puts the demo teammates on the project, with a day each.
 *
 * Without this the timeline is one row: capacity is per project, and somebody
 * who is in the account but not on the project has no hours here to plan with.
 */
async function addPeopleToProject(
  request: SeedRequest,
  projectId: string,
  people: Map<string, string>,
): Promise<void> {
  const already = new Set(
    (
      await request.transaction
        .selectFrom('projectMember')
        .select('userId')
        .where('projectId', '=', projectId)
        .execute()
    ).map((member) => member.userId),
  );

  for (const userId of people.values()) {
    if (already.has(userId)) continue;

    await request.transaction
      .insertInto('projectMember')
      .values({
        projectId,
        userId,
        role: 'member',
      })
      .execute();
  }
}

/**
 * Creates the demo teammates, or reuses them if a previous seed already did.
 *
 * Keyed by initials, because that is what the fixture's cards refer to.
 */
async function createPeople(
  request: SeedRequest,
): Promise<{ byInitials: Map<string, string>; created: number }> {
  const byInitials = new Map<string, string>();
  let created = 0;

  for (const person of DEMO_PEOPLE) {
    const found = await findOrCreatePerson(request, person);

    byInitials.set(person.initials, found.id);
    created += found.isNew ? 1 : 0;
  }

  return { byInitials, created };
}

async function findOrCreatePerson(
  request: SeedRequest,
  person: DemoPerson,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await request.transaction
    .selectFrom('appUser')
    .select('id')
    .where('email', '=', person.email)
    .executeTakeFirst();

  if (existing !== undefined) {
    return { id: existing.id, isNew: false };
  }

  const created = await request.transaction
    .insertInto('appUser')
    .values({
      email: person.email,
      passwordHash: UNMATCHABLE_PASSWORD_HASH,
      displayName: person.displayName,
      initials: person.initials,
      status: 'invited',
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await request.transaction
    .insertInto('membership')
    .values({ accountId: request.accountId, userId: created.id, role: 'member' })
    .execute();

  return { id: created.id, isNew: true };
}

async function findOrCreateProject(request: SeedRequest): Promise<{ id: string; slug: string }> {
  const existing = await request.transaction
    .selectFrom('project')
    .select(['id', 'slug'])
    .where('accountId', '=', request.accountId)
    .where('code', '=', DEMO_PROJECT.code)
    .executeTakeFirst();

  if (existing !== undefined) return existing;

  const project = await request.transaction
    .insertInto('project')
    .values({
      accountId: request.accountId,
      name: DEMO_PROJECT.name,
      code: DEMO_PROJECT.code,
      slug: deriveProjectSlug(DEMO_PROJECT.name),
      engine: DEMO_PROJECT.engine,
      phase: DEMO_PROJECT.phase,
      budgetMinor: DEMO_PROJECT.budgetMinor,
      startsOn: calendarDay(request.today, DEMO_PROJECT.startsInDays),
      shipsOn: calendarDay(request.today, DEMO_PROJECT.shipsInDays),
      datesTbd: false,
    })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();

  await request.transaction
    .insertInto('cardSequence')
    .values(
      (['ART', 'TASK', 'BUG', 'BUILD'] as const).map((prefix) => ({
        projectId: project.id,
        prefix,
      })),
    )
    .execute();

  await request.transaction
    .insertInto('projectMember')
    .values({ projectId: project.id, userId: request.ownerId, role: 'owner' })
    .execute();

  return project;
}

/** Returns the ids of the project's lists, in the order they were declared. */
async function findOrCreateBoard(request: SeedRequest, projectId: string): Promise<string[]> {
  const existingBoard = await request.transaction
    .selectFrom('board')
    .select('id')
    .where('projectId', '=', projectId)
    .executeTakeFirst();

  if (existingBoard !== undefined) {
    const lists = await request.transaction
      .selectFrom('list')
      .select('id')
      .where('boardId', '=', existingBoard.id)
      .orderBy('position')
      .execute();

    return lists.map((list) => list.id);
  }

  const board = await request.transaction
    .insertInto('board')
    .values({ projectId })
    .returning('id')
    .executeTakeFirstOrThrow();

  const lists = await request.transaction
    .insertInto('list')
    .values(
      DEFAULT_LISTS.map((list) => ({
        boardId: board.id,
        name: list.name,
        color: list.color,
        wipLimit: list.wipLimit,
        position: list.position,
      })),
    )
    .returning('id')
    .execute();

  return lists.map((list) => list.id);
}

interface CardValues {
  readonly card: DemoCard;
  readonly index: number;
  readonly isDone: boolean;
  readonly people: Map<string, string>;
  readonly today: Date;
}

/** The parts of a card that come from the fixture rather than from the board. */
function cardValues({ card, index, isDone, people, today }: CardValues) {
  return {
    title: card.title,
    type: card.type,
    priority: card.priority,
    points: card.points,
    // Four hours a point, the same rate the timeline reads points at, so the
    // chart has bars rather than a column of unestimated rows.
    estimateMinutes: card.points === null ? null : card.points * 4 * 60,
    assigneeId: card.assignee === null ? null : (people.get(card.assignee) ?? null),
    // One in seven stuck, so the dashboard has a number to be alarmed by. Never
    // a finished one: a card that was stuck and then shipped is history rather
    // than something to act on.
    blocked: !isDone && index % 7 === 3,
    closedAt: isDone ? closedDay(today, index) : null,
    dueOn: card.dueInDays === null ? null : calendarDay(today, card.dueInDays),
    isLegend: card.isLegend ?? false,
  };
}

/**
 * When a finished card was finished: spread over the last fortnight.
 *
 * All of them closed at the same instant would be a project where nothing
 * happened until one afternoon.
 */
function closedDay(today: Date, index: number): Date {
  return new Date(today.getTime() - (index + 1) * 2 * 86_400_000);
}

/** A `YYYY-MM-DD` day, a number of days either side of today. */
function calendarDay(today: Date, offsetDays: number): string {
  const day = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offsetDays),
  );

  return day.toISOString().slice(0, 10);
}
