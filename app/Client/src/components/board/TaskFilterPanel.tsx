import { CARD_PRIORITIES, CARD_TYPES, describeCardPriority, describeCardType } from '@lpm/shared';

import { joinClassNames } from '../../lib/join-class-names.js';
import { Avatar } from '../ui/index.js';
import {
  countFilters,
  isFiltering,
  toggle,
  NO_FILTERS,
  UNASSIGNED,
  type TaskFilters,
} from '../../logic/board/task-filters.js';
import styles from './TaskFilterPanel.module.css';

/** Somebody a card can be on, as the panel needs to draw them. */
export interface FilterablePerson {
  readonly userId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
}

export interface TaskFilterPanelProps {
  readonly filters: TaskFilters;
  /** Everybody on a card in this project, whatever is chosen now. */
  readonly people: readonly FilterablePerson[];
  /** Whether any card here has nobody on it, so the choice is worth offering. */
  readonly hasUnassigned: boolean;
  readonly onChange: (filters: TaskFilters) => void;
}

/**
 * What the board is narrowed to.
 *
 * The library's panel, for the same screen full of the same kind of choice:
 * chips rather than checkboxes, and pressing one that is already on is how it
 * comes off. A second idiom for narrowing a screen would be two answers to a
 * question this product has already answered once.
 *
 * The people on offer are everybody on a card rather than only the ones
 * surviving what is already chosen — otherwise choosing one person would empty
 * the row they came from, and there would be no way back except to clear.
 */
export function TaskFilterPanel({
  filters,
  people,
  hasUnassigned,
  onChange,
}: TaskFilterPanelProps): React.JSX.Element {
  const chosen = countFilters(filters);

  return (
    <section className={styles.panel} aria-label="Filters">
      <div className={styles.head}>
        <span className={styles.title}>Filters</span>
        <span className={styles.summary}>{chosen === 0 ? 'none' : `${String(chosen)} chosen`}</span>

        {isFiltering(filters) && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => {
              onChange(NO_FILTERS);
            }}
          >
            Clear all
          </button>
        )}
      </div>

      <People filters={filters} people={people} hasUnassigned={hasUnassigned} onChange={onChange} />

      <div className={styles.group}>
        <span className={styles.groupLabel}>Type</span>
        <div className={styles.chips}>
          {CARD_TYPES.map((type) => (
            <Chip
              key={type}
              label={describeCardType(type)}
              isOn={filters.types.includes(type)}
              onPress={() => {
                onChange({ ...filters, types: toggle(filters.types, type) });
              }}
            >
              <span className={styles.typeDot} data-type={type} aria-hidden />
            </Chip>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>Priority</span>
        <div className={styles.chips}>
          {CARD_PRIORITIES.map((priority) => (
            <Chip
              key={priority}
              label={describeCardPriority(priority)}
              isOn={filters.priorities.includes(priority)}
              onPress={() => {
                onChange({ ...filters, priorities: toggle(filters.priorities, priority) });
              }}
            />
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.groupLabel}>State</span>
        <div className={styles.chips}>
          {/* Three states rather than a switch: a board that has been running a
              while is read all three ways. */}
          <Chip
            label="Hide finished"
            isOn={filters.completed === 'hide'}
            onPress={() => {
              onChange({ ...filters, completed: filters.completed === 'hide' ? 'any' : 'hide' });
            }}
          />
          <Chip
            label="Finished only"
            isOn={filters.completed === 'only'}
            onPress={() => {
              onChange({ ...filters, completed: filters.completed === 'only' ? 'any' : 'only' });
            }}
          />
          <Chip
            label="Blocked"
            isOn={filters.blocked}
            onPress={() => {
              onChange({ ...filters, blocked: !filters.blocked });
            }}
          />
          <Chip
            label="Over its hours"
            isOn={filters.overBudget}
            onPress={() => {
              onChange({ ...filters, overBudget: !filters.overBudget });
            }}
          />
        </div>
      </div>
    </section>
  );
}

/** Whose work, several at once. Its own piece because it is the only group with
 *  anything to work out: who is on offer, and whether nobody is worth offering. */
function People({
  filters,
  people,
  hasUnassigned,
  onChange,
}: Omit<TaskFilterPanelProps, never>): React.JSX.Element {
  return (
    <div className={styles.group}>
      <span className={styles.groupLabel}>Assigned to — matches a card on any of them</span>
      <div className={styles.chips}>
        {people.map((person) => (
          <Chip
            key={person.userId}
            label={person.displayName}
            isOn={filters.assignees.includes(person.userId)}
            onPress={() => {
              onChange({ ...filters, assignees: toggle(filters.assignees, person.userId) });
            }}
          >
            <Avatar url={person.avatarUrl} initials={person.initials} className={styles.chipFace} />
          </Chip>
        ))}

        {/* Nobody's, which is the other question asked of the same board: it is
            how work gets picked up. */}
        {hasUnassigned && (
          <Chip
            label="Unassigned"
            isOn={filters.assignees.includes(UNASSIGNED)}
            onPress={() => {
              onChange({ ...filters, assignees: toggle(filters.assignees, UNASSIGNED) });
            }}
          />
        )}

        {people.length === 0 && !hasUnassigned && (
          <p className={styles.none}>Nothing is on anybody yet.</p>
        )}
      </div>
    </div>
  );
}

interface ChipProps {
  readonly label: string;
  readonly isOn: boolean;
  readonly onPress: () => void;
  readonly children?: React.ReactNode;
}

/** One thing to narrow by, on or off. */
function Chip({ label, isOn, onPress, children }: ChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={joinClassNames(styles.chip, isOn && styles.chipOn)}
      aria-pressed={isOn}
      onClick={onPress}
    >
      {children}
      {label}
    </button>
  );
}
