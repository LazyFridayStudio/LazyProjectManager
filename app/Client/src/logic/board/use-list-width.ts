import { useCallback, useEffect, useState } from 'react';

import { keepListWidthUsable, readListWidth } from './list-width.js';

const STORAGE_KEY = 'lpm.listWidth';

/**
 * How wide this person likes the board's columns.
 *
 * On their machine and nowhere else. Two people can want different things about
 * the same board and both be right, and a width that synced would mean the
 * first person to drag a column decided the board for everybody — which is the
 * opposite of what this is for.
 *
 * One width for every board rather than one per project. "I like wider columns"
 * is a thing about a person and their screen, not about a project, and the
 * alternative is a setting to get right again on every board they open.
 *
 * Kept in storage rather than in state for the reasons the sidebar's width is:
 * every screen mounts its own shell, so state alone would spring the columns
 * back to the default on the way from the board to the library — and somebody
 * who widened them wanted them widened, not widened until they next open the
 * app. Storage is unavailable in private browsing and inside some embedded web
 * views, and forgetting the width is a worse board rather than a broken one, so
 * every failure here is swallowed.
 */
export function useListWidth(): readonly [number, (width: number) => void] {
  const [width, setWidth] = useState(readStoredListWidth);

  // Another tab is another window onto the same board, and a preference that
  // disagreed between them would be one nobody could get right.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) {
        setWidth(readStoredListWidth());
      }
    };

    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const keep = useCallback((wanted: number) => {
    const next = keepListWidthUsable(wanted);

    setWidth(next);

    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Remembered for this page only, which is better than refusing to move.
    }
  }, []);

  return [width, keep];
}

function readStoredListWidth(): number {
  try {
    return readListWidth(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return readListWidth(null);
  }
}
