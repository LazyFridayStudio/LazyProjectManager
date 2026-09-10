import type { CardPriority, CardType } from '@lpm/shared';

/**
 * The demo board, as data.
 *
 * A small studio making a voxel sandbox: dig a hole, build a shelter, last the
 * night. Deliberately the plainest game anybody could name, because the demo has
 * to be read by somebody who has never seen this app and does not want to learn
 * a fictional studio's slate before they can tell what a card is.
 *
 * Ticket keys are not written here: they are issued by `card_sequence` like any
 * other card's, so the seeded board proves the allocator works rather than
 * pretending around it.
 */

export interface DemoPerson {
  readonly email: string;
  readonly displayName: string;
  readonly initials: string;
}

export const DEMO_PEOPLE: readonly DemoPerson[] = [
  { email: 'l.tran@blockfall.demo', displayName: 'Linh Tran', initials: 'LT' },
  { email: 'd.okafor@blockfall.demo', displayName: 'Daniel Okafor', initials: 'DO' },
  { email: 's.beck@blockfall.demo', displayName: 'Sam Beck', initials: 'SB' },
  { email: 'j.iyer@blockfall.demo', displayName: 'Jaya Iyer', initials: 'JI' },
  { email: 'm.kaur@blockfall.demo', displayName: 'Mira Kaur', initials: 'MK' },
];

export interface DemoCard {
  readonly type: CardType;
  readonly title: string;
  /** Whose initials the card carries, or null for one nobody has picked up. */
  readonly assignee: string | null;
  /** Days from the day the seed runs, so the board never looks stale. */
  readonly dueInDays: number | null;
  readonly points: number | null;
  readonly priority: CardPriority | null;
  /** Whether this card gathers others. See `DEMO_LEGENDS` for what is under it. */
  readonly isLegend?: boolean;
}

export interface DemoList {
  readonly name: string;
  readonly cards: readonly DemoCard[];
}

export const DEMO_PROJECT = {
  name: 'Blockfall',
  code: 'BLOK',
  engine: 'Godot 4.4',
  phase: 'vertical_slice',
  // A$45,000, which is what the four categories under it add up to plus room to
  // move. A budget the library could never spend draws a burn bar that is always
  // empty, and the burn bar is the thing that screen exists for.
  budgetMinor: 4_500_000,
  startsInDays: -220,
  shipsInDays: 104,
} as const;

export const DEMO_LISTS: readonly DemoList[] = [
  {
    name: 'Backlog',
    cards: [
      {
        type: 'task',
        title: 'Chunk streaming: second pass',
        assignee: 'LT',
        dueInDays: null,
        points: null,
        priority: null,
        isLegend: true,
      },
      {
        type: 'task',
        title: 'Rebuild chunk meshes off the main thread',
        assignee: 'LT',
        dueInDays: 6,
        points: 3,
        priority: 'medium',
      },
      {
        type: 'task',
        title: 'Greedy meshing for solid runs',
        assignee: 'JI',
        dueInDays: 9,
        points: 5,
        priority: 'low',
      },
      {
        type: 'art',
        title: 'Slime mob concept sheet',
        assignee: 'DO',
        dueInDays: 15,
        points: 8,
        priority: 'medium',
      },
      {
        type: 'task',
        title: 'Audit the block atlas budget',
        assignee: 'SB',
        dueInDays: 17,
        points: 2,
        priority: 'low',
      },
      {
        type: 'art',
        title: 'Lantern wisp: glow and trail pass',
        assignee: 'DO',
        dueInDays: 3,
        points: 13,
        priority: 'high',
      },
    ],
  },
  {
    name: 'In progress',
    cards: [
      {
        type: 'art',
        title: 'First sixteen blocks in the atlas',
        assignee: 'DO',
        dueInDays: 0,
        points: 13,
        priority: 'highest',
      },
      {
        type: 'art',
        title: 'Pickaxe, axe and shovel in hand',
        assignee: 'SB',
        dueInDays: 1,
        points: 5,
        priority: 'high',
      },
      {
        type: 'task',
        title: 'Inventory and hotbar drag and drop',
        assignee: 'JI',
        dueInDays: 7,
        points: 8,
        priority: 'medium',
      },
      {
        type: 'task',
        title: 'Day and night cycle',
        assignee: 'JI',
        dueInDays: 4,
        points: 5,
        priority: 'medium',
      },
    ],
  },
  {
    name: 'Ready for review',
    cards: [
      {
        type: 'art',
        title: 'Oak tree set: trunk, leaves, sapling',
        assignee: 'LT',
        dueInDays: 0,
        points: 5,
        priority: 'medium',
      },
      {
        type: 'art',
        title: 'Crafting table and furnace',
        assignee: 'SB',
        dueInDays: 2,
        points: 3,
        priority: 'low',
      },
      {
        type: 'bug',
        title: 'Chunk seams flicker at draw distance 8',
        assignee: 'JI',
        dueInDays: 0,
        points: 2,
        priority: 'high',
      },
      {
        type: 'task',
        title: 'Save and load a world to disk',
        assignee: 'SB',
        dueInDays: 1,
        points: 2,
        priority: 'medium',
      },
    ],
  },
  {
    name: 'Done',
    cards: [
      {
        type: 'art',
        title: 'Player model and walk cycle',
        assignee: 'MK',
        dueInDays: -3,
        points: 3,
        priority: 'low',
      },
      {
        type: 'build',
        title: 'Cook and publish the itch.io demo',
        assignee: null,
        dueInDays: -3,
        points: null,
        priority: null,
      },
      {
        type: 'art',
        title: 'Stone, cobble and dirt tiling pass',
        assignee: 'SB',
        dueInDays: -4,
        points: 8,
        priority: 'medium',
      },
      {
        type: 'art',
        title: 'Hotbar and heart row',
        assignee: 'LT',
        dueInDays: -6,
        points: 5,
        priority: 'low',
      },
    ],
  },
];

