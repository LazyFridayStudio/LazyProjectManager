import type { ReactNode } from 'react';

import styles from './ButtonIcon.module.css';

/**
 * The mark inside a button, wherever one is drawn instead of a word.
 *
 * One wrapper rather than the same `height: 1lh` span written into each screen
 * that needed it — there were three copies of it before this, which is how a
 * row of buttons ends up a pixel taller on one screen than on the next.
 *
 * The word has not gone anywhere: it is the button's `aria-label` and `title`,
 * which is what a screen reader says and what a hover shows. See **What mark a
 * control carries** in `docs/Engineering-Rules.md`.
 */
export function ButtonIcon({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className={styles.buttonIcon}>{children}</span>;
}
