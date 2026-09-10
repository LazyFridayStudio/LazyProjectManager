/**
 * How much of a project somebody can do.
 *
 * Separate from their role on purpose, and the two answer different questions:
 * the role says what a person may do anywhere — write a card, manage a list,
 * administer the install — and the level says where they may do it. A member
 * with `read` on Drowned Reach can write cards, just not on that one.
 */
export const accessLevels = ['none', 'read', 'write'] as const;

export type AccessLevel = (typeof accessLevels)[number];

const rankByLevel: Readonly<Record<AccessLevel, number>> = { none: 0, read: 1, write: 2 };

/** Whether a level is at least another, which is the whole of the ordering. */
export function isAtLeastLevel(level: AccessLevel, required: AccessLevel): boolean {
  return rankByLevel[level] >= rankByLevel[required];
}

/**
 * The most any of them allows.
 *
 * Somebody in three teams gets the best of the three: a team is something
 * granted to a person, and being in one more can only ever add.
 */
export function bestLevel(levels: readonly AccessLevel[]): AccessLevel {
  return levels.reduce<AccessLevel>(
    (best, level) => (isAtLeastLevel(level, best) ? level : best),
    'none',
  );
}
