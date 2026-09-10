import { describeCardType, type TaskListView, type TaskRow } from '@lpm/shared';
import { ScreenHeader } from '../shell/ScreenHeader.js';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { useTaskList } from '../../logic/board/use-task-list.js';
import {
  countFilters,
  isFiltering,
  taskRowMatches,
  NO_FILTERS,
  type TaskFilters,
} from '../../logic/board/task-filters.js';
import { peopleOnTheList, someRowIsUnassigned } from '../../logic/board/board-people.js';
import { FiltersButton } from './FiltersButton.js';
import { HeaderRule } from './BoardScreen.js';
import { TaskFilterPanel } from './TaskFilterPanel.js';
import {
  nextSort,
  sortTasks,
  type TaskSort,
  type TaskSortColumn,
} from '../../logic/board/sort-tasks.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { Avatar, Button } from '../ui/index.js';
import { LoadingProject } from '../shell/LoadingProject.js';
import { ProjectShell } from '../shell/ProjectShell.js';
import { CardDetailDialog } from './card-detail/CardDetailDialog.js';
import { NewCardDialog } from './NewCardDialog.js';
import { RepositorySynced } from '../forge/RepositorySync.js';
import { SyncIssues } from './SyncIssues.js';
import { TaskTabs } from './TaskTabs.js';
import styles from './TaskListScreen.module.css';

/**
 * Every task in the project, as a list.
 *
 * The board answers what is happening; this answers what is there. Which is why
 * it shows what a chip has no room for — the milestone, the asset a card is
 * about, whether it is finished — and why it does not hide a closed card the way
 * the board does.
 *
 * Board order rather than by key, so the two views tell the same story: read the
 * board left to right and this top to bottom and the work is in the same
 * sequence.
 */
export function TaskListScreen({ slug }: { slug: string }): React.JSX.Element {
  const tasks = useTaskList(slug);

  if (tasks.isPending) {
    return <LoadingProject slug={slug} active="board" />;
  }

  if (tasks.isError) {
    return (
      <p className={styles.message} role="alert">
        {describeFailure(tasks.error)}
      </p>
    );
  }

  return <TaskList view={tasks.data} />;
}

function TaskList({ view }: { view: TaskListView }): React.JSX.Element {
  /** The milestone the list is narrowed to, or every one of them. */
  const [milestoneId, setMilestoneId] = useState<string | null>(null);
  /** What the list is narrowed to, and whether the panel is open. */
  const [filters, setFilters] = useState<TaskFilters>(NO_FILTERS);
  const [isFilterShown, setIsFilterShown] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<TaskListView['lists'][number] | null>(null);
  /** Which column was pressed, or none — in which case they are in board order. */
  const [sort, setSort] = useState<TaskSort | null>(null);

  const shown = sortTasks(
    view.rows.filter(
      (row) =>
        (milestoneId === null || row.milestone?.id === milestoneId) && taskRowMatches(row, filters),
    ),
    sort,
    view.lists.map((list) => list.name),
  );
  const finished = view.rows.filter((row) => row.closed).length;

  return (
    <ProjectShell project={view.project} active="board">
      <div className={styles.screen}>
        <ScreenHeader
          title="Tasks"
          facts={
            <>
              {/* The count follows the filter, and says so: a number over a
                  narrowed list that counted everything would be answering a
                  question nobody asked. */}
              <span>
                {isFiltering(filters)
                  ? `${String(shown.length)} of ${String(view.rows.length)}`
                  : view.rows.length}{' '}
                cards
              </span>
              <span>{finished} finished</span>
              <RepositorySynced sync={view.issues} />
            </>
          }
          actions={
            <>
              <TaskTabs slug={view.project.slug} active="list" />
              <HeaderRule />
              <FiltersButton
                isOpen={isFilterShown}
                chosen={countFilters(filters)}
                onToggle={() => {
                  setIsFilterShown((shown) => !shown);
                }}
              />
              <HeaderRule />
              {!view.project.archived && (
                <SyncIssues projectId={view.project.id} issues={view.issues} />
              )}
              {!view.project.archived && view.lists.length > 0 && (
                <Button
                  tone="go"
                  onClick={() => {
                    setAddingTo(view.lists[0] ?? null);
                  }}
                >
                  New card
                </Button>
              )}
            </>
          }
        />

        {(isFilterShown || isFiltering(filters)) && (
          <TaskFilterPanel
            filters={filters}
            people={peopleOnTheList(view)}
            hasUnassigned={someRowIsUnassigned(view)}
            onChange={setFilters}
          />
        )}

        <Milestones
          milestones={view.milestones}
          chosen={milestoneId}
          onChoose={setMilestoneId}
          total={view.rows.length}
        />

        <div className={styles.scroller}>
          <TaskTable rows={shown} sort={sort} onSort={setSort} onOpen={setOpened} />

          {/* Filtered and empty is a different sentence from empty. "Nothing
              here yet." under a narrowed list is a lie about the project. */}
          {shown.length === 0 && (
            <p className={styles.message}>
              {isFiltering(filters) ? 'Nothing here matches.' : 'Nothing here yet.'}
            </p>
          )}
        </div>

        {view.omitted > 0 && (
          <p className={styles.truncated}>
            {view.omitted} more are not listed — this shows the first {view.rows.length}.
          </p>
        )}
      </div>

      {addingTo !== null && (
        <NewCardDialog
          projectId={view.project.id}
          projectSlug={view.project.slug}
          list={addingTo}
          onClose={() => {
            setAddingTo(null);
          }}
        />
      )}

      {opened !== null && (
        <CardDetailDialog
          cardId={opened}
          projectSlug={view.project.slug}
          canWrite={!view.project.archived}
          onClose={() => {
            setOpened(null);
          }}
          // A link to another card opens that one here, the way it does on the
          // board. An asset opens on the library, which is where an asset is.
          onOpenCard={setOpened}
          onOpenAsset={() => undefined}
        />
      )}
    </ProjectShell>
  );
}

