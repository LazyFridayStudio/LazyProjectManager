import { HOURS_PER_POINT, TIMELINE_DAYS, type TimelineBar } from '@lpm/shared';

/** One card as the database has it, before it is placed on the chart. */
export interface DatedCard {
  readonly cardId: string;
  readonly cardKey: string;
  readonly title: string;
  readonly dueOn: string;
  readonly estimateMinutes: number | null;
  readonly points: number | null;
  readonly listName: string;
  readonly listColor: string | null;
}

export interface PlacedCard {
  readonly bar: TimelineBar;
  /** Hours falling on each day of the window. Length is always `TIMELINE_DAYS`. */
  readonly hoursByDay: readonly number[];
}

/**
 * How long a card is, in hours.
 *
 * An estimate if somebody gave one, otherwise its points at the studio rate.
 * A card with neither is nought rather than a guess — inventing a day for every
 * unestimated card is how a chart comes to say a week is full when nobody knows
 * whether it is, and the screen says "no estimate" instead so the gap is
 * something a producer can go and close.
 */
export function hoursForCard(card: DatedCard): number {
  if (card.estimateMinutes !== null) return card.estimateMinutes / 60;
  if (card.points !== null) return card.points * HOURS_PER_POINT;

  return 0;
}

/**
 * Places one card on the chart, or returns undefined if it misses the window.
 *
 * The bar ends on the due date and runs backwards, because that is the order
 * the work has to happen in: a card due Friday that takes three days starts
 * Wednesday. A chart that drew it starting Friday would report the deadline as
 * comfortable right up until the morning it is missed.
 *
 * Hours spread evenly across the days the bar covers. Nobody works evenly, but
 * the alternative is inventing a shape for the work that is no truer and looks
 * more certain than it is.
 */
export function placeCard(
  card: DatedCard,
  capacityHoursPerDay: number,
  firstDay: string,
): PlacedCard | undefined {
  const dueIndex = daysBetween(firstDay, card.dueOn);
  const hours = hoursForCard(card);

  // At nought capacity the work cannot be spread over any number of days, so it
  // sits on its due date as a single unestimated-looking bar would. Its hours
  // still count: a bot with eight hours of builds queued is a real eight hours.
  const spanDays =
    capacityHoursPerDay > 0 ? Math.max(1, Math.ceil(hours / capacityHoursPerDay)) : 1;

  const startIndex = dueIndex - spanDays + 1;

  if (startIndex >= TIMELINE_DAYS || dueIndex < 0) return undefined;

  const hoursPerDay = hours / spanDays;
  const hoursByDay = Array.from({ length: TIMELINE_DAYS }, (_unused, day) =>
    day >= startIndex && day <= dueIndex ? hoursPerDay : 0,
  );

  const clippedStart = Math.max(0, startIndex);

  return {
    bar: {
      cardId: card.cardId,
      cardKey: card.cardKey,
      title: card.title,
      hours,
      estimated: card.estimateMinutes !== null || card.points !== null,
      startIndex: clippedStart,
      spanDays: Math.min(TIMELINE_DAYS, dueIndex + 1) - clippedStart,
      startsEarlier: startIndex < 0,
      listName: card.listName,
      listColor: card.listColor,
    },
    hoursByDay,
  };
}

/** Adds up several days-by-day arrays into one. */
export function sumByDay(rows: readonly (readonly number[])[]): number[] {
  return Array.from({ length: TIMELINE_DAYS }, (_unused, day) =>
    // Rounded because a third of an hour repeated fourteen times is a column of
    // 2.9999999999999996, and nobody wants to read that.
    round(rows.reduce((total, row) => total + (row[day] ?? 0), 0)),
  );
}

/** Whole days from one calendar date to another, either way. */
export function daysBetween(from: string, to: string): number {
  const MILLISECONDS_PER_DAY = 86_400_000;

  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MILLISECONDS_PER_DAY,
  );
}

/** The calendar date `offset` days after `from`. */
export function addDays(from: string, offset: number): string {
  const moved = new Date(Date.parse(`${from}T00:00:00Z`) + offset * 86_400_000);

  return moved.toISOString().slice(0, 10);
}

function round(hours: number): number {
  return Math.round(hours * 100) / 100;
}
