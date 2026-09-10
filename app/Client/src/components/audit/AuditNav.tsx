import { Link } from '@tanstack/react-router';

import { useMay } from '../../logic/auth/use-identity.js';
import styles from './AuditNav.module.css';

export type AuditView = 'history' | 'deleted';

/**
 * The two halves of the Audit tab.
 *
 * What happened, and what can still be undone — the same question a day apart,
 * so they are one place rather than two links buried on Users. Smaller than the
 * install tabs and in the same idiom, because that is what they are: places
 * inside a place.
 *
 * Recently deleted is drawn only for somebody who may open it. The trail is
 * what the tab is for and is always here; the bin is a second permission, and a
 * studio can hand out one without the other.
 */
export function AuditNav({ active }: { readonly active: AuditView }): React.JSX.Element {
  const may = useMay();

  return (
    <nav className={styles.views} aria-label="Audit">
      <Link
        to="/audit"
        className={styles.view}
        aria-current={active === 'history' ? 'page' : undefined}
      >
        History
      </Link>

      {may('recovery.view') && (
        <Link
          to="/audit/deleted"
          className={styles.view}
          aria-current={active === 'deleted' ? 'page' : undefined}
        >
          Recently deleted
        </Link>
      )}
    </nav>
  );
}