/** The rows themselves, and the headings that put them in order. */
function TaskTable({
  rows,
  sort,
  onSort,
  onOpen,
}: {
  rows: readonly TaskRow[];
  sort: TaskSort | null;
  onSort: (sort: TaskSort | null) => void;
  onOpen: (cardId: string) => void;
}): React.JSX.Element {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {/* The key is already the order the keys were issued in, and
                    who a card is on and what asset it is about are things you
                    look for rather than read down. */}
          <th scope="col">Key</th>
          <SortableHeading column="type" sort={sort} onSort={onSort}>
            Type
          </SortableHeading>
          <SortableHeading column="summary" sort={sort} onSort={onSort}>
            Summary
          </SortableHeading>
          <SortableHeading column="status" sort={sort} onSort={onSort}>
            Status
          </SortableHeading>
          <SortableHeading column="milestone" sort={sort} onSort={onSort}>
            Milestone
          </SortableHeading>
          <SortableHeading column="priority" sort={sort} onSort={onSort}>
            Priority
          </SortableHeading>
          <SortableHeading column="points" sort={sort} onSort={onSort}>
            Pts
          </SortableHeading>
          <th scope="col">Who</th>
          <th scope="col">Asset</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <TaskRowCells
            key={row.id}
            row={row}
            onOpen={() => {
              onOpen(row.id);
            }}
          />
        ))}
      </tbody>
    </table>
  );
}

/**
 * Which milestone to look at, or all of them.
 *
 * Narrowed here rather than by asking the server again: five hundred rows are
 * already in hand, and a filter that costs a round trip is a filter people stop
 * using.
 */
function Milestones({
  milestones,
  chosen,
  onChoose,
  total,
}: {
  milestones: TaskListView['milestones'];
  chosen: string | null;
  onChoose: (id: string | null) => void;
  total: number;
}): React.JSX.Element | null {
  if (milestones.length === 0) {
    return null;
  }

  return (
    <div className={styles.filters}>
      <button
        type="button"
        className={joinClassNames(styles.filter, chosen === null && styles.filterOn)}
        onClick={() => {
          onChoose(null);
        }}
      >
        Everything <span className={styles.count}>{total}</span>
      </button>

      {milestones.map((milestone) => (
        <button
          key={milestone.id}
          type="button"
          className={joinClassNames(styles.filter, chosen === milestone.id && styles.filterOn)}
          onClick={() => {
            onChoose(milestone.id);
          }}
        >
          {milestone.name}
        </button>
      ))}
    </div>
  );
}

/**
 * A heading that puts the table in its own order.
 *
 * `aria-sort` as well as the arrow, because which column a table is sorted by
 * is the sort of thing a screen reader is expected to announce and an arrow
 * says nothing to one. Pressing the same heading again turns it round, and once
 * more puts the rows back in board order.
 */
function SortableHeading({
  column,
  sort,
  onSort,
  children,
}: {
  column: TaskSortColumn;
  sort: TaskSort | null;
  onSort: (sort: TaskSort | null) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const isSorted = sort?.column === column;
  const direction = isSorted && sort.descending ? 'descending' : 'ascending';

  return (
    <th scope="col" aria-sort={isSorted ? direction : 'none'}>
      <button
        type="button"
        className={styles.heading}
        onClick={() => {
          onSort(nextSort(sort, column));
        }}
      >
        {children}
        <span className={styles.arrow} aria-hidden>
          {isSorted ? (sort.descending ? '↓' : '↑') : ''}
        </span>
      </button>
    </th>
  );
}

/** One card, read across. */
function TaskRowCells({ row, onOpen }: { row: TaskRow; onOpen: () => void }): React.JSX.Element {
  return (
    <tr className={joinClassNames(styles.row, row.closed && styles.done)} onClick={onOpen}>
      <td className={styles.key}>
        {/* The whole row opens the card, and this is what a keyboard reaches
            for: one control per row rather than nine. */}
        <button type="button" className={styles.open} onClick={onOpen}>
          {row.cardKey}
        </button>
      </td>
      <td className={styles.type}>{describeCardType(row.type)}</td>
      <td className={styles.summaryCell}>{row.title}</td>
      <td>
        <span
          className={styles.status}
          style={{ '--list-color': row.listColor } as React.CSSProperties}
        >
          {row.listName}
        </span>
      </td>
      <td className={styles.quiet}>{row.milestone?.name ?? '—'}</td>
      <td className={styles.quiet}>{row.priority ?? '—'}</td>
      <td className={styles.number}>{row.points ?? '—'}</td>
      <td className={styles.quiet}>
        <Avatar
          url={row.assignee?.avatarUrl}
          initials={row.assignee?.initials ?? '—'}
          className={styles.assignee}
        />
      </td>
      <td className={styles.key}>{row.assetKey ?? '—'}</td>
    </tr>
  );
}
