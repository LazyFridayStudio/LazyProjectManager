import type { CardLinkKind } from '@lpm/shared';
import type { ColumnType, Generated } from 'kysely';

/**
 * Table types for what happens on a card: the work broken down, the
 * conversation, and what it is tied to.
 */

/** A calendar day with no time and no zone, as `2026-08-18`. */
type CalendarDate = string;

type CreatedAt = ColumnType<Date, Date | undefined, never>;

/** As in `board-tables`: `numeric`, read as a string so midpoints stay exact. */
type Position = ColumnType<string, number | string, number | string>;

export interface SubtaskTable {
  id: Generated<string>;
  cardId: string;
  title: string;
  done: Generated<boolean>;
  position: Position;
  createdAt: CreatedAt;
}

/**
 * Time somebody actually worked, on a card or on an asset.
 *
 * The estimate is what it was expected to take; this is what it took. Minutes,
 * because every question asked of these is addition — `duration.ts` is where
 * `2d 4h` is read and written on both sides.
 *
 * Exactly one of `cardId` and `assetId` is set, which the database enforces.
 */
export interface WorkLogTable {
  id: Generated<string>;
  cardId: string | null;
  assetId: string | null;
  /** Null once the person has left; the hours they worked stay on the record. */
  userId: string | null;
  minutes: number;
  /** The day the work was done, which is not the day it was typed in. */
  workedOn: CalendarDate;
  note: string | null;
  createdAt: CreatedAt;
}

export interface CommentTable {
  id: Generated<string>;
  cardId: string;
  /** Null once the person has been removed; the conversation stays whole. */
  authorId: string | null;
  body: string;
  createdAt: CreatedAt;
  editedAt: Date | null;
  /** Set rather than deleted, so a reply never refers to nothing. */
  deletedAt: Date | null;
}

/**
 * One person named in one comment, and whether they have dealt with it.
 *
 * Not where a mention is recorded — the name is in the comment body, written
 * with the id of whoever was chosen. This is where an *unread* one is, because
 * "what is waiting for me" is a question about a person rather than about a
 * card, and no query wants to read every comment on the install to answer it.
 */
export interface CommentMentionTable {
  id: Generated<string>;
  commentId: string;
  userId: string;
  /** When they dealt with it, or null while it is still waiting. */
  seenAt: Date | null;
  createdAt: CreatedAt;
}

export interface CardLinkTable {
  id: Generated<string>;
  fromCardId: string;
  toCardId: string;
  kind: CardLinkKind;
  createdAt: CreatedAt;
}
