import { permittedActions, type PermittedAction } from './permitted-actions.js';

/**
 * A rule either lets something happen or stops it.
 *
 * Two, and no third. "Not set" is the absence of a rule rather than a rule
 * saying nothing: a stored third value is a thing every reader has to have an
 * opinion about, and the one thing a permission must not be is ambiguous.
 */
export const PERMISSION_EFFECTS = ['allow', 'deny'] as const;

export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

/**
 * The catalogue every action is filed under.
 *
 * A heading, not a permission. Nothing stores `catalog.board` — pressing Allow
 * on it writes Allow on each of the actions beneath it, and the heading then
 * reads back whatever those say. That is what lets somebody allow
 * the board and then deny moving a card without the two rules arguing: there is
 * only one rule per action and the heading is a summary of them.
 *
 * It replaced a stored coarse rule that stood for its members. That version had
 * one real advantage — an action added later was covered by every group holding
 * the coarse rule — and one fatal problem: a heading and a specific rule that
 * disagreed needed a precedence nobody could see on the screen. A heading that
 * is only ever a summary of what is under it cannot disagree with anything.
 *
 * **A partition, not a set of presets.** Every action is under exactly one
 * catalogue. An action under two would be a screen showing the same switch
 * twice, and two switches for one fact is how somebody sets one and believes
 * they set both. `catalogues-cover-every-action` in the tests holds this.
 */
export const CATALOGUES = {
  'catalog.board': {
    label: 'Board and cards',
    description:
      'The board and everything on it. What somebody doing the work needs, and nothing about the project it belongs to.',
    actions: [
      'board.viewList',
      'board.manageList',
      'card.view',
      'card.create',
      'card.update',
      'card.delete',
      'card.move',
      'card.comment',
      'card.link',
    ],
  },
  'catalog.assets': {
    label: 'Files and assets',
    description:
      'The asset library, its shelves, and every file attached to anything. Separate from the board because reading the art is not touching the work.',
    actions: [
      'asset.view',
      'asset.create',
      'asset.update',
      'asset.delete',
      'asset.manageCategory',
      'file.upload',
      'file.remove',
    ],
  },
  'catalog.docs': {
    label: 'Documents',
    description:
      'The design documents. Their own heading because rewriting the brief and fixing a typo on a card were the same permission until they were not.',
    actions: ['doc.view', 'doc.create', 'doc.update', 'doc.delete'],
  },
  'catalog.planning': {
    label: 'Planning',
    description:
      'What the project is promising and how it is tracking: the dates, who is on what, the money and the summary. Reading, mostly.',
    actions: [
      'milestone.view',
      'milestone.manage',
      'timeline.view',
      'budget.view',
      'dashboard.view',
    ],
  },
  'catalog.releases': {
    label: 'Releases',
    description: 'What the project has actually shipped, and the right to say so.',
    actions: ['release.view', 'release.record'],
  },
  'catalog.project': {
    label: 'Projects',
    description:
      'The project itself rather than the work in it: what it is called, when it ships, what it costs, who is on it, and the repository behind it.',
    actions: [
      'project.view',
      'project.create',
      'project.update',
      'project.archive',
      'member.invite',
      'member.remove',
      'scm.connect',
    ],
  },
  'catalog.agents': {
    label: 'Agents',
    description:
      'Something that reaches this install with a key rather than a password, and does what it is told without anybody watching. Separate from the people because handing out a key and adding a colleague are different decisions — and because the one worth splitting hardest is stopping a key, which somebody should be able to do in a hurry without also being able to make one.',
    actions: ['agent.view', 'agent.create', 'agent.update', 'agent.issueKey', 'agent.revokeKey'],
  },
  'catalog.install': {
    label: 'The install',
    description:
      'Everything outside a project: the people, the teams, the permission groups, the settings, the audit trail and the bin. The keys to the whole thing.',
    actions: [
      'user.view',
      'user.manage',
      'team.view',
      'team.manage',
      'settings.manage',
      'audit.view',
      'recovery.view',
      'recovery.restore',
      'recovery.purge',
    ],
  },
} as const satisfies Readonly<
  Record<string, { label: string; description: string; actions: readonly PermittedAction[] }>
