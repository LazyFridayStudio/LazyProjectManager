import type { CardSequencePrefix, ProjectPhase } from '@lpm/shared';
import type { ColumnType, Generated } from 'kysely';

/**
 * Table types for projects, their members and their ticket counters.
 *
 * As in `identity-tables.ts`, columns are camelCase here and the
 * `CamelCasePlugin` renders them snake_case in SQL.
 */

/** A timestamp the database fills in and application code never writes. */
type CreatedAt = ColumnType<Date, Date | undefined, never>;

/** A timestamp the database defaults but application code may update. */
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

/**
 * A calendar day, with no time and no zone, as 'YYYY-MM-DD'.
 *
 * `configureTypeParsers` stops `pg` turning these into local-midnight Dates,
 * which shifted a ship date by a day for anyone in the wrong timezone.
 */
type CalendarDate = string;

/**
 * A money amount in minor units — cents for AUD.
 *
 * Read as a string because `pg` returns `bigint` that way; written as a number,
 * since no realistic budget comes near the limit of an exact JavaScript integer.
 * Convert on the way out with `readMinorUnits`.
 */
type MinorUnits = ColumnType<string | null, number | null | undefined, number | null>;

export interface ProjectTable {
  id: Generated<string>;
  accountId: string;
  name: string;
  /** The ticket prefix root, uppercase: `DRCH` gives `DRCH-ART-208`. */
  code: string;
  slug: string;
  engine: string | null;
  phase: Generated<ProjectPhase>;
  budgetMinor: MinorUnits;
  currency: Generated<string>;
  startsOn: CalendarDate | null;
  shipsOn: CalendarDate | null;
  datesTbd: Generated<boolean>;
  /** When set, work-in-progress limits warn rather than refuse. */
  wipIsAdvisory: Generated<boolean>;
  /**
   * When set, a sync raises cards only for issues that are still open.
   *
   * A closed issue already linked to a card still settles it — the sync asks
   * for those separately — so nothing drifts out of step. This governs what
   * arrives next, and never what has already arrived.
   */
  syncOpenIssuesOnly: Generated<boolean>;
  /**
   * How long the clock leaves this repository alone between reconciles.
   *
   * Null means the clock is off, and the button and the webhook still work. A
   * minute is the floor the database enforces; the screen offers a short list
   * inside it.
   */
  syncEverySeconds: Generated<number | null>;
  /**
   * The sections this project does not use, by their shared names.
   *
   * A fact about the project rather than about a person, so it leaves the
   * sidebar for everybody on it. Empty means all eight, which is every project
   * that has never touched the setting.
   *
   * Read as the list it is and written as the JSON it is stored as. Optional on
   * insert because the column defaults to empty, which is what every project
   * starts as and most stay.
   */
  disabledSections: ColumnType<string[], string | undefined, string>;
  keyArtFileId: string | null;
  /** The square mark, which is what a project looks like where it is named. */
  logoFileId: string | null;
  /** Set rather than deleted, so ticket keys never point at nothing. */
  archivedAt: Date | null;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

export interface ProjectMemberTable {
  id: Generated<string>;
  projectId: string;
  userId: string;
  role: 'owner' | 'lead' | 'member' | 'outsourcer' | 'viewer';
  /**
   * Hours a day this person has for this project, which the timeline measures
   * the work against. Zero means it: a build bot has work and no capacity.
   */
  dailyCapacityHours: Generated<number>;
  createdAt: CreatedAt;
}

/**
 * A team on a project.
 *
 * A standing grant rather than a bulk add: everybody in the team reaches the
 * project, joining the team joins its projects, and leaving takes the reach
 * with it. `reachedLevel` in the server reads this as its third source.
 *
 * A project and a team, and nothing else. What those people may do once they
 * are there is what the permission groups the team holds say — a level on this
 * row would be a third opinion about a question two systems already answer.
 */
export interface ProjectTeamTable {
  id: Generated<string>;
  projectId: string;
  teamId: string;
  createdAt: CreatedAt;
}

/**
 * The counter behind each project's ticket keys.
 *
 * A row per prefix rather than a Postgres sequence: keys must not have gaps, and
 * a sequence keeps the value it handed out even when the transaction that asked
 * for it rolls back.
 */
export interface CardSequenceTable {
  projectId: string;
  prefix: CardSequencePrefix;
  lastValue: Generated<number>;
}

/**
 * Turns a minor-unit amount read from the database into a number.
 *
 * Safe for money: a value large enough to lose precision here is larger than
 * every currency's total supply.
 */
export function readMinorUnits(value: string | null): number | null {
  return value === null ? null : Number(value);
}
