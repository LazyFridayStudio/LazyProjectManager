import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'lpm.sidebarCollapsed';

/**
 * Whether the sidebar is narrowed to its icons.
 *
 * Kept in storage rather than in state, for two reasons. Every screen mounts its
 * own shell, so state alone would spring the sidebar open again on the way from
 * the board to the library; and somebody who collapsed it wanted it collapsed,
 * not collapsed until they next opened the app.
 *
 * Storage is unavailable in private-browsing modes and inside some embedded web
 * views. Forgetting the choice is a worse sidebar, not a broken one, so every
 * failure here is swallowed.
 */
export function useSidebarCollapsed(): readonly [boolean, () => void] {
  const [isCollapsed, setIsCollapsed] = useState(readStoredCollapsed);

  // Another tab is another window onto the same install, and a preference that
  // disagreed between them would be one nobody could get right.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) {
        setIsCollapsed(readStoredCollapsed());
      }
    };

    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggle = useCallback(() => {
    setIsCollapsed((collapsed) => {
      const next = !collapsed;

      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Remembered for this page only, which is better than refusing to move.
      }

      return next;
    });
  }, []);

  return [isCollapsed, toggle];
}

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
