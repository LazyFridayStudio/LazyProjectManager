import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { PermissionsView } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubObjectStore } from '../../storage/index.js';
import { createStubRedis } from '../../testing/index.js';
import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { hashPassword } from '../identity/password-hasher.js';

const PASSWORD = 'correct-horse-battery';
const OWNER_EMAIL = 'jake@northwind.test';
const MIRA_EMAIL = 'mira@northwind.test';

const testEnvironment = readEnvironment({
  NODE_ENV: 'test',
  BASE_URL: 'http://localhost:24571',
  DATABASE_URL: 'postgres://unused',
  REDIS_URL: 'redis://unused',
  S3_ENDPOINT: 'http://unused:9000',
  S3_BUCKET: 'lpm-test',
  S3_ACCESS_KEY: 'unused',
  S3_SECRET_KEY: 'unused',
});

let commandCounter = 0;

function nextCommandId(): string {
  commandCounter += 1;
  return `018f9999-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

/**
 * Permission groups, and what they do to somebody trying to work.
 *
 * The half that matters is the last describe: a rule is only worth anything if
 * the command it names actually refuses. Everything above it is the machinery
 * for saying the rule.
 */
describe('GIVEN an install with a team and a project', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  let passwordHash: string;
  let ownerCookie: string;
  let miraCookie: string;
  let miraId: string;
  let teamId: string;
  let projectId: string;
  let listId: string;

  const redis = createStubRedis();

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    passwordHash = await hashPassword(PASSWORD);
    server = await createServer({
      environment: testEnvironment,
      database: testDatabase.database,
      redis,
      storage: createStubObjectStore(),
    });
  });

  afterAll(async () => {
    await server.close();
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.truncateAllTables();
    redis.forgetEverything();

    await seedInstall(testDatabase.database, {
      email: OWNER_EMAIL,
      passwordHash,
      displayName: 'Jake Winters',
    });

    ownerCookie = await signIn(OWNER_EMAIL);
    miraId = await addPerson('Mira Kaur', MIRA_EMAIL);
    teamId = await makeTeam('Environment art');
    await command('teams.addMember', { teamId, userId: miraId });

    const project = await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' });
    projectId = project.json<{ id: string }>().id;

    /*
     * Mira is on the project, so the tests below are about *what* she may do
     * rather than *where*.
     *
     * Being on it is what reaching it means now. A team used to be able to
     * grant a project, which was a second answer to a question the project
     * membership already answered — a permission group says what somebody may
     * do, and it says nothing about which boards they can see.
     */
    await testDatabase.database
      .insertInto('projectMember')
      .values({ projectId, userId: miraId, role: 'member' })
      .execute();

    const board = await readBoard();
    listId = board.lists[0]?.id ?? '';

    // Signed in after the team, so the session carries the rules the team has.
    miraCookie = await signIn(MIRA_EMAIL);
  });

  async function command(
    name: string,
    body: Record<string, unknown>,
    cookie = ownerCookie,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject({
      method: 'POST',
      url: `/api/c/${name}`,
      payload: { commandId: nextCommandId(), ...body },
      cookies: { lpm_session: cookie },
    });
  }

  async function signIn(email: string): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/c/identity.signIn',
      payload: { commandId: nextCommandId(), email, password: PASSWORD },
    });

    return readSessionCookie(response.cookies);
  }

  async function addPerson(displayName: string, email: string, role = 'member'): Promise<string> {
    const response = await command('identity.createUser', {
      email,
      displayName,
      role,
      password: PASSWORD,
    });

    return response.json<{ id: string }>().id;
  }

  async function makeTeam(name: string): Promise<string> {
    return (await command('teams.create', { name })).json<{ id: string }>().id;
  }

  /** What this team holds and where each sits, in the order the panel draws. */
  async function placesInTheList(): Promise<{ name: string; position: number }[]> {
    const { groups } = await readPermissions();

    return groups
      .flatMap((group) => {
        const holder = group.teams.find((team) => team.id === teamId);

        return holder === undefined ? [] : [{ name: group.name, position: holder.position }];
      })
      .sort((first, second) => first.position - second.position);
  }

  async function makeGroup(name: string): Promise<string> {
    return (await command('permissions.createGroup', { name })).json<{ id: string }>().id;
  }

  async function readPermissions(cookie = ownerCookie): Promise<PermissionsView> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/permissions.groups',
      cookies: { lpm_session: cookie },
    });

    return response.json<{ data: PermissionsView }>().data;
  }

  async function readBoard(): Promise<{ lists: { id: string }[] }> {
    const response = await server.inject({
      method: 'GET',
      url: '/api/q/board.view?slug=drowned-reach',
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: { lists: { id: string }[] } }>().data;
  }

  /** Sets a rule and signs Mira in again, because rules ride on the session. */
  async function ruleForMira(subject: string, effect: string | null): Promise<void> {
    const groupId = await makeGroup(`Group for ${subject} ${String(effect)}`);

    await command('permissions.setRule', { groupId, subject, effect });
    await command('permissions.setTeamGroup', { teamId, groupId, held: true });

    miraCookie = await signIn(MIRA_EMAIL);
  }

  describe('WHEN a group is made', () => {
    it('THEN it is on the list, saying nothing and held by nobody', async () => {
      await makeGroup('Outsourcer');

      const [group] = (await readPermissions()).groups;

      // Empty on purpose: a group with rules already in it would be this
      // product having an opinion about somebody else's studio.
      expect(group).toMatchObject({ name: 'Outsourcer', rules: [], teams: [] });
    });

    it('THEN a second by the same name, in any case, is refused on the field', async () => {
      await makeGroup('Outsourcer');

      const response = await command('permissions.createGroup', { name: 'OUTSOURCER' });
      const failure = response.json<{ code: string; fields?: Record<string, string> }>();

      expect(failure.code).toBe('CONFLICT');
      expect(failure.fields?.name).toBe('That name is taken.');
    });
  });

  describe('WHEN the screen asks what a rule can be about', () => {
    it('THEN every action the policy knows is filed under a catalogue', async () => {
      const { catalogues } = await readPermissions();
      const filed = catalogues.flatMap((catalogue) => catalogue.actions.map((one) => one.value));

      // Derived from the policy rather than listed in the contract, so an
      // action added to the product appears here the same day.
      expect(filed).toContain('card.move');
      expect(filed).toContain('user.manage');

      // A partition: one switch per fact, never two.
      expect(new Set(filed).size).toBe(filed.length);
    });

    it('THEN a catalogue is a heading and never a rule', async () => {
      const { catalogues } = await readPermissions();
      const board = catalogues.find((catalogue) => catalogue.value === 'catalog.board');

      expect(board?.label).toBe('Board and cards');
      expect(board?.actions.map((one) => one.value)).toContain('card.move');

      // The point of the redesign: a heading that could also be stored is a
      // heading that can disagree with what is under it.
      const response = await command('permissions.setRule', {
        groupId: await makeGroup('Tries a heading'),
        subject: 'catalog.board',
        effect: 'allow',
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json<{ message: string }>().message).toContain('not something a rule');
    });

    it('THEN each action says what it lets somebody do', async () => {
      const { catalogues } = await readPermissions();
      const actions = catalogues.flatMap((catalogue) => catalogue.actions);

      /*
       * A sentence, not a word count.
       *
       * "Make a new card." is a complete answer and padding it to hit a length
       * would make the test the reason for worse copy. What matters is that
       * every one of them is written and finished — a permission nobody can
       * explain is a permission nobody gives out correctly.
       */
      expect(actions.every((action) => action.description.trim().endsWith('.'))).toBe(true);
      expect(actions.find((action) => action.value === 'card.move')?.label).toBe('Move — card');

      // And the ones with a consequence say the consequence, rather than
      // restating their own name.
      expect(actions.find((action) => action.value === 'card.move')?.description).toContain(
        'schedule',
      );
    });
  });

  describe('WHEN a rule is set on a group', () => {
    it('THEN it comes back on the group', async () => {
      const groupId = await makeGroup('Outsourcer');

      await command('permissions.setRule', { groupId, subject: 'card.move', effect: 'deny' });

      expect((await readPermissions()).groups[0]?.rules).toEqual([
        { subject: 'card.move', effect: 'deny' },
      ]);
    });

    it('THEN setting it again replaces it rather than saying both', async () => {
      const groupId = await makeGroup('Outsourcer');

      await command('permissions.setRule', { groupId, subject: 'card.move', effect: 'deny' });
      await command('permissions.setRule', { groupId, subject: 'card.move', effect: 'allow' });

      expect((await readPermissions()).groups[0]?.rules).toEqual([
        { subject: 'card.move', effect: 'allow' },
      ]);
    });

    it('THEN clearing it is not the same as denying it', async () => {
      const groupId = await makeGroup('Outsourcer');

      await command('permissions.setRule', { groupId, subject: 'card.move', effect: 'deny' });
      await command('permissions.setRule', { groupId, subject: 'card.move', effect: null });

      expect((await readPermissions()).groups[0]?.rules).toEqual([]);
    });

    it('THEN a subject nothing checks is refused', async () => {
      const groupId = await makeGroup('Outsourcer');

      const response = await command('permissions.setRule', {
        groupId,
        subject: 'card.destroy',
        effect: 'allow',
      });

      // A rule naming an action nothing checks is a permission that silently
      // does nothing, which is the worst way for one to be wrong.
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json<{ message: string }>().message).toContain('not something a rule');
    });
  });

  describe('WHEN a group is given to a team', () => {
    it('THEN the group says which teams hold it', async () => {
      const groupId = await makeGroup('Outsourcer');

      await command('permissions.setTeamGroup', { teamId, groupId, held: true });

      // First in that team's list, because it is the only one in it.
      expect((await readPermissions()).groups[0]?.teams).toEqual([
        { id: teamId, name: 'Environment art', position: 1 },
      ]);
    });

    it('THEN a second group goes on the end of the list rather than in front', async () => {
      const first = await makeGroup('Everything');
      const second = await makeGroup('Almost everything');

      await command('permissions.setTeamGroup', { teamId, groupId: first, held: true });
      await command('permissions.setTeamGroup', { teamId, groupId: second, held: true });

      // In the order they were given, not alphabetically — which is the point
      // of a position: a list somebody can arrange.
      expect(await placesInTheList()).toEqual([
        { name: 'Everything', position: 1 },
        { name: 'Almost everything', position: 2 },
      ]);
    });

    it('THEN dragging one rewrites the order for that team', async () => {
      const first = await makeGroup('Everything');
      const second = await makeGroup('Almost everything');

      await command('permissions.setTeamGroup', { teamId, groupId: first, held: true });
      await command('permissions.setTeamGroup', { teamId, groupId: second, held: true });

      await command('permissions.orderTeamGroups', { teamId, groupIds: [second, first] });

      expect(await placesInTheList()).toEqual([
        { name: 'Almost everything', position: 1 },
        { name: 'Everything', position: 2 },
      ]);
    });

    it('THEN a group the team no longer holds is ignored rather than refused', async () => {
      const held = await makeGroup('Everything');
      const gone = await makeGroup('Almost everything');

      await command('permissions.setTeamGroup', { teamId, groupId: held, held: true });

      /*
       * The list arrives from a screen drawn a moment ago. Somebody taking a
       * group off the team in between should not turn a drag into an error —
       * the drag was about the ones that are left.
       */
      const response = await command('permissions.orderTeamGroups', {
        teamId,
        groupIds: [gone, held],
      });

      expect(response.statusCode).toBe(200);
      expect(await placesInTheList()).toEqual([{ name: 'Everything', position: 2 }]);
    });

    it('THEN giving it twice leaves one', async () => {
      const groupId = await makeGroup('Outsourcer');

      await command('permissions.setTeamGroup', { teamId, groupId, held: true });
      const again = await command('permissions.setTeamGroup', { teamId, groupId, held: true });

      expect(again.json()).toMatchObject({ ok: true });
      expect((await readPermissions()).groups[0]?.teams).toHaveLength(1);
    });

    it('THEN taking it back leaves the group', async () => {
      const groupId = await makeGroup('Outsourcer');

      await command('permissions.setTeamGroup', { teamId, groupId, held: true });
      await command('permissions.setTeamGroup', { teamId, groupId, held: false });

      expect((await readPermissions()).groups[0]).toMatchObject({ name: 'Outsourcer', teams: [] });
    });

    it('THEN deleting the group takes the hold with it', async () => {
      const groupId = await makeGroup('Outsourcer');

      await command('permissions.setTeamGroup', { teamId, groupId, held: true });
      await command('permissions.deleteGroup', { groupId });

      expect((await readPermissions()).groups).toEqual([]);
    });
  });

  /**
   * The half that matters.
   *
   * A rule is only worth something if the command it names refuses. Everything
   * above this is the machinery for saying the rule.
   */
  describe('WHEN somebody in the team tries to work', () => {
    async function moveACard(cookie: string): Promise<number> {
      const card = await command('board.createCard', {
        projectId,
        listId,
        title: 'Crane retopo',
        type: 'task',
      });
      const cardId = card.json<{ id: string }>().id;

      const moved = await command(
        'board.moveCard',
        { cardId, toListId: listId, beforeCardId: null },
        cookie,
      );

      return moved.statusCode;
    }

    it('THEN with no groups at all they work exactly as before', async () => {
      // The property that makes this safe to introduce: an install that has not
      // touched permissions behaves as it did yesterday.
      expect(await moveACard(miraCookie)).toBe(200);
    });

    it('THEN a denied action is refused, though the role allows it', async () => {
      await ruleForMira('card.move', 'deny');

      expect(await moveACard(miraCookie)).toBe(403);
    });

    it('THEN a group given to the person beats one their team holds', async () => {
      // A team says what a job does. Somebody handed a group by name is being
      // spoken about personally, and that is the statement that stands.
      await ruleForMira('card.move', 'deny');
      expect(await moveACard(miraCookie)).toBe(403);

      const hers = await makeGroup('Mira may move cards');

      await command('permissions.setRule', {
        groupId: hers,
        subject: 'card.move',
        effect: 'allow',
      });
      await command('permissions.setUserGroup', { userId: miraId, groupId: hers, held: true });

      miraCookie = await signIn(MIRA_EMAIL);

      expect(await moveACard(miraCookie)).toBe(200);
    });

    it('THEN it beats it the other way too, which is the half worth checking', async () => {
      // An override that only ever widened would be no override at all.
      const teamMay = await makeGroup('The team may move cards');

      await command('permissions.setRule', {
        groupId: teamMay,
        subject: 'card.move',
        effect: 'allow',
      });
      await command('permissions.setTeamGroup', { teamId, groupId: teamMay, held: true });

      const notHer = await makeGroup('Mira may not move cards');

      await command('permissions.setRule', {
        groupId: notHer,
        subject: 'card.move',
        effect: 'deny',
      });
      await command('permissions.setUserGroup', { userId: miraId, groupId: notHer, held: true });

      miraCookie = await signIn(MIRA_EMAIL);

      expect(await moveACard(miraCookie)).toBe(403);
    });

    it('THEN a group of her own about something else leaves the team alone', async () => {
      // Silence is not permission, and it is not refusal either.
      await ruleForMira('card.move', 'deny');

      const elsewhere = await makeGroup('Mira may record releases');

      await command('permissions.setRule', {
        groupId: elsewhere,
        subject: 'release.record',
        effect: 'allow',
      });
      await command('permissions.setUserGroup', { userId: miraId, groupId: elsewhere, held: true });

      miraCookie = await signIn(MIRA_EMAIL);

      expect(await moveACard(miraCookie)).toBe(403);
    });

    it('THEN somebody may write cards without being allowed to unmake them', async () => {
      await ruleForMira('card.delete', 'deny');

      const card = await command(
        'board.createCard',
        { projectId, listId, title: 'Crane retopo', type: 'task' },
        miraCookie,
      );

      // The whole reason deleting a card is its own action rather than part of
      // `card.update`: a studio can hand out one of these and not the other.
      expect(card.statusCode).toBe(200);

      const deleted = await command(
        'board.deleteCard',
        { cardId: card.json<{ id: string }>().id },
        miraCookie,
      );

      expect(deleted.statusCode).toBe(403);
    });

    it('THEN somebody may fill the library in without being allowed to empty it', async () => {
      await ruleForMira('asset.delete', 'deny');

      const categoryId = (
        await command('assets.createCategory', {
          projectId,
          name: 'Environment Props',
          color: '#63aeeb',
        })
      ).json<{ id: string }>().id;
      const asset = await command(
        'assets.createAsset',
        { projectId, categoryId, name: 'Ruined watchtower' },
        miraCookie,
      );

      expect(asset.statusCode).toBe(200);

      const assetId = asset.json<{ id: string }>().id;
      const panel = await server.inject({
        method: 'GET',
        url: `/api/q/assets.detail?assetId=${assetId}`,
        cookies: { lpm_session: miraCookie },
      });

      // The panel asks the same policy the command does, so there is no Delete
      // button for her to press and be refused by.
      expect(panel.json<{ data: { canDelete: boolean } }>().data.canDelete).toBe(false);

      const deleted = await command('assets.deleteAsset', { assetId }, miraCookie);

      expect(deleted.statusCode).toBe(403);
    });

    it('THEN denying each action under a heading refuses each of them', async () => {
      // What pressing Deny on a catalogue writes: one rule per action. The
      // heading itself is never stored, so this is the whole of its meaning.
      await ruleForMira('card.move', 'deny');

      expect(await moveACard(miraCookie)).toBe(403);
    });

    it('THEN an allowed action is permitted, though the role does not reach it', async () => {
      // `board.manageList` wants a lead. Mira is a member.
      const beforeRule = await command(
        'board.createList',
        { boardId: await boardId(), name: 'In outsourcing', color: '#cf9556' },
        miraCookie,
      );

      expect(beforeRule.statusCode).toBe(403);

      await ruleForMira('board.manageList', 'allow');

      const afterRule = await command(
        'board.createList',
        { boardId: await boardId(), name: 'In outsourcing', color: '#cf9556' },
        miraCookie,
      );

      expect(afterRule.json()).toMatchObject({ ok: true });
    });

    it('THEN allowing a whole heading and denying one of its actions says both', async () => {
      const groupId = await makeGroup('The board, except moving');
      const { catalogues } = await readPermissions();
      const board = catalogues.find((catalogue) => catalogue.value === 'catalog.board');

      // Exactly what the screen does when Allow is pressed on a heading and
      // then one child is switched to Deny. There is one rule per action, so
      // nothing has to rank a heading against a specific rule.
      for (const action of board?.actions ?? []) {
        await command('permissions.setRule', {
          groupId,
          subject: action.value,
          effect: action.value === 'card.move' ? 'deny' : 'allow',
        });
      }

      await command('permissions.setTeamGroup', { teamId, groupId, held: true });
      miraCookie = await signIn(MIRA_EMAIL);

      expect(await moveACard(miraCookie)).toBe(403);
    });

    it('THEN deny beats allow across two groups', async () => {
      const allowing = await makeGroup('Movers');
      const denying = await makeGroup('Look but do not touch');

      await command('permissions.setRule', {
        groupId: allowing,
        subject: 'card.move',
        effect: 'allow',
      });
      await command('permissions.setRule', {
        groupId: denying,
        subject: 'card.move',
        effect: 'deny',
      });
      await command('permissions.setTeamGroup', { teamId, groupId: allowing, held: true });
      await command('permissions.setTeamGroup', { teamId, groupId: denying, held: true });

      miraCookie = await signIn(MIRA_EMAIL);

      // The safe half of a contradiction is the one that refuses.
      expect(await moveACard(miraCookie)).toBe(403);
    });

    it('THEN taking the group back gives the action straight back', async () => {
      await ruleForMira('card.move', 'deny');
      expect(await moveACard(miraCookie)).toBe(403);

      const { groups } = await readPermissions();
      const group = groups.find((each) => each.rules.length > 0);

      await command('permissions.setTeamGroup', { teamId, groupId: group?.id, held: false });
      miraCookie = await signIn(MIRA_EMAIL);

      expect(await moveACard(miraCookie)).toBe(200);
    });

    async function boardId(): Promise<string> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/board.view?slug=drowned-reach',
        cookies: { lpm_session: ownerCookie },
      });

      return response.json<{ data: { boardId: string } }>().data.boardId;
    }
  });

  describe('WHEN the session says what somebody may do', () => {
    async function mayOf(cookie: string): Promise<string[]> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        cookies: { lpm_session: cookie },
      });

      return response.json<{ data: { may: string[] } }>().data.may;
    }

    it('THEN an owner may everything, because every action is theirs by role', async () => {
      const may = await mayOf(ownerCookie);

      expect(may).toEqual(expect.arrayContaining(['audit.view', 'recovery.restore']));
    });

    it('THEN a member may none of the install actions to begin with', async () => {
      const may = await mayOf(miraCookie);

      expect(may).not.toContain('audit.view');
      expect(may).not.toContain('recovery.view');
      expect(may).not.toContain('recovery.restore');
    });

    /*
     * The point of the whole thing: a group hands out one action, and the shell
     * can draw the tab for somebody who is not an owner.
     */
    it('THEN a group that allows the trail puts it in reach of somebody who is not an owner', async () => {
      await ruleForMira('audit.view', 'allow');

      expect(await mayOf(miraCookie)).toContain('audit.view');

      // And only that one. Reading the trail is not being handed the bin.
      expect(await mayOf(miraCookie)).not.toContain('recovery.restore');
    });

    it('THEN reading the bin and restoring from it are handed out separately', async () => {
      await ruleForMira('recovery.view', 'allow');

      const may = await mayOf(miraCookie);

      expect(may).toContain('recovery.view');
      expect(may).not.toContain('recovery.restore');
      expect(may).not.toContain('recovery.purge');
    });

    /*
     * The rule an install can be bricked without.
     *
     * A deny on `team.manage`, given to a team the owners are in, takes away
     * the only way to undo it: the screen that edits the rule is behind the
     * rule. There is no support line to ring on a self-hosted install.
     */
    it('THEN a denial does not reach an owner, because they decide what the groups say', async () => {
      const groupId = await makeGroup('No trail');
      const owner = await testDatabase.database
        .selectFrom('appUser')
        .select('id')
        .where('email', '=', OWNER_EMAIL)
        .executeTakeFirstOrThrow();

      await command('permissions.setRule', { groupId, subject: 'audit.view', effect: 'deny' });
      await command('teams.addMember', { teamId, userId: owner.id });
      await command('permissions.setTeamGroup', { teamId, groupId, held: true });

      // Rules ride on the session, so the owner takes theirs again.
      const afterTheDeny = await signIn(OWNER_EMAIL);

      expect(await mayOf(afterTheDeny)).toContain('audit.view');

      // And the handler agrees, which is the half that matters.
      const trail = await server.inject({
        method: 'GET',
        url: '/api/q/audit.trail',
        cookies: { lpm_session: afterTheDeny },
      });

      expect(trail.statusCode).toBe(200);
    });

    it('THEN the same denial does reach everybody who is not an owner', async () => {
      await ruleForMira('audit.view', 'allow');

      expect(await mayOf(miraCookie)).toContain('audit.view');

      // Allowed by one group and denied by another. Deny still wins for her.
      await ruleForMira('audit.view', 'deny');

      expect(await mayOf(miraCookie)).not.toContain('audit.view');

      const trail = await server.inject({
        method: 'GET',
        url: '/api/q/audit.trail',
        cookies: { lpm_session: miraCookie },
      });

      expect(trail.statusCode).toBe(403);
    });

    it('THEN what the session says and what the handler does are the same answer', async () => {
      await ruleForMira('audit.view', 'allow');

      expect(await mayOf(miraCookie)).toContain('audit.view');

      const trail = await server.inject({
        method: 'GET',
        url: '/api/q/audit.trail',
        cookies: { lpm_session: miraCookie },
      });

      expect(trail.statusCode).toBe(200);
    });
  });

  /**
   * The other half of a rule: a screen somebody may not open is one the sidebar
   * does not draw.
   *
   * Answered on the query the sidebar already asks for its counts, and answered
   * per project rather than per install — an install-wide answer would show a
   * section that then refused on this particular board, which is the same bug
   * moved a step.
   */
  describe('WHEN the sidebar asks which screens of a project somebody may open', () => {
    async function sectionsFor(cookie: string): Promise<string[]> {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/projects.workspace?slug=drowned-reach',
        cookies: { lpm_session: cookie },
      });

      return response.json<{ data: { sections: string[] } }>().data.sections;
    }

    it('THEN an owner is given every one of them', async () => {
      expect(await sectionsFor(ownerCookie)).toEqual([
        'dashboard',
        'assets',
        'board',
        'timeline',
        'builds',
        'budget',
        'docs',
        'settings',
      ]);
    });

    it('THEN a member is given the screens they can work on', async () => {
      const sections = await sectionsFor(miraCookie);

      expect(sections).toContain('board');
      expect(sections).toContain('dashboard');
      expect(sections).toContain('docs');
    });

    /*
     * Settings is the one screen that is not a `.view`, and `project.update` is
     * a lead's. Every control on it is a change — the name, the dates, the
     * pictures, who is on the project — so a member used to arrive at a screen
     * with nothing on it they could press.
     */
    it('THEN a member is not given Settings, which is a screen of changes', async () => {
      expect(await sectionsFor(miraCookie)).not.toContain('settings');
    });

    /*
     * The other half of the same answer. Permission says whether this person
     * may open a section; the project says whether it uses one at all. Both
     * have to say yes, and they are different kinds of fact.
     */
    it('THEN a section the project has switched off is given to nobody, owner included', async () => {
      await testDatabase.database
        .updateTable('project')
        .set({ disabledSections: JSON.stringify(['timeline', 'budget']) })
        .where('id', '=', projectId)
        .execute();

      const sections = await sectionsFor(ownerCookie);

      expect(sections).not.toContain('timeline');
      expect(sections).not.toContain('budget');

      // Everything else is untouched, including the two that cannot be off.
      expect(sections).toEqual(['dashboard', 'assets', 'board', 'builds', 'docs', 'settings']);
    });

    it('THEN permission still wins over a section the project does use', async () => {
      await testDatabase.database
        .updateTable('project')
        .set({ disabledSections: JSON.stringify([]) })
        .where('id', '=', projectId)
        .execute();

      // Switched on for the project, and still not this person's to open.
      expect(await sectionsFor(miraCookie)).not.toContain('settings');
    });

    it('THEN a project that has never touched the setting keeps all eight', async () => {
      expect(await sectionsFor(ownerCookie)).toHaveLength(8);
    });

    it('THEN a denied screen is not given, and the rest still are', async () => {
      await ruleForMira('board.viewList', 'deny');

      const sections = await sectionsFor(miraCookie);

      expect(sections).not.toContain('board');
      // Denying one screen does not take the project away.
      expect(sections).toContain('dashboard');
      expect(sections).toContain('assets');
    });

    it('THEN hiding it grants nothing: the screen behind it refuses either way', async () => {
      await ruleForMira('board.viewList', 'deny');

      const board = await server.inject({
        method: 'GET',
        url: '/api/q/board.view?slug=drowned-reach',
        cookies: { lpm_session: miraCookie },
      });

      expect(board.statusCode).toBe(403);
    });

    /*
     * A group can say yes as well as no. Being *given* a screen has to work the
     * same way, or the sidebar would only ever be able to take doors away.
     */
    it('THEN a screen allowed by a group is given, even above the role', async () => {
      expect(await sectionsFor(miraCookie)).not.toContain('settings');

      await ruleForMira('project.update', 'allow');

      expect(await sectionsFor(miraCookie)).toContain('settings');
    });
  });

  describe('WHEN somebody who is not an admin asks', () => {
    it('THEN the groups are not theirs to read', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/q/permissions.groups',
        cookies: { lpm_session: miraCookie },
      });

      expect(response.statusCode).toBe(403);
    });

    it('THEN they cannot make one either', async () => {
      const response = await command('permissions.createGroup', { name: 'Mine' }, miraCookie);

      expect(response.statusCode).toBe(403);
    });
  });
});
