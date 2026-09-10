import { Link } from '@tanstack/react-router';

import styles from '../board/TaskTabs.module.css';

/**
 * The two kinds of somebody on an install.
 *
 * People sign in and do the work. Agents present a key and do the work
 * somebody has told them to — and everything about them is different enough to
 * warrant its own screen: no password to reset, no address to write to, keys
 * instead, and the instructions for pointing something at this install.
 *
 * The same segmented control the board's views use, because it is the same kind
 * of choice: one screen, shown one way or the other. A second pattern for a
 * question the product already has an answer to would be a third thing to look
 * at and learn.
 *
 * Links rather than buttons, because this is an address: setting an agent up is
 * something somebody gets told to go and do, and a link is a better instruction
 * than "open Users and press Agents".
 */
export function UsersTabs({ active }: { readonly active: 'people' | 'agents' }): React.JSX.Element {
  return (
    <nav className={styles.tabs} aria-label="Users">
      <Link
        to="/users"
        // Exact, or People reads as current on the agents address too: one is
        // the other's parent, and the router matches a parent by default.
        activeOptions={{ exact: true }}
        className={styles.tab}
        aria-current={active === 'people' ? 'page' : undefined}
      >
        People
      </Link>
      <Link
        to="/users/agents"
        activeOptions={{ exact: true }}
        className={styles.tab}
        aria-current={active === 'agents' ? 'page' : undefined}
      >
        Agents
      </Link>
    </nav>
  );
}
