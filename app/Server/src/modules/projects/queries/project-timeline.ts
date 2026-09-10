import { sql } from '@lpm/database';
import {
  projectTimelineQuery,
  TIMELINE_DAYS,
  type ProjectTimelineView,
  type TimelineDay,
  type TimelineGroup,
  type TimelineGrouping,
} from '@lpm/shared';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { pictureUrl } from '../../files/index.js';
import type { RequestContext } from '../../../cqrs/request-context.js';
import { requireActor } from '../../../cqrs/request-context.js';
import { ProjectNotFoundError } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../project-access.js';
import {
  addDays,
  placeCard,
  sumByDay,
  type DatedCard,
  type PlacedCard,
} from './schedule-timeline.js';

/**
 * How far back a card can start and still reach this window.
 *
 * A bar begins as many days before its due date as its estimate needs, so a
 * long card due yesterday can still cover today. Sixty days is four hundred and
 * eighty hours of work at a normal day, which is longer than any single card a
 * studio should have — and a bound has to exist, or the query reads the whole
 * history of the project to draw a fortnight.
 */
const LONGEST_BAR_DAYS = 60;

/**
 * The day somebody works when the project has not written one down for them.
 *
 * Which is everybody who arrived through a team: `daily_capacity_hours` lives on
 * `project_member`, and they have no such row. Eight rather than a guess —
 * `0042-everybody-has-a-whole-day` set every existing row to it and took away
 * the screen that could write anything else, on the grounds that how long
 * somebody works is a fact about them rather than about one of the games they
 * are on. So this is not a default standing in for a real number; it is the
 * same number every direct member already has, until a person's own profile
 * carries one.
 */
const DEFAULT_DAILY_CAPACITY_HOURS = 8;

/** Where the unassigned work is gathered. Not a user id, and never mistaken for one. */
const UNASSIGNED = 'unassigned';

/** Where work that is not promised for a date is gathered. */
const UNPROMISED = 'unpromised';

/** Where the people on a project who are in none of its teams are gathered. */
const NO_TEAM = 'no-team';

/**
 * Who is doing what, and whether it fits.
 *
 * The screen is a capacity chart before it is a calendar. Cards with dates are
 * spread backwards from those dates at each assignee's own rate, and the
 * question is whether any day now holds more hours than the day has.
 *
 * Two statements rather than one: the members and the dated cards are unrelated
 * sets, and joining them in SQL would repeat every member row once per card to
 * save a round trip that costs less than the repetition does.
 */
export const projectTimelineHandler = defineQueryHandler({
  definition: projectTimelineQuery,

  async execute(
    params: { slug: string; from?: string; groupBy: TimelineGrouping },
    context,
  ): Promise<ProjectTimelineView> {
    const actor = requireActor(context, projectTimelineQuery.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'timeline.view' });

    const found = await loadProject(context, params.slug, actor.accountId);

    if (found === undefined) {
      // Also what another account's project looks like, and one this actor was
      // never added to. Nobody learns a project exists by guessing at its slug.
      throw new ProjectNotFoundError();
    }

    const { today, ...project } = found;
    const firstDay = params.from ?? today;

    const [members, cards, milestones, teams] = await Promise.all([
      loadMembers(context, project.id),
      loadDatedCards(context, project.id, firstDay),
      loadMilestones(context, project.id, firstDay),
      loadTeams(context, project.id),
    ]);

    const teamCapacity = members.reduce((total, member) => total + member.capacity, 0);
    const strangers = await loadStrangers(context, members, cards);
    const groups = groupRows(params.groupBy, {
      members,
      strangers,
      cards,
      milestones,
      teams,
      firstDay,
      teamCapacity,
    });

    return {
      project,
      days: buildDays(firstDay, today, milestones),
      groups,
      loadByDay: sumByDay(groups.map((group) => group.hoursByDay)),
      teamCapacityHoursPerDay: teamCapacity,
      groupBy: params.groupBy,
    };
  },
});

type TimelineCard = DatedCard & {
  readonly assigneeId: string | null;
  readonly milestoneId: string | null;
};

interface MilestoneRow {
  readonly id: string;
  readonly name: string;
  readonly shipsOn: string;
}

interface Member {
  readonly userId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
  readonly capacity: number;
}

interface TeamRow {
  readonly id: string;
  readonly name: string;
  readonly memberIds: readonly string[];
}

