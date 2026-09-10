import type { AssetStatus } from '@lpm/shared';

/** Written this way because an escaped one keeps being eaten in transit. */
const NEWLINE = String.fromCharCode(10);

/**
 * The rest of the demo project: what it is making, when it is due, and what has
 * been written down about it.
 *
 * The board fixture beside this is the same studio seen from the other screens,
 * so the library, the dashboard, the timeline, the budget and the design
 * documents all have something in them rather than each being a set of empty
 * states.
 */

export interface DemoAsset {
  readonly name: string;
  readonly status: AssetStatus;
  /** Minor units, as everywhere money is stored. Null is one nobody has costed. */
  readonly estimatedCostMinor: number | null;
  /** Days from the day the seed runs, so nothing ever looks stale. */
  readonly dueInDays: number | null;
  /** Whose initials it carries, or null for the ones nobody has picked up. */
  readonly assignee: string | null;
  readonly tags: readonly string[];
}

export interface DemoCategory {
  readonly name: string;
  readonly color: string;
  /** What was set aside for it. Null on the one nobody has decided about. */
  readonly budgetMinor: number | null;
  readonly assets: readonly DemoAsset[];
}

/**
 * A library with a shape worth reading.
 *
 * Deliberately uneven: one category over its budget, one with no budget at all,
 * a handful of uncosted assets and a few nobody is assigned to. A demo where
 * everything is tidy shows none of the things these screens exist to surface.
 *
 * Every asset here has a picture drawn for it in `art/demo-pictures.ts`, matched
 * by name, so the library is a grid of blocks rather than a grid of filenames.
 */
export const DEMO_CATEGORIES: readonly DemoCategory[] = [
  {
    name: 'Blocks',
    color: '#6ab04c',
    budgetMinor: 900_000,
    assets: [
      {
        name: 'Grass block',
        status: 'final',
        estimatedCostMinor: 120_000,
        dueInDays: null,
        assignee: 'LT',
        tags: ['terrain', 'atlas'],
      },
      {
        name: 'Stone and cobble',
        status: 'approved',
        estimatedCostMinor: 95_000,
        dueInDays: -4,
        assignee: 'SB',
        tags: ['terrain', 'atlas'],
      },
      {
        name: 'Oak log and planks',
        status: 'review',
        estimatedCostMinor: 140_000,
        dueInDays: 2,
        assignee: 'LT',
        tags: ['terrain', 'trees'],
      },
      {
        name: 'Sand and gravel',
        status: 'wip',
        estimatedCostMinor: 90_000,
        dueInDays: 6,
        assignee: 'SB',
        tags: ['terrain', 'falling'],
      },
      {
        name: 'Torch',
        status: 'concept',
        estimatedCostMinor: null,
        dueInDays: 14,
        assignee: null,
        tags: ['lighting'],
      },
    ],
  },
  {
    name: 'Mobs',
    color: '#8d6e63',
    // Over its budget on purpose: the burn bar and the dashboard both have a
    // red case to draw, and a demo where nothing is over shows neither.
    budgetMinor: 600_000,
    assets: [
      {
        name: 'Slime',
        status: 'review',
        estimatedCostMinor: 320_000,
        dueInDays: 9,
        assignee: 'DO',
        tags: ['mob', 'hostile'],
      },
      {
        name: 'Lantern wisp',
        status: 'wip',
        estimatedCostMinor: 280_000,
        dueInDays: 21,
        assignee: 'DO',
        tags: ['mob', 'lighting'],
      },
      {
        name: 'Cave crawler',
        status: 'concept',
        estimatedCostMinor: 210_000,
        dueInDays: null,
        assignee: null,
        tags: ['mob', 'concept-only'],
      },
    ],
  },
  {
    name: 'Tools and items',
    color: '#b0bec5',
    budgetMinor: 400_000,
    assets: [
      {
        name: 'Wooden pickaxe',
        status: 'approved',
        estimatedCostMinor: 60_000,
        dueInDays: -11,
        assignee: 'JI',
        tags: ['tier-1', 'in-hand'],
      },
      {
        name: 'Stone sword',
        status: 'final',
        estimatedCostMinor: 55_000,
        dueInDays: null,
        assignee: 'JI',
        tags: ['tier-2', 'in-hand'],
      },
      {
        name: 'Bucket',
        status: 'concept',
        estimatedCostMinor: null,
        dueInDays: 30,
        assignee: null,
        tags: ['tier-2', 'concept-only'],
      },
    ],
  },
  {
    name: 'Audio',
    color: '#63aeeb',
    // Nobody has budgeted it, which is not the same as budgeting nothing — the
    // budget screen draws that case differently and should have one to draw.
    budgetMinor: null,
    assets: [
      {
        name: 'Block break set',
        status: 'wip',
        estimatedCostMinor: 80_000,
        dueInDays: 4,
        assignee: 'MK',
        tags: ['sfx', 'blocks'],
      },
      {
        name: 'Night ambience',
        status: 'concept',
        estimatedCostMinor: null,
        dueInDays: null,
        assignee: 'MK',
        tags: ['ambience', 'night'],
      },
    ],
  },
];