>;

export type Catalogue = keyof typeof CATALOGUES;

export const catalogues = Object.keys(CATALOGUES) as readonly Catalogue[];

/** The catalogue an action is filed under. Every action has exactly one. */
export function catalogueOf(action: PermittedAction): Catalogue {
  const found = catalogues.find((catalogue) =>
    (CATALOGUES[catalogue].actions as readonly PermittedAction[]).includes(action),
  );

  if (found === undefined) {
    // Unreachable while the test that checks the partition passes, and worth
    // saying out loud rather than returning a plausible wrong answer.
    throw new Error(`${action} is not filed under any catalogue.`);
  }

  return found;
}

/** A rule names an action, and only an action. Catalogues are never stored. */
export function isRuleSubject(value: string): value is PermittedAction {
  return (permittedActions as readonly string[]).includes(value);
}

/**
 * Where a rule reached somebody from.
 *
 * `person` is a group given to them by name; `team` is one their team holds.
 * The distinction exists because they are not equal — see `decide`.
 */
export type PermissionSource = 'person' | 'team';

export interface PermissionRule {
  readonly action: string;
  readonly effect: PermissionEffect;
  /**
   * Absent means `team`.
   *
   * Optional so a caller that has no notion of sources — every test that
   * predates them, and the policy's own default of no rules at all — keeps
   * meaning what it meant.
   */
  readonly source?: PermissionSource;
}

/**
 * What one person's rules say about one action.
 *
 * `undefined` is "no rule reaches this", which is not the same as a denial —
 * the caller falls back to the role ladder, so a group that says nothing about
 * an action leaves it exactly as it was. That is what makes these safe to
 * introduce: an install with no groups behaves as it did yesterday.
 *
 * **A group given to the person wins over one their team holds.** A team says
 * what a job does. Somebody given a group by name is being spoken about
 * personally, and the specific statement is the one that was made about them —
 * so an artist personally allowed `release.record` has it even though the
 * artists' team is denied it, and a contractor personally denied `card.delete`
 * loses it even though their team may.
 *
 * Which is the whole of the ranking. Only two kinds of statement exist, and one
 * of them is about a person by name.
 *
 * **Within one kind, deny wins.** Somebody in two teams where one group allows
 * and another denies is denied, and the same for two groups given to them. Both
 * statements are the same kind of thing, nothing distinguishes them, and the
 * safe half of a contradiction is the one that refuses.
 *
 * A person's groups saying nothing about an action is not a statement — the
 * team's are then read as they always were. Silence is not permission and it is
 * not refusal either.
 */
export function decide(
  rules: readonly PermissionRule[],
  action: PermittedAction,
): PermissionEffect | undefined {
  const about = rules.filter((rule) => rule.action === action);
  const personally = about.filter((rule) => rule.source === 'person');

  return settle(personally) ?? settle(about);
}

/** One kind of statement, read together: deny wins, and nothing is silence. */
function settle(rules: readonly PermissionRule[]): PermissionEffect | undefined {
  if (rules.length === 0) {
    return undefined;
  }

  return rules.some((rule) => rule.effect === 'deny') ? 'deny' : 'allow';
}

/**
 * What each action actually lets somebody do.
 *
 * Written out rather than derived from the name, because `card.update` reads as
 * "update card" and that is not the question an admin is asking. The question
 * is what it lets a person do that they could not do without it, and the answer
 * has to say the consequence — that moving a card changes what the board is
 * claiming about the schedule, not merely that a card moves.
 *
 * A permission nobody can explain is a permission nobody gives out correctly.
 */
