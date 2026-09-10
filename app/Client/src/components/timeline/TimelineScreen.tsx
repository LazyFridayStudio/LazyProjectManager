import { useState } from 'react';
import { ScreenHeader } from '../shell/ScreenHeader.js';
import {
  describeTimelineGrouping,
  TIMELINE_DAYS,
  TIMELINE_GROUPINGS,
  type ProjectTimelineView,
  type TimelineGroup,
  type TimelineGrouping,
} from '@lpm/shared';

import { Avatar, Button, ChevronIcon } from '../ui/index.js';
import { describeFailure } from '../../api/failure-messages.js';
import { LoadingProject } from '../shell/LoadingProject.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import { addDays, describeLoad, formatHours } from '../../logic/timeline/timeline-arithmetic.js';
import { useTimeline } from '../../logic/timeline/use-timeline.js';
import styles from './TimelineScreen.module.css';

/**
 * Who is doing what over the next fortnight, and whether it fits.
 *
 * A capacity chart before it is a calendar. Every card with a date on it is
 * spread backwards from that date across as many days as its estimate needs at
 * the assignee's own rate, and the colour of a day says whether that day now
 * holds more hours than the day has.
 */
export function TimelineScreen({ slug }: { slug: string }): React.JSX.Element {
  // Undefined means the fortnight starting today, which is what the server
  // works out — a client that decided "today" for itself would disagree with
  // the install on the far side of midnight.
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [groupBy, setGroupBy] = useState<TimelineGrouping>('person');
  const timeline = useTimeline(slug, from, groupBy);

  if (timeline.isPending) {
    return <LoadingProject slug={slug} active="timeline" />;
  }

  if (timeline.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(timeline.error)}
      </p>
    );
  }

  return <Timeline view={timeline.data} onMove={setFrom} onGroup={setGroupBy} />;
}

function Timeline({
  view,
  onMove,
  onGroup,
}: {
  view: ProjectTimelineView;
  onMove: (from: string | undefined) => void;
  onGroup: (grouping: TimelineGrouping) => void;
}): React.JSX.Element {
  const first = view.days[0]?.date ?? '';
  const last = view.days[TIMELINE_DAYS - 1]?.date ?? '';

  return (
    <ProjectShell project={view.project} active="timeline">
      <div className={styles.screen}>
        <ScreenHeader
          title="Timeline"
          facts={
            <span>
              {formatDay(first)} → {formatDay(last)}
            </span>
          }
          actions={
            <>
              {/* Three of the design's four. By legend task needs a concept this
              product does not have yet. */}
              <div className={styles.grouping} role="radiogroup" aria-label="Group rows by">
                {TIMELINE_GROUPINGS.map((grouping) => (
                  <button
                    key={grouping}
                    type="button"
                    role="radio"
                    className={styles.groupingOption}
                    aria-checked={view.groupBy === grouping}
                    onClick={() => {
                      onGroup(grouping);
                    }}
                  >
                    {describeTimelineGrouping(grouping)}
                  </button>
                ))}
              </div>

              <div className={styles.moves}>
                <Button
                  type="button"
                  onClick={() => {
                    onMove(addDays(first, -TIMELINE_DAYS));
                  }}
                >
                  ← Fortnight
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onMove(undefined);
                  }}
                >
                  Today
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onMove(addDays(first, TIMELINE_DAYS));
                  }}
                >
                  Fortnight →
                </Button>
              </div>
            </>
          }
        />

        <div className={styles.body}>
          <div className={styles.legend}>
            <span>{String(view.teamCapacityHoursPerDay)}h a day team capacity</span>
            <Key tone="within" label="within capacity" />
            <Key tone="near" label="near" />
            <Key tone="over" label="over" />
          </div>

          {view.groups.length === 0 ? (
            <p className={styles.empty}>{describeNothingToDraw(view.groupBy)}</p>
          ) : (
            <Chart view={view} />
          )}
        </div>
      </div>
    </ProjectShell>
  );
}

/**
 * The grid itself.
 *
 * It scrolls sideways rather than compressing: fourteen columns narrower than
 * about forty pixels stop holding a number, and a chart whose numbers cannot be
 * read is decoration.
 */