export interface DemoMilestone {
  readonly name: string;
  readonly goal: string;
  readonly startsInDays: number;
  readonly shipsInDays: number;
  readonly capacityPoints: number;
}

/**
 * One behind, one running, three ahead.
 *
 * The release plan is read for the shape of the run-up, so a demo needs enough
 * of them either side of today for that shape to exist.
 */
export const DEMO_MILESTONES: readonly DemoMilestone[] = [
  {
    name: 'Playable prototype',
    goal: 'Dig a hole, place a block',
    startsInDays: -96,
    shipsInDays: -42,
    capacityPoints: 38,
  },
  {
    name: 'Vertical slice',
    goal: 'A night you can survive',
    startsInDays: -41,
    shipsInDays: 9,
    capacityPoints: 46,
  },
  {
    name: 'Steam page build',
    goal: 'Twenty minutes that hold up',
    startsInDays: 10,
    shipsInDays: 38,
    capacityPoints: 40,
  },
  {
    name: 'Alpha',
    goal: 'Content complete, rough',
    startsInDays: 39,
    shipsInDays: 96,
    capacityPoints: 52,
  },
  {
    name: 'Early access',
    goal: 'It runs on a five-year-old laptop',
    startsInDays: 97,
    shipsInDays: 160,
    capacityPoints: 44,
  },
];

export interface DemoDocument {
  readonly title: string;
  readonly body: string;
  /**
   * Whose initials the document was last written under.
   *
   * Separate people own separate documents, and the header says so. A demo
   * where every document was last touched by the same account says the
   * opposite of what having three of them is meant to show.
   */
  readonly writtenBy: string;
}

/**
 * The documents a studio keeps, not one.
 *
 * A game design, an art direction and an audio bible are separate things that
 * separate people own; putting them end to end in one file makes a contents
 * list nobody can find anything in. Three of them here, of different lengths,
 * with headings at every level so the contents list has a shape.
 */
export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  {
    title: 'Game design',
    writtenBy: 'MK',
    body: [
      '# Pillars',
      '',
      '## The fantasy',
      '',
      'You wake up on an island made of **cubes**, with nothing, and about ten',
      'minutes until it gets dark.',
      '',
      'Everything after that is the same loop: dig something up, make something out',
      'of it, and get further from the hole you slept in the first night.',
      '',
      '## Tone',
      '',
      'Bright, and quietly encouraging. Nothing in the world is cruel; the night is',
      'not a punishment, it is a deadline.',
      '',
      '- Never grim. A death costs you the walk back, not the run',
      '- The world is readable from a distance: every block says what it is',
      '- Humour lives in the mobs, not in the interface',
      '',
      '## What it is not',
      '',
      '> It is not a survival sim.',
      '',
      'No hunger, no thirst, no temperature. The pressure is the dark and what is',
      'in it, and there is exactly one of those to learn.',
      '',
      '# Systems',
      '',
      '## Mining',
      '',
      '### The tiers',
      '',
      'Four tools, three tiers, and nothing hidden behind a wiki. What a tool can',
      'break is the whole progression.',
      '',
      '| Tool | Breaks | Made from |',
      '| --- | --- | --- |',
      '| Hand | Dirt, sand, leaves | nothing |',
      '| Wood | Stone, coal | four planks |',
      '| Stone | Iron | two cobble |',
      '',
      '### Breaking a block',
      '',
      'A block takes as long to break as it takes to say what it is out loud. That',
      'is the whole timing rule, and it has survived three passes.',
      '',
      '## Building',
      '',
      'Place, break, and nothing else. No blueprints, no snapping, no build menu:',
      'the shelter you make on the first night should be ugly and yours.',
      '',
      '# Progression',
      '',
      'The world does not level up and neither do you. Going further out is a',
      'decision about how far you are from a bed when the sun goes down.',
    ].join(NEWLINE),
  },
  {
    title: 'Art direction',
    writtenBy: 'LT',
    body: [
      '# The atlas',
      '',
      'One page, sixteen by sixteen a tile, no mipmaps, nearest-neighbour',
      'everywhere. A block that needs a second page is a block we are not making.',
      '',
      '## Palette',
      '',
      'Six hues and four shades of each. Two greens: one for grass in daylight, one',
      'for leaves, and they must not be confusable in a screenshot.',
      '',
      '# Silhouette',
      '',
      'Every mob reads as a shape at forty blocks. If you cannot tell what it is',
      'from the top of a hill, it is detail rather than design.',
      '',
      '## Light',
      '',
      'Torchlight is warm and falls off fast. The dark is blue, never black — a',
      'player who cannot see their own hands has been given a bug, not a mood.',
    ].join(NEWLINE),
  },
  {
    title: 'Audio bible',
    writtenBy: 'JI',
    body: [
      '# One sound per verb',
      '',
      'Break, place, step, hurt. Everything else is ambience, and ambience is a bed',
      'rather than an event.',
      '',
      '# Blocks say what they are',
      '',
      'Stone, wood, sand and grass have to be tellable apart with your eyes shut.',
      'That is four sounds doing more work than any music we could write.',
    ].join(NEWLINE),
  },
];

