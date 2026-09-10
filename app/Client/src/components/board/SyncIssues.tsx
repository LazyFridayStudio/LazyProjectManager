import type { IssueSync } from '@lpm/shared';

import { SyncFromRepository } from '../forge/RepositorySync.js';
import { useSyncIssues } from '../../logic/board/use-board.js';
import { useDisplay } from '../ui/index.js';

/**
 * Reads the repository's issues in.
 *
 * Its own file because both views of the tasks have it: the board and the list
 * are the same work, so they answer to the same button rather than to two that
 * have to be kept in step. The button itself is `SyncFromRepository`, which the
 * builds page has too — this file is only the wiring that knows it is issues
 * being read.
 */
export function SyncIssues({
  projectId,
  issues,
}: {
  projectId: string;
  issues: IssueSync | null;
}): React.JSX.Element | null {
  const syncing = useSyncIssues();
  const { showInfo } = useDisplay();

  return (
    <SyncFromRepository
      sync={issues}
      what="issues"
      isReading={syncing.isPending}
      onRead={(repoFullName) => {
        syncing.mutate(
          { projectId },
          {
            // What arrived is on the screen behind this; the note only says the
            // asking finished, because a board that already looked right gives
            // no other sign that anything happened.
            onSuccess: () => {
              showInfo(`Read the issues of ${repoFullName}.`);
            },
          },
        );
      }}
    />
  );
}