export const RULE_DESCRIPTIONS: Readonly<Record<PermittedAction, string>> = {
  'project.view': 'See that a project exists and open it.',
  'project.create': 'Start a new project.',
  'project.update': "Change a project's name, code, dates and budget.",
  'project.archive':
    'Take a project off the launcher. Nothing is deleted; it stops being in the way.',
  'member.invite':
    'Put somebody on a project, or a whole team. Being on a project is what decides which projects somebody can open at all, so this is the permission that hands out reach.',
  'member.remove':
    'Take somebody off a project, or take a team off one. Everybody who reached it only through that team stops reaching it.',
  'scm.connect':
    "Connect a project to a repository, and see the webhook secret when it is made. Somebody with this can read the repository's issues and releases in.",
  'board.viewList': 'See the lists a board is divided into, and what is in each.',
  'board.manageList':
    'Add a list to a board, rename one, reorder them, or take one away. The shape of how work moves.',
  'card.view': 'Open a card and read everything on it.',
  'card.create': 'Make a new card.',
  'card.update':
    'Change what a card says: its title, description, acceptance criteria, who it is for, when it is due, and the subtasks under it.',
  'card.delete':
    'Delete a card outright, and every subtask, comment, attachment and link on it. It waits a week in the bin before it is really gone. Separate from making one, because a studio that lets everybody write cards does not necessarily let everybody unmake them.',
  'card.move':
    "Drag a card to a different list. Where a card sits is the producer's statement about the schedule, which is why this is separate from editing one.",
  'card.comment': 'Write a comment on a card.',
  'card.link':
    'Tie one card to another: blocks, relates, duplicates, and gathering cards under a legend.',
  'asset.view': 'Open the asset library and look at what is in it.',
  'asset.create': 'Add an asset to the library.',
  'asset.update':
    'Change an asset: what it is called, how far along it is, its tags, its reference images, its working files, and which cards it is about.',
  'asset.delete':
    'Delete an asset outright, and every reference image, working file, stage and tag on it. It waits a week in the bin before it is really gone. Separate from changing one, because a studio that lets everybody fill the library in does not necessarily let everybody empty it.',
  'asset.manageCategory':
    'Add, rename or remove a category in the asset library. The shelves rather than what is on them.',
  'file.upload': 'Attach a file to a card or an asset.',
  'file.remove': 'Take an attached file off a card or an asset.',
  'doc.view': "Read the project's design documents.",
  'doc.create': 'Start a new design document.',
  'doc.update': 'Write in a design document, or rename one.',
  'doc.delete': 'Delete a design document and everything written in it.',
  'milestone.view': 'See the dates a project is held to.',
  'milestone.manage': 'Add, change or remove a milestone. What the project is promising and when.',
  'timeline.view': 'See who is working on what, and when.',
  'budget.view': 'See what the project is estimated at, committed to and spending.',
  'dashboard.view':
    "See the project's summary: what is in flight, what is stuck, and how the burndown reads.",
  'release.view': 'See what the project has shipped.',
  'release.record':
    "Record a release, change one, delete one, or read the repository's releases in.",
  'user.view': 'See the list of everybody on the install.',
  'user.manage':
    'Add a person, change their role, suspend them, or reset their password. The keys to the install.',
  'agent.view': 'See the agents on this install and the keys they hold.',
  'agent.create': 'Make an agent — something that reaches this install with a key.',
  'agent.update': 'Change an agent: what it is called, and the picture it is drawn with.',
  'agent.issueKey':
    'Give an agent a key. The secret is shown once, and whoever holds it can do everything that agent may do.',
  'agent.revokeKey':
    'Stop a key working. Deliberately apart from giving one out: somebody should be able to shut a key off in a hurry without also being able to mint one.',
  'team.view': 'See the teams and who is in them.',
  'team.manage':
    'Make and unmake teams, move people between them, write permission groups, and say which groups a team holds.',
  'settings.manage': 'Change the install-wide settings.',
  'audit.view': 'Read the audit trail: who did what, and when.',
  'recovery.view': 'See what has been deleted and is still inside its week.',
  'recovery.restore': 'Put a deleted thing back.',
  'recovery.purge': 'Throw a deleted thing away now, without waiting out its week.',
};

/** What one action lets somebody do, in a sentence. */
export function describeRule(action: PermittedAction): string {
  return RULE_DESCRIPTIONS[action];
}
