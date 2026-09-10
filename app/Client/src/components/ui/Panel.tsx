import type { ReactNode } from 'react';

import { joinClassNames } from '../../lib/join-class-names.js';
import styles from './Panel.module.css';

interface PanelProps {
  readonly children: ReactNode;
  /**
   * Translucent with a blur, for panels sitting over the animated login canvas.
   * A solid panel there would hide the motes it is meant to float above.
   */
  readonly floating?: boolean;
  readonly className?: string;
}

export function Panel({ children, floating = false, className }: PanelProps): React.JSX.Element {
  return (
    <section
      className={joinClassNames(
        styles.panel,
        styles.padded,
        floating && styles.floating,
        className,
      )}
    >
      {children}
    </section>
  );
}