export interface DemoReleaseAsset {
  readonly name: string;
  readonly sizeBytes: number;
  readonly downloadCount: number;
  /**
   * Where the demo says the file is.
   *
   * A fiction, like the rest of the demo — nothing is served from it. It is
   * here because a downloads list with nothing to press is not what the screen
   * looks like in use, and the demo exists to show what the screen looks like
   * in use. The host is deliberately one that does not resolve, so nobody
   * mistakes a demo build for a real one they can run.
   */
  readonly downloadUrl: string;
}

export interface DemoRelease {
  readonly tag: string;
  readonly name: string;
  /** Days before the day the seed runs, so the history is never stale. */
  readonly publishedDaysAgo: number;
  readonly author: string;
  readonly commitSha: string;
  readonly isPrerelease: boolean;
  readonly runLabel: string;
  readonly notes: string;
  readonly assets: readonly DemoReleaseAsset[];
}

/**
 * Where the demo pretends its builds are kept.
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered, so a demo
 * download cannot one day start pointing at somebody's real website — which a
 * plausible-looking domain eventually would.
 */
const DEMO_BUILDS = 'https://builds.blockfall.invalid/blockfall/v0.4.4';

const MEGABYTE = 1024 ** 2;

/**
 * What the demo project has shipped.
 *
 * Three, and only the newest with notes and downloads on it — which is what a
 * real project looks like. A demo where every release is fully written up shows
 * a page nobody has to scroll and hides the one thing the layout is for: the
 * latest gets the room, the rest get a line each.
 */
export const DEMO_RELEASES: readonly DemoRelease[] = [
  {
    tag: 'v0.4.2',
    name: 'Prototype close',
    publishedDaysAgo: 31,
    author: 'build-bot',
    commitSha: '19c8e44',
    isPrerelease: false,
    runLabel: 'release.yml · run #191',
    notes: '',
    assets: [],
  },
  {
    tag: 'v0.4.3',
    name: 'Atlas review build',
    publishedDaysAgo: 17,
    author: 'build-bot',
    commitSha: 'ba71d30',
    isPrerelease: true,
    runLabel: 'release.yml · run #206',
    notes: '',
    assets: [],
  },
  {
    tag: 'v0.4.4',
    name: 'Vertical slice — Blockfall',
    publishedDaysAgo: 4,
    author: 'build-bot',
    commitSha: '4f2ac91',
    isPrerelease: true,
    runLabel: 'release.yml · run #218',
    notes: [
      '## Added',
      '',
      '- Day and night cycle, with mobs that only spawn under a light level of 7',
      '- Slimes: large ones split into two mediums and a problem',
      '- Chunks save to disk and load back in the state you left them',
      '',
      '## Changed',
      '',
      '- Chunk meshes are rebuilt off the main thread, so placing a block no',
      '  longer costs a frame',
      '- The first sixteen block textures are on one atlas page',
      '',
      '## Fixed',
      '',
      '- Sand fell through a chunk boundary instead of landing on it',
      '- Torches lit the block behind them rather than the one they were on',
    ].join(NEWLINE),
    assets: [
      {
        name: 'Blockfall-VerticalSlice-win64.zip',
        sizeBytes: 240 * MEGABYTE,
        downloadCount: 38,
        downloadUrl: `${DEMO_BUILDS}/Blockfall-VerticalSlice-win64.zip`,
      },
      {
        name: 'Blockfall-VerticalSlice-linux.zip',
        sizeBytes: 236 * MEGABYTE,
        downloadCount: 12,
        downloadUrl: `${DEMO_BUILDS}/Blockfall-VerticalSlice-linux.zip`,
      },
      {
        name: 'Blockfall-VerticalSlice-web.zip',
        sizeBytes: 48 * MEGABYTE,
        downloadCount: 94,
        downloadUrl: `${DEMO_BUILDS}/Blockfall-VerticalSlice-web.zip`,
      },
    ],
  },
];