/**
 * A clump of work, and what is in it.
 *
 * Matched by title, as everything else here is. Getting chunks to stream is some
 * engine work and a bug that only shows up once it does, which is exactly the
 * shape a legend exists for — and it is the shape that used to be expressed by
 * typing `[Chunks]` into four titles and hoping.
 */
export interface DemoLegend {
  /** The card that gathers, which the fixture also marks `isLegend`. */
  readonly legend: string;
  /** The cards under it, by title. */
  readonly gathers: readonly string[];
}

export const DEMO_LEGENDS: readonly DemoLegend[] = [
  {
    legend: 'Chunk streaming: second pass',
    gathers: [
      'Rebuild chunk meshes off the main thread',
      'Greedy meshing for solid runs',
      'Chunk seams flicker at draw distance 8',
      'Save and load a world to disk',
    ],
  },
];

/** A team the demo comes with, and who is in it by initials. */
export interface DemoTeam {
  readonly name: string;
  readonly members: readonly string[];
}

export const DEMO_TEAMS: readonly DemoTeam[] = [
  { name: 'Block art', members: ['LT', 'DO'] },
  { name: 'Pixel Forge', members: ['MK'] },
];

/**
 * The permission groups the demo comes with.
 *
 * Two, because two is what it takes to show the model. `Board runs on this` is
 * the ordinary case — a whole job allowed, and nothing else said. `Outsourcer`
 * is the one the feature exists for: a partner who writes what a card says and
 * must not move it, which is a sentence `read` and `write` could not express
 * because editing and moving are both `write`.
 */
export interface DemoPermissionGroup {
  readonly name: string;
  readonly rules: readonly { readonly subject: string; readonly effect: 'allow' | 'deny' }[];
  /** The teams holding it, by name. A group held by nobody governs nobody. */
  readonly heldBy: readonly string[];
}

export const DEMO_PERMISSION_GROUPS: readonly DemoPermissionGroup[] = [
  {
    name: 'Board runs on this',
    // What pressing Allow on the Board and cards heading writes.
    rules: [
      { subject: 'board.viewList', effect: 'allow' },
      { subject: 'board.manageList', effect: 'allow' },
      { subject: 'card.view', effect: 'allow' },
      { subject: 'card.create', effect: 'allow' },
      { subject: 'card.update', effect: 'allow' },
      { subject: 'card.move', effect: 'allow' },
      { subject: 'card.comment', effect: 'allow' },
      { subject: 'card.link', effect: 'allow' },
    ],
    heldBy: ['Block art'],
  },
  {
    name: 'Outsourcer',
    /*
     * The same heading allowed, then one child switched to Deny — which is what
     * makes the heading read `Custom` on the screen, and is the sentence read
     * and write could not express.
     */
    rules: [
      { subject: 'board.viewList', effect: 'allow' },
      { subject: 'board.manageList', effect: 'deny' },
      { subject: 'card.view', effect: 'allow' },
      { subject: 'card.create', effect: 'deny' },
      { subject: 'card.update', effect: 'allow' },
      { subject: 'card.move', effect: 'deny' },
      { subject: 'card.comment', effect: 'allow' },
      { subject: 'card.link', effect: 'deny' },
    ],
    heldBy: ['Pixel Forge'],
  },
];