interface Grouping {
  readonly members: readonly Member[];
  /** Assignees of work here who are no longer on the project. */
  readonly strangers: readonly Member[];
  readonly cards: readonly TimelineCard[];
  readonly milestones: readonly MilestoneRow[];
  readonly teams: readonly TeamRow[];
  readonly firstDay: string;
  readonly teamCapacity: number;
}

/** Which of the three cuts the caller asked for. */
function groupRows(groupBy: TimelineGrouping, grouping: Grouping): TimelineGroup[] {
  const { members, cards, milestones, teams, firstDay, teamCapacity } = grouping;

  if (groupBy === 'milestone') return byMilestone(milestones, cards, { firstDay, teamCapacity });

  if (groupBy === 'team') return byTeam({ teams, members, cards, firstDay });

  return byPerson({ members, strangers: grouping.strangers, cards, firstDay });
}

interface Row {
  readonly id: string;
  readonly name: string;
  readonly initials: string | null;
  readonly avatarUrl: string | null;
  readonly capacity: number;
  /** Somebody who holds work here and is no longer on the project. */
  readonly offTheProject?: boolean;
  /** Which cards belong to this row. */
  readonly holds: (card: TimelineCard) => boolean;
}

/**
 * A row per person, plus one for the work nobody owns.
 *
 * Everybody appears, including the people with nothing on them — a chart drawn
 * from only the busy half of a team is one that cannot show you who is free,
 * which is the question you came to it with.
 */
function byPerson(grouping: {
  readonly members: readonly Member[];
  readonly strangers: readonly Member[];
  readonly cards: readonly TimelineCard[];
  readonly firstDay: string;
}): TimelineGroup[] {
  const { members, strangers, cards, firstDay } = grouping;

  const rows: Row[] = members.map((member) => ({
    id: member.userId,
    name: member.displayName,
    initials: member.initials,
    avatarUrl: member.avatarUrl,
    capacity: member.capacity,
    holds: (card) => card.assigneeId === member.userId,
  }));

  /*
   * The people who left, holding work they were given before they did.
   *
   * Last, and with no capacity: they have not promised this project a day, so
   * counting one would say the fortnight has room it does not have. But the
   * work is real and somebody has to pick it up, and a chart that simply
   * stopped drawing it — which is what this did — is how it goes unnoticed
   * until the date does.
   *
   * By name rather than gathered into one row. `Nobody assigned` is the right
   * answer when nobody was ever asked; here somebody was, and their name is the
   * fact needed to hand the work on.
   */
  for (const stranger of strangers) {
    rows.push({
      id: stranger.userId,
      name: stranger.displayName,
      initials: stranger.initials,
      avatarUrl: stranger.avatarUrl,
      capacity: 0,
      offTheProject: true,
      holds: (card) => card.assigneeId === stranger.userId,
    });
  }

  if (cards.some((card) => card.assigneeId === null)) {
    // Not a person, so no capacity: an hour here is an hour nobody has agreed
    // to do, and counting it against a day would hide that.
    rows.push({
      id: UNASSIGNED,
      name: 'Nobody assigned',
      initials: null,
      // Not a person, so there is no face to draw and no letters either.
      avatarUrl: null,
      capacity: 0,
      holds: (card) => card.assigneeId === null,
    });
  }

  return rows.map((row) => fillRow(row, cards, firstDay));
}

/**
 * A row per milestone that overlaps the window, plus one for unpromised work.
 *
 * Measured against the whole team's day rather than one person's: a milestone
 * is something the studio does together, and the question this grouping asks is
 * whether everything promised for a date fits in the days before it.
 *
 * Only the milestones this fortnight touches. A row for a milestone that ships
 * in March is a row of empty columns pushing the ones that matter off screen.
 */
function byMilestone(
  milestones: readonly MilestoneRow[],
  cards: readonly TimelineCard[],
  window: { readonly firstDay: string; readonly teamCapacity: number },
): TimelineGroup[] {
  const { firstDay, teamCapacity } = window;

  const rows: Row[] = milestones.map((milestone) => ({
    id: milestone.id,
    name: milestone.name,
    initials: null,
    avatarUrl: null,
    capacity: teamCapacity,
    holds: (card) => card.milestoneId === milestone.id,
  }));

  if (cards.some((card) => card.milestoneId === null)) {
    rows.push({
      id: UNPROMISED,
      name: 'Not promised',
      initials: null,
      avatarUrl: null,
      capacity: teamCapacity,
      holds: (card) => card.milestoneId === null,
    });
  }

  return rows.map((row) => fillRow(row, cards, firstDay));
}

