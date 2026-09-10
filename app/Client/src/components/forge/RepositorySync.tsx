import { formatTimeAgo } from '../../logic/projects/format-project-values.js';
import styles from './RepositorySync.module.css';

/**
 * A repository a screen can fill itself from.
 *
 * Structural rather than an import of either contract, because the board's
 * `IssueSync` and the builds page's `ReleaseSync` are the same three facts
 * about the same connection. A screen hands over whichever it has.
 */
export interface RepositorySync {
  readonly repoFullName: string;
  /**
   * Whether the connection has a credential to read with.
   *
   * Separate from having a connection at all: a project can be wired up for
   * webhooks and still have nothing to ask with, which is the state every Gitea
   * and GitLab connection is in today.
   */
  readonly canRead: boolean;
  /** When it was last read in. Null until somebody has pressed it once. */
  readonly syncedAt: string | null;
  /**
   * When it started failing, and is failing still.
   *
   * Optional because only the issue sync records it — the builds page hands
   * over the same three facts about the same connection and has no fourth.
   */
  readonly failingSince?: string | null;
}

/**
 * Reads a repository in.
 *
 * One control for every screen that has one, because the board and the builds
 * page are asking the same thing of the same connection and two buttons that
 * look different say they are two different things. It was the words `Re-sync`
 * on the builds page and this arrow on the board, which is how somebody learns
 * the product twice.
 *
 * Nothing at all when the repository cannot be read. A button that fails on
 * press is worse than one that is not there, and `RepositorySynced` already
 * says which of the two states a project is in.
 */
export function SyncFromRepository({
  sync,
  what,
  isReading,
  onRead,
}: {
  sync: RepositorySync | null;
  /** The plural noun this reads in — `issues`, `releases`. */
  what: string;
  isReading: boolean;
  /**
   * Handed the repository's name, so the screen saying what it did does not
   * have to narrow a connection this component has already established.
   */
  onRead: (repoFullName: string) => void;
}): React.JSX.Element | null {
  if (sync?.canRead !== true) {
    return null;
  }

  const repoFullName = sync.repoFullName;

  return (
    <button
      type="button"
      className={styles.sync}
      disabled={isReading}
      aria-label={`Sync ${what}`}
      title={`Read the ${what} of ${repoFullName}`}
      onClick={() => {
        onRead(repoFullName);
      }}
    >
      <SyncIcon isTurning={isReading} />
    </button>
  );
}

/**
 * Where the rows come from, when some of them come from a repository.
 *
 * Its own span, because the facts under a heading are separated by the gap
 * between them rather than by punctuation somebody has to read past. Nothing at
 * all when no repository can be read: a project without one should not be told
 * about one, and a page that is filled in by hand says so by having a Record
 * button rather than by captioning itself.
 */
export function RepositorySynced({
  sync,
}: {
  sync: RepositorySync | null;
}): React.JSX.Element | null {
  if (sync?.canRead !== true) {
    return null;
  }

  const failingSince = sync.failingSince ?? null;

  return (
    <span>
      {sync.syncedAt === null
        ? `${sync.repoFullName}, never synced`
        : `${sync.repoFullName}, synced ${formatTimeAgo(sync.syncedAt)}`}
      {failingSince !== null && (
        /*
         * The marker, and only the marker.
         *
         * Without it a repository refusing every attempt reads exactly like one
         * nobody has touched: the timestamp is the last sync that *worked*, so
         * it ages quietly and says nothing. The reason is a sentence, and a
         * sentence belongs on the settings screen where somebody has gone to
         * fix it — this row is facts, set in the monospace face.
         */
        <span className={styles.failing}>
          {` — sync failing since ${formatTimeAgo(failingSince)}`}
        </span>
      )}
    </span>
  );
}

/**
 * A refresh arrow, turning while the reading happens.
 *
 * Inline rather than an icon font, for the reason the nav's are: one shape,
 * sixteen pixels, and it takes its colour from the button around it.
 */
function SyncIcon({ isTurning }: { isTurning: boolean }): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={isTurning ? styles.turning : undefined}
      aria-hidden
      focusable={false}
    >
      <polyline points="15.3 2.7 15.3 6.7 11.3 6.7" />
      <polyline points="0.7 13.3 0.7 9.3 4.7 9.3" />
      <path d="M2.3 6a6 6 0 0 1 9.9-2.24L15.3 6.7" />
      <path d="M0.7 9.3l3.1 2.9A6 6 0 0 0 13.7 10" />
    </svg>
  );
}
