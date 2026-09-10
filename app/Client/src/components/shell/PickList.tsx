import { useState } from 'react';

import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './PickList.module.css';

/**
 * Above this many, the list needs a way to be narrowed.
 *
 * Below it a search box is a control with nothing to do, and the list is short
 * enough to read by scanning. A studio can have a hundred permission groups and
 * as many teams, and neither is a thing anybody finds by scrolling.
 */
const ENOUGH_TO_SEARCH = 8;

/** One thing in the list: what it is called, and what it costs to read it. */
export interface Pickable {
  readonly id: string;
  readonly name: string;
  /**
   * The line under the name.
   *
   * What somebody would otherwise have to open the thing to find out — how many
   * rules a group holds, how many people are in a team. Not a description: a
   * list of twenty of these is read by scanning the second line.
   */
  readonly facts: string;
}

/**
 * A list of things down the side, and the one that was picked beside it.
 *
 * Two install screens want this and a third will: a studio has tens of teams
 * and tens of permission groups, each with more to say than fits on a tile, so
 * the shape is a list you scan and one thing open next to it.
 *
 * Together in one component rather than two stylesheets that match today. The
 * teams screen was a grid of tiles with the panels underneath, which meant the
 * two screens were laid out differently for no reason anybody could name.
 */
export function PickLayout({
  list,
  children,
}: {
  readonly list: React.ReactNode;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.layout}>
      {list}
      {/* A line you can see beats a gap you have to infer, and the two halves
          are doing different jobs. */}
      <div className={styles.splitter} aria-hidden />
      <div className={styles.detail}>{children}</div>
    </div>
  );
}

export function PickList({
  label,
  items,
  pickedId,
  onPick,
}: {
  /** What the list is of, for anybody navigating by landmark. */
  readonly label: string;
  readonly items: readonly Pickable[];
  readonly pickedId: string | null;
  readonly onPick: (id: string) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const wanted = search.trim().toLowerCase();
  const shown =
    wanted === ''
      ? items
      : items.filter(
          (item) =>
            item.name.toLowerCase().includes(wanted) || item.facts.toLowerCase().includes(wanted),
        );

  return (
    <nav className={styles.list} aria-label={label}>
      {items.length > ENOUGH_TO_SEARCH && (
        <input
          className={styles.search}
          type="search"
          value={search}
          placeholder="Find one…"
          aria-label={`Find in ${label.toLowerCase()}`}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      )}

      {shown.length === 0 && <p className={styles.nothing}>Nothing matches that.</p>}

      <ul className={styles.items}>
        {shown.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={joinClassNames(styles.item, item.id === pickedId && styles.picked)}
              aria-current={item.id === pickedId ? 'true' : undefined}
              onClick={() => {
                onPick(item.id);
              }}
            >
              <span className={styles.name}>{item.name}</span>
              <span className={styles.facts}>{item.facts}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