/**
 * A row per team on the project, plus the two rows for work that fits neither.
 *
 * The grouping a studio is staffed in, and so the one an overload is fixed in:
 * `by person` says Linh is buried, and this says whether environment art is
 * buried or whether there is a week free two rows down.
 *
 * Measured against the team's own day rather than the studio's, which is the
 * difference from `by milestone`. A milestone is something everybody does
 * together, so the whole team's hours are the right denominator for it; four
 * people in environment art cannot spend the animators' afternoons, and a row
 * that said they could would call every team comfortable.
 *
 * **Somebody in two of the project's teams is counted once**, under the first
 * by name. Both their day and their cards go to that one row, so the two halves
 * of the ratio always describe the same people. The alternative — drawing them
 * on both — reads better on one row and lies on the footer, which sums the rows
 * into `loadByDay` and would report eight hours of work as sixteen. Which team
 * of the two is a smaller thing to be arbitrary about than that.
 */
function byTeam(grouping: {
  readonly teams: readonly TeamRow[];
  readonly members: readonly Member[];
  readonly cards: readonly TimelineCard[];
  readonly firstDay: string;
}): TimelineGroup[] {
  const { teams, members, cards, firstDay } = grouping;

  // First by name wins, because `loadTeams` is ordered by it: whichever row
  // somebody lands on, they land on the same one every time the screen is
  // drawn, which is what stops a card moving between rows on a refresh.
  const teamOfUser = new Map<string, string>();

  for (const team of teams) {
    for (const userId of team.memberIds) {
      if (!teamOfUser.has(userId)) teamOfUser.set(userId, team.id);
    }
  }

  const capacityOfTeam = new Map<string, number>();

  for (const member of members) {
    const teamId = teamOfUser.get(member.userId);

    if (teamId !== undefined) {
      capacityOfTeam.set(teamId, (capacityOfTeam.get(teamId) ?? 0) + member.capacity);
    }
  }

  const rows: Row[] = teams.map((team) => ({
    id: team.id,
    name: team.name,
    initials: null,
    avatarUrl: null,
    capacity: capacityOfTeam.get(team.id) ?? 0,
    holds: (card) => card.assigneeId !== null && teamOfUser.get(card.assigneeId) === team.id,
  }));

  // Somebody added to the project by name rather than with a team. They are on
  // it and doing the work, so they need a row; they are not any team's load, so
  // it is not one of the team rows.
  const heldByNobodyTeam = (card: TimelineCard): boolean =>
    card.assigneeId !== null && !teamOfUser.has(card.assigneeId);

  // Work assigned to somebody who has since come off the project lands here
  // too, with no capacity behind it. Removing a member does not unassign their
  // cards, so those exist; `by person` drops them silently because no row holds
  // them, and `by milestone` keeps them because every card has a milestone or
  // has not. Two of the three groupings show the work, and this is the second —
  // a fortnight that quietly stops counting hours somebody still owes is worse
  // than one with an unexplained row on it.
  const looseCapacity = members
    .filter((member) => !teamOfUser.has(member.userId))
    .reduce((total, member) => total + member.capacity, 0);

  if (looseCapacity > 0 || cards.some(heldByNobodyTeam)) {
    rows.push({
      id: NO_TEAM,
      name: 'No team',
      initials: null,
      avatarUrl: null,
      capacity: looseCapacity,
      holds: heldByNobodyTeam,
    });
  }

  if (cards.some((card) => card.assigneeId === null)) {
    // The same row `by person` gathers under, for the same reason: an hour
    // nobody has agreed to do is measured against nothing rather than against a
    // team's day, which would report it as somebody's problem already.
    rows.push({
      id: UNASSIGNED,
      name: 'Nobody assigned',
      initials: null,
      avatarUrl: null,
      capacity: 0,
      holds: (card) => card.assigneeId === null,
    });
  }

  return rows.map((row) => fillRow(row, cards, firstDay));
}

/** Places the cards a row holds, and adds their days up. */
function fillRow(row: Row, cards: readonly TimelineCard[], firstDay: string): TimelineGroup {
  const placed = cards
    .filter((card) => row.holds(card))
    .map((card) => placeCard(card, row.capacity, firstDay))
    .filter((card): card is PlacedCard => card !== undefined);

  return {
    id: row.id,
    name: row.name,
    initials: row.initials,
    avatarUrl: row.avatarUrl,
    capacityHoursPerDay: row.capacity,
    offTheProject: row.offTheProject ?? false,
    hoursByDay: sumByDay(placed.map((card) => card.hoursByDay)),
    // Longest first: the bar that decides whether the fortnight works is the
    // one somebody should read before the two-hour jobs underneath it.
    bars: placed.map((card) => card.bar).sort((left, right) => right.hours - left.hours),
  };
}

