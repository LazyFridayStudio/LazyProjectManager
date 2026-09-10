import { z } from 'zod';

import { defineQuery } from '../../envelope/query-definition.js';
import { calendarDateSchema, projectSlugSchema } from '../project-vocabulary.js';

/**
 * A fortnight, which is the window the design draws and the one a producer
 * plans in. A month does not fit on a screen at a readable column width, and a
 * week is shorter than most of the work on it.
 */
export const TIMELINE_DAYS = 14;

/**
 * What a point is worth in hours, when a card has points but no estimate.
 *
 * A convention rather than a measurement, and the same one the design uses. It
 * is here rather than configurable because a studio that wants a different
 * number wants a different number for everything, and one place to change it is
 * better than a setting nobody remembers exists.
 */
export const HOURS_PER_POINT = 4;

/**
 * What the fortnight is cut up by.
 *
 * The design offers four; the fourth — by legend task — needs a concept this
 * product does not have yet. These three are the ones it can answer honestly,
 * and all of them ask the same question of different rows: does the work
 * promised here fit in the days there are.
 *
 * Widening from person to team to milestone, which is the order somebody moves
 * out through when the answer on one row is no: who is overloaded, then which
 * discipline, then what it costs the date.
 *
 * Every row is a partition, never an overlap. The footer sums the rows into
 * `loadByDay`, so a card drawn on two of them would report eight hours of work
 * as sixteen in the number people read first.
 */
export const TIMELINE_GROUPINGS = ['person', 'team', 'milestone'] as const;

export type TimelineGrouping = (typeof TIMELINE_GROUPINGS)[number];

export const timelineGroupingSchema = z.enum(TIMELINE_GROUPINGS);

export function describeTimelineGrouping(grouping: TimelineGrouping): string {
  if (grouping === 'person') return 'By person';

  return grouping === 'team' ? 'By team' : 'By milestone';
}

export const timelineDaySchema = z.object({
  /** `2026-08-24`. */
  date: calendarDateSchema,
  /** `Mon`, for the column head. */
  weekday: z.string(),
  dayOfMonth: z.number().int(),
  isToday: z.boolean(),
  /** Saturdays and Sundays are drawn back, not excluded — work lands on them. */
  isWeekend: z.boolean(),
  /**
   * A milestone landing on this day, if one does.
   *
   * On the day rather than in a row of its own: a deadline is a property of the
   * date, and a fortnight with a ship date in it should say so whichever way
   * the rows happen to be grouped.
   */
  milestoneName: z.string().nullable(),
});

/**
 * One card, placed on the chart.
 *
 * The bar ends on the due date and runs backwards, because that is how the work
 * has to happen: a card due Friday that takes three days starts Wednesday, and
 * a chart that started it Friday would say the deadline is fine right up until
 * it is missed.
 */
export const timelineBarSchema = z.object({
  cardId: z.string().uuid(),
  cardKey: z.string(),
  title: z.string(),
  /** Nought when nothing is estimated, which the screen says rather than guesses at. */
  hours: z.number(),
  estimated: z.boolean(),
  /** First column it occupies, clipped to the window. */
  startIndex: z.number().int(),
  spanDays: z.number().int(),
  /** True when the work began before this window, so the bar is drawn cut off. */
  startsEarlier: z.boolean(),
  listName: z.string(),
  listColor: z.string().nullable(),
});

export const timelineGroupSchema = z.object({
  /**
   * What the row is: a user id, a team id, a milestone id, or one of the names
   * the gathering rows go by — `unassigned`, `no-team`, `unpromised`.
   */
  id: z.string(),
  name: z.string(),
  initials: z.string().nullable(),
  /** Their picture. Null for a row that is not a person, and for one who has none. */
  avatarUrl: z.string().nullable(),
  capacityHoursPerDay: z.number().int(),
  /**
   * Whether this row is somebody who has since come off the project.
   *
   * They still hold work — taking somebody off a project does not unassign
   * their cards, on purpose, because who was doing it is the fact needed to
   * hand it on. So the row is drawn and says why it has no day behind it,
   * rather than the work going quiet.
   */
  offTheProject: z.boolean(),
  /** Hours falling on each day of the window, one entry per day. */
  hoursByDay: z.array(z.number()).length(TIMELINE_DAYS),
  bars: z.array(timelineBarSchema),
});

export const projectTimelineViewSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    code: z.string(),
  }),
  days: z.array(timelineDaySchema).length(TIMELINE_DAYS),
  groups: z.array(timelineGroupSchema),
  /** Everybody's hours summed per day, which is the footer of the chart. */
  loadByDay: z.array(z.number()).length(TIMELINE_DAYS),
  teamCapacityHoursPerDay: z.number().int(),
  /** Which way the rows are cut, echoed back so the control cannot drift. */
  groupBy: timelineGroupingSchema,
});

export type ProjectTimelineView = z.infer<typeof projectTimelineViewSchema>;
export type TimelineGroup = z.infer<typeof timelineGroupSchema>;
export type TimelineBar = z.infer<typeof timelineBarSchema>;
export type TimelineDay = z.infer<typeof timelineDaySchema>;

/**
 * Who is doing what, and whether it fits.
 *
 * A capacity chart before it is a calendar. Every card with a date on it is
 * spread backwards from that date across as many days as its estimate needs at
 * the assignee's own rate, and the question the screen answers is whether any
 * of those days now holds more hours than the day has.
 *
 * `from` is the first column. Absent means the fortnight starting today, which
 * is what opening the screen should show. `groupBy` decides what a row is;
 * either way the columns, the day load and the question are the same.
 */
export const projectTimelineQuery = defineQuery(
  'projects.timeline',
  z.object({
    slug: projectSlugSchema,
    from: calendarDateSchema.optional(),
    groupBy: timelineGroupingSchema.default('person'),
  }),
  projectTimelineViewSchema,
);
