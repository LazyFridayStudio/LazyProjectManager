import type { ColumnType, Generated } from 'kysely';

type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

/** `date` arrives as a string, because the type parsers say so. */
type CalendarDate = string;

/**
 * A date the project is held to, and what was promised for it.
 *
 * Everything countable about a milestone is counted from the cards that point
 * at it. `capacityPoints` is the exception because it is a decision rather
 * than a count: what the team believed it could take on when it planned this.
 */
export interface MilestoneTable {
  id: Generated<string>;
  accountId: string;
  projectId: string;
  name: string;
  /** One sentence the team can hold itself to. */
  goal: string | null;
  startsOn: CalendarDate;
  shipsOn: CalendarDate;
  capacityPoints: number | null;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}