function buildDays(
  firstDay: string,
  today: string,
  milestones: readonly MilestoneRow[],
): TimelineDay[] {
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return Array.from({ length: TIMELINE_DAYS }, (_unused, offset) => {
    const date = addDays(firstDay, offset);
    const weekday = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();

    return {
      date,
      // A deadline is a property of the date, so it is marked on the column
      // whichever way the rows happen to be grouped.
      milestoneName: milestones.find((milestone) => milestone.shipsOn === date)?.name ?? null,
      weekday: WEEKDAYS[weekday] ?? '',
      dayOfMonth: Number(date.slice(8)),
      isToday: date === today,
      // Drawn back rather than left out. Work lands on weekends, and a chart
      // that hides them is one that quietly reports a six-day week as fine.
      isWeekend: weekday === 0 || weekday === 6,
    };
  });
}

/**
 * The project, and what day it is where the install runs.
 *
 * Today comes from the database rather than this process: it is the clock every
 * other date on the screen was written against, and a server whose timezone
 * differs from its database would otherwise mark the wrong column.
 */
async function loadProject(
  context: RequestContext,
  slug: string,
  accountId: string,
): Promise<(ProjectTimelineView['project'] & { today: string }) | undefined> {
  return context.database
    .selectFrom('project')
    .select(['id', 'name', 'slug', 'code'])
    .select(sql<string>`current_date`.as('today'))
    .where('slug', '=', slug)
    .where('accountId', '=', accountId)
    .executeTakeFirst();
}

/**
 * The milestones this fortnight touches.
 *
 * One that ships in March is not a row worth drawing here: it would be fourteen
 * empty columns pushing the ones that matter off the screen.
 */
async function loadMilestones(
  context: RequestContext,
  projectId: string,
  firstDay: string,
): Promise<MilestoneRow[]> {
  return context.database
    .selectFrom('milestone')
    .select(['id', 'name', 'shipsOn'])
    .where('projectId', '=', projectId)
    .where('startsOn', '<', addDays(firstDay, TIMELINE_DAYS))
    .where('shipsOn', '>=', firstDay)
    .orderBy('shipsOn')
    .execute();
}

/**
 * Whoever holds work here and is not on the project any more.
 *
 * Its own statement, and usually not made at all: it depends on which cards
 * came back, so it cannot join the others in the first round trip, and the set
 * is empty on every healthy project. Asked only when a card names somebody the
 * membership does not.
 *
 * They are found through the cards rather than through anything about the
 * project, because there is nothing about the project left to find them by —
 * that is the whole condition.
 */
async function loadStrangers(
  context: RequestContext,
  members: readonly Member[],
  cards: readonly TimelineCard[],
): Promise<Member[]> {
  const onTheProject = new Set(members.map((member) => member.userId));
  const missing = [
    ...new Set(
      cards
        .map((card) => card.assigneeId)
        .filter((assigneeId): assigneeId is string => assigneeId !== null)
        .filter((assigneeId) => !onTheProject.has(assigneeId)),
    ),
  ];

  if (missing.length === 0) return [];

  const rows = await context.database
    .selectFrom('appUser')
    .leftJoin('file as strangerAvatar', 'strangerAvatar.id', 'appUser.avatarFileId')
    .select([
      'appUser.id as userId',
      'appUser.displayName as displayName',
      'appUser.initials as initials',
      'appUser.avatarFileId as avatarFileId',
      'strangerAvatar.state as avatarState',
    ])
    .where('appUser.id', 'in', missing)
    .orderBy('appUser.displayName')
    .execute();

  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.displayName,
    initials: row.initials,
    avatarUrl: pictureUrl(row.avatarFileId, row.avatarState),
    // Not a day this project has been promised. See `byPerson`.
    capacity: 0,
  }));
}

/**
 * The teams on the project, each with the people who come with it.
 *
 * Ordered by name, which is also what decides where somebody in two of them
 * lands — see `byTeam`. A team with nobody in it still comes back and still
 * gets a row: an empty discipline on a project is a fact worth drawing, and the
 * row says so with no capacity rather than by being absent.
 *
 * One statement and grouped here. The alternative is a query per team, and the
 * set is small enough — a project has teams in single figures — that a row per
 * pair costs less than the round trips would.
 */