function Chart({ view }: { view: ProjectTimelineView }): React.JSX.Element {
  return (
    <div className={styles.scroller}>
      <div className={styles.chart}>
        <div className={styles.headRow}>
          <span className={styles.rowHead}>Row</span>
          <div className={styles.days}>
            {view.days.map((day) => (
              <span
                key={day.date}
                className={styles.day}
                data-today={day.isToday}
                data-weekend={day.isWeekend}
                data-milestone={day.milestoneName !== null}
                title={day.milestoneName ?? undefined}
              >
                <span className={styles.dayName}>{day.weekday}</span>
                <span className={styles.dayNumber}>{String(day.dayOfMonth)}</span>
                {/* A deadline belongs to the date, so it is marked here rather
                    than in a row that only one grouping would show. */}
                {day.milestoneName !== null && (
                  <span className={styles.dayMilestone}>{day.milestoneName}</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {view.groups.map((group) => (
          <Group key={group.id} group={group} view={view} />
        ))}

        <div className={styles.loadRow}>
          <span className={styles.rowHead}>Day load</span>
          <div className={styles.days}>
            {view.loadByDay.map((hours, index) => (
              <span
                key={view.days[index]?.date ?? String(index)}
                className={styles.loadCell}
                title={`${formatHours(hours)} of ${String(view.teamCapacityHoursPerDay)}h`}
              >
                <span className={styles.loadTrack}>
                  <span
                    className={styles.loadFill}
                    style={{ height: `${String(share(hours, view.teamCapacityHoursPerDay))}%` }}
                    data-tone={describeLoad(hours, view.teamCapacityHoursPerDay)}
                  />
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** One person, their days, and the cards those days are made of. */
function Group({
  group,
  view,
}: {
  group: TimelineGroup;
  view: ProjectTimelineView;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(true);
  const total = group.hoursByDay.reduce((sum, hours) => sum + hours, 0);

  return (
    <div className={styles.group}>
      <button
        type="button"
        className={styles.groupHead}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        aria-expanded={isOpen}
      >
        <span className={styles.groupName}>
          <ChevronIcon isOpen={isOpen} size={10} className={styles.chevron} />
          {group.initials !== null && (
            <Avatar url={group.avatarUrl} initials={group.initials} className={styles.initials} />
          )}
          <span className={styles.names}>
            <span className={styles.person}>{group.name}</span>
            <span className={styles.personNote}>
              {describeRowCapacity(group, view.groupBy)}
              {' · '}
              {formatHours(total)} on
            </span>
          </span>
        </span>

        <span className={styles.days}>
          {group.hoursByDay.map((hours, index) => (
            <span
              key={view.days[index]?.date ?? String(index)}
              className={styles.cell}
              data-tone={describeLoad(hours, group.capacityHoursPerDay)}
              data-weekend={view.days[index]?.isWeekend ?? false}
            >
              {hours === 0 ? '' : formatHours(hours)}
            </span>
          ))}
        </span>
      </button>

      {isOpen &&
        group.bars.map((bar) => (
          <div key={bar.cardId} className={styles.bandRow}>
            <span className={styles.bandName}>
              <span className={styles.bandTitle}>{bar.title}</span>
              <span className={styles.bandNote}>
                {bar.cardKey} · {bar.estimated ? formatHours(bar.hours) : 'no estimate'}
              </span>
            </span>
            <span className={styles.band}>
              <span className={styles.bandTrack}>
                {view.days.map((day) => (
                  <span key={day.date} className={styles.bandCell} data-weekend={day.isWeekend} />
                ))}
              </span>
              <span
                className={styles.bar}
                title={`${bar.title} — ${bar.listName}`}
                data-clipped={bar.startsEarlier}
                style={{
                  left: `${String((bar.startIndex / TIMELINE_DAYS) * 100)}%`,
                  width: `${String((bar.spanDays / TIMELINE_DAYS) * 100)}%`,
                  background: bar.listColor ?? 'var(--color-accent)',
                }}
              />
            </span>
          </div>
        ))}

      {isOpen && group.bars.length === 0 && (
        <p className={styles.free}>Nothing dated in this fortnight.</p>
      )}
    </div>
  );
}

function Key({ tone, label }: { tone: string; label: string }): React.JSX.Element {
  return (
    <span className={styles.key}>
      <span className={styles.keySwatch} data-tone={tone} aria-hidden />
      {label}
    </span>
  );
}

/** How full a day is, capped so the tallest bar is the height of its track. */
function share(hours: number, capacity: number): number {
  if (capacity === 0) return hours > 0 ? 100 : 0;

  return Math.min(100, Math.round((hours / capacity) * 100));
}

/**
 * What a row has behind it, in a few words under the name.
 *
 * Somebody off the project is the case worth naming rather than leaving as
 * `no capacity`: they hold work here and have not promised the project a day,
 * and the row exists so the work can be handed on. Told apart from the row for
 * work nobody was ever given, which has no capacity for a different reason.
 */
function describeRowCapacity(group: TimelineGroup, groupBy: TimelineGrouping): string {
  if (group.offTheProject) return 'no longer on the project';

  if (group.capacityHoursPerDay === 0) return 'no capacity';

  const across = groupBy === 'milestone' ? ' across the team' : '';

  return `${String(group.capacityHoursPerDay)}h a day${across}`;
}

/**
 * Why the chart is empty, in the terms of the cut that came back empty.
 *
 * Each grouping runs out for its own reason, and the way out differs: a project
 * with nobody on it needs staffing, one with no teams on it needs a team added
 * on its settings screen, and a fortnight with no milestone in it may be
 * perfectly healthy. A single message would send two of the three to the wrong
 * screen.
 */
function describeNothingToDraw(groupBy: TimelineGrouping): string {
  if (groupBy === 'person') {
    return 'Nobody is on this project yet. The timeline is the team’s fortnight, so it needs a team first.';
  }

  if (groupBy === 'team') {
    return 'No team is on this project, and nobody has been added to it by name either.';
  }

  return 'No milestone lands in this fortnight, and nothing is dated in it either.';
}

/** `24 Aug`, which is the short form the design uses for a column of dates. */
function formatDay(date: string): string {
  if (date === '') return '';

  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  return `${String(Number(date.slice(8)))} ${MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}`;
}
