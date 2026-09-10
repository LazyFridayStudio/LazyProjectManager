import { Link } from '@tanstack/react-router';

import styles from './TaskTabs.module.css';

/**
 * The two ways to look at the same work.
 *
 * The segmented control the timeline groups its rows with, because it is the
 * same kind of choice: one thing to look at, shown one way or the other. A row
 * of underlined tabs would have been a third pattern for a question the product
 * already has an answer to.
 *
 * Links rather than buttons, because a view is an address here: somebody who has
 * the list narrowed to a milestone can paste where they are into a message and
 * the person opening it sees the same thing.
 */
export function TaskTabs({
  slug,
  active,
}: {
  slug: string;
  active: 'board' | 'list';
}): React.JSX.Element {
  return (
    <nav className={styles.tabs} aria-label="Tasks">
      <Link
        to="/p/$slug/tasks"
        params={{ slug }}
        // Exact, or the board reads as current on the list's address too: one
        // is the other's parent, and the router matches a parent by default.
        activeOptions={{ exact: true }}
        className={styles.tab}
        aria-current={active === 'board' ? 'page' : undefined}
      >
        Card board
      </Link>
      <Link
        to="/p/$slug/tasks/all"
        params={{ slug }}
        activeOptions={{ exact: true }}
        className={styles.tab}
        aria-current={active === 'list' ? 'page' : undefined}
      >
        All tasks
      </Link>
    </nav>
  );
}