async function loadTeams(context: RequestContext, projectId: string): Promise<TeamRow[]> {
  const rows = await context.database
    .selectFrom('projectTeam')
    .innerJoin('team', 'team.id', 'projectTeam.teamId')
    .leftJoin('teamMember', 'teamMember.teamId', 'team.id')
    .select(['team.id as teamId', 'team.name as name', 'teamMember.userId as userId'])
    .where('projectTeam.projectId', '=', projectId)
    .orderBy('team.name')
    .execute();

  const teams = new Map<string, { name: string; memberIds: string[] }>();

  for (const row of rows) {
    const team = teams.get(row.teamId) ?? { name: row.name, memberIds: [] };

    // Null for the left join that found a team with nobody in it.
    if (row.userId !== null) team.memberIds.push(row.userId);

    teams.set(row.teamId, team);
  }

  return [...teams].map(([id, team]) => ({ id, name: team.name, memberIds: team.memberIds }));
}

/**
 * Everybody the project reaches, however they reach it.
 *
 * Two ways on, and the chart has to know both: a row of their own in
 * `project_member`, or being in a team that is on the project — the standing
 * grant `reachedLevel` counts as its third source. Reading only the first drew
 * a chart of the people somebody had added one at a time and left out everybody
 * who arrived with a team, whose cards then fell through to `Nobody assigned`
 * and read as unowned work.
 *
 * Not expanded into memberships when a team is picked, for the reason
 * `Engineering-Rules.md` gives: the grant is standing, so a person who joins
 * the team next month has to appear here without anybody touching the project.
 *
 * One statement rather than two merged afterwards. Both routes name the same
 * people often enough — being on a project directly and in a team that is on it
 * are both true for three of the five demo people — and a left join onto the
 * unique `(project_id, user_id)` row cannot double anybody the way a union of
 * two result sets would need de-duplicating.
 */
async function loadMembers(context: RequestContext, projectId: string): Promise<Member[]> {
  const rows = await context.database
    .selectFrom('appUser')
    .leftJoin('projectMember', (join) =>
      join
        .onRef('projectMember.userId', '=', 'appUser.id')
        .on('projectMember.projectId', '=', projectId),
    )
    .leftJoin('file as memberAvatar', 'memberAvatar.id', 'appUser.avatarFileId')
    .select([
      'appUser.id as userId',
      'appUser.displayName as displayName',
      'appUser.initials as initials',
      'appUser.avatarFileId as avatarFileId',
      'memberAvatar.state as avatarState',
      'projectMember.dailyCapacityHours as dailyCapacityHours',
    ])
    .where((builder) =>
      builder.or([
        builder('projectMember.projectId', '=', projectId),
        builder.exists(
          builder
            .selectFrom('projectTeam')
            .innerJoin('teamMember', 'teamMember.teamId', 'projectTeam.teamId')
            .select('teamMember.userId')
            .whereRef('teamMember.userId', '=', 'appUser.id')
            .where('projectTeam.projectId', '=', projectId),
        ),
      ]),
    )
    .orderBy('appUser.displayName')
    .execute();

  return rows.map((row) => ({
    userId: row.userId,
    displayName: row.displayName,
    initials: row.initials,
    avatarUrl: pictureUrl(row.avatarFileId, row.avatarState),
    capacity: row.dailyCapacityHours ?? DEFAULT_DAILY_CAPACITY_HOURS,
  }));
}

/**
 * Every open card with a date that could reach this window.
 *
 * Closed cards are left out: the chart asks whether the work ahead fits, and
 * work already done takes none of the days it is asking about.
 */
async function loadDatedCards(
  context: RequestContext,
  projectId: string,
  firstDay: string,
): Promise<TimelineCard[]> {
  const rows = await context.database
    .selectFrom('card')
    .innerJoin('list', 'list.id', 'card.listId')
    .select([
      'card.id as cardId',
      'card.cardKey as cardKey',
      'card.title as title',
      'card.dueOn as dueOn',
      'card.estimateMinutes as estimateMinutes',
      'card.points as points',
      'card.assigneeId as assigneeId',
      'card.milestoneId as milestoneId',
      'list.name as listName',
      'list.color as listColor',
    ])
    .where('card.projectId', '=', projectId)
    .where('card.closedAt', 'is', null)
    .where('card.dueOn', 'is not', null)
    .where('card.dueOn', '>=', addDays(firstDay, -LONGEST_BAR_DAYS))
    .where('card.dueOn', '<', addDays(firstDay, TIMELINE_DAYS))
    .execute();

  return rows.map((row) => ({
    ...row,
    // Narrowed by the `is not null` above, which the types cannot see.
    dueOn: row.dueOn ?? firstDay,
  }));
}
