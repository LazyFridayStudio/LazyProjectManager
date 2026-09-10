import { z } from 'zod';

import type { CardSequencePrefix } from '../projects/project-vocabulary.js';
import { SCM_PROVIDERS } from '../scm/scm-vocabulary.js';

/**
 * The words the board is described in.
 *
 * As with `project-vocabulary`, this is the only definition; migration
 * `0003-board` repeats the literals because a migration must keep meaning what
 * it meant on the day it ran.
 */

/**
 * Where a card came from.
 *
 * `hand` is somebody writing one, which is every card there was before a
 * repository could put its issues on the board. The rest are the forge that
 * owns the row.
 *
 * The distinction earns its keep in one rule, the same rule releases follow: a
 * card somebody wrote is never touched by a sync, and a card a forge owns is
 * whatever the forge now says it is. Without a source there is no way to hold
 * that line.
 */
export const CARD_SOURCES = ['hand', ...SCM_PROVIDERS] as const;

export type CardSource = (typeof CARD_SOURCES)[number];

export const cardSourceSchema = z.enum(CARD_SOURCES);

/**
 * The four kinds of card. They match the ticket prefixes `card_sequence` issues,
 * so a key says what it is: `EXMP-ART-208` is art.
 */
export const CARD_TYPES = ['art', 'task', 'bug', 'build'] as const;

export type CardType = (typeof CARD_TYPES)[number];

export const cardTypeSchema = z.enum(CARD_TYPES);

const CARD_TYPE_LABELS: Readonly<Record<CardType, string>> = {
  art: 'Art',
  task: 'Task',
  bug: 'Bug',
  build: 'Build',
};

export function describeCardType(cardType: CardType): string {
  return CARD_TYPE_LABELS[cardType];
}

/** The prefix a card of this type takes in its key, and its counter row. */
const CARD_TYPE_PREFIXES: Readonly<Record<CardType, CardSequencePrefix>> = {
  art: 'ART',
  task: 'TASK',
  bug: 'BUG',
  build: 'BUILD',
};

export function getPrefixForCardType(cardType: CardType): CardSequencePrefix {
  return CARD_TYPE_PREFIXES[cardType];
}

/** Ordered most to least urgent, which is the order a filter offers them in. */
export const CARD_PRIORITIES = ['highest', 'high', 'medium', 'low'] as const;

export type CardPriority = (typeof CARD_PRIORITIES)[number];

export const cardPrioritySchema = z.enum(CARD_PRIORITIES);

const CARD_PRIORITY_LABELS: Readonly<Record<CardPriority, string>> = {
  highest: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function describeCardPriority(priority: CardPriority): string {
  return CARD_PRIORITY_LABELS[priority];
}

/**
 * How one card relates to another.
 *
 * `blocks` and `blocked_by` are the same fact told from either end and are
 * always written as a pair; `relates` and `duplicates` read the same both ways
 * and are written once each way for the same reason.
 */
export const CARD_LINK_KINDS = ['blocks', 'blocked_by', 'relates', 'duplicates'] as const;

export type CardLinkKind = (typeof CARD_LINK_KINDS)[number];

export const cardLinkKindSchema = z.enum(CARD_LINK_KINDS);

const CARD_LINK_LABELS: Readonly<Record<CardLinkKind, string>> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  relates: 'Relates to',
  duplicates: 'Duplicates',
};

export function describeCardLinkKind(kind: CardLinkKind): string {
  return CARD_LINK_LABELS[kind];
}

/** The other half of a link, written at the same time as the one asked for. */
const RECIPROCAL_KINDS: Readonly<Record<CardLinkKind, CardLinkKind>> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  relates: 'relates',
  duplicates: 'duplicates',
};

export function getReciprocalLinkKind(kind: CardLinkKind): CardLinkKind {
  return RECIPROCAL_KINDS[kind];
}

export const cardTitleSchema = z.string().trim().min(1, 'Give the card a title.').max(200);

/** Lower-case six-digit hex. The list colour is a bar, a tint and a card edge. */
export const listColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'Pick a colour.');

export const listNameSchema = z.string().trim().min(1, 'Name the list.').max(60);

/**
 * A work-in-progress limit. Null is no limit; zero would mean the list may never
 * hold anything, which is a list nobody can use.
 */
export const wipLimitSchema = z.number().int().positive().max(999);
