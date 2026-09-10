import type { CardPriority, CardType } from '@lpm/shared';
import type { ColumnType, Generated } from 'kysely';

/**
 * Table types for the board, its lists and its cards.
 *
 * As in the other schema files, columns are camelCase here and the
 * `CamelCasePlugin` renders them snake_case in SQL.
 */

type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

/** A calendar day with no time and no zone, as `2026-08-18`. */
type CalendarDate = string;

/**
 * An ordering key, read as a string because `pg` returns `numeric` that way.
 *
 * Numeric rather than an integer sequence so a card dropped between two others
 * takes the midpoint: a reorder writes one row instead of renumbering the rest
 * of the list. Reading it as a string is what keeps that midpoint exact — the
 * arithmetic happens in Postgres, never here.
 */
type Position = ColumnType<string, number | string, number | string>;

export interface BoardTable {
  id: Generated<string>;
  projectId: string;
  name: Generated<string>;
  createdAt: CreatedAt;
}

export interface ListTable {
  id: Generated<string>;
  boardId: string;
  name: string;
  /** The colour bar above the list, and the tint behind its cards. */
  color: Generated<string>;
  /** Null is no limit. */
  wipLimit: number | null;
  position: Position;
  /** Where a card usually goes from here. Advice, not a rule. */
  nextListId: string | null;
  /** Where a card goes when it is sent back. */
  backListId: string | null;
  archivedAt: Date | null;
  createdAt: CreatedAt;
}

export interface CardTable {
  id: Generated<string>;
  /** Denormalised from `project`, so a board query scopes without a join. */
  accountId: string;
  projectId: string;
  listId: string;
  /** `DRCH-ART-208`. Issued once and never reused. */
  cardKey: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  type: CardType;
  priority: CardPriority | null;
  points: number | null;
  estimateMinutes: number | null;
  assigneeId: string | null;
  /** Which milestone this is promised for. Null is the normal state. */
  milestoneId: string | null;
  reporterId: string | null;
  discipline: string | null;
  fixVersion: string | null;
  dueOn: CalendarDate | null;
  blocked: Generated<boolean>;
  blockedReason: string | null;
  /**
   * Whether this card gathers others.
   *
   * True before anything is under it: a producer makes the legend and fills it
   * afterwards, and one with nothing in it yet still has to be findable.
   */
  isLegend: Generated<boolean>;
  /** The legend this card is under, or null for one that stands alone. */
  legendId: string | null;
  position: Position;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
  /** Which list a card is in is its status; this is when it stopped being open. */
  closedAt: Date | null;
  /** `hand` for one somebody wrote, otherwise the forge that owns it. */
  source: Generated<string>;
  /** The forge's own id for the issue behind it. Null for a card written here. */
  externalId: string | null;
  /** `41`, as the issue is spoken about. */
  externalRef: string | null;
  externalUrl: string | null;
}
