import { useState } from 'react';

import type { ProjectDetailView } from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { useUpdateProject } from '../../logic/projects/index.js';
import styles from './OpenIssuesOnly.module.css';

/**
 * Whether a sync brings in the repository's closed history.
 *
 * Beside the connection it governs rather than in the Project panel above,
 * because it is a fact about how this board reads that repository.
 *
 * It says what it governs, because "only sync open issues" reads as though it
 * might tidy up behind itself. It does not: cards already made from closed
 * issues stay where they are, and a card that already stands for an issue still
 * moves when that issue closes — the sync asks for those separately, which is
 * what stops the board drifting out of step while this is on.
 */
export function OpenIssuesOnly({
  detail,
}: {
  readonly detail: ProjectDetailView;
}): React.JSX.Element {
  const updateProject = useUpdateProject();
  const [openOnly, setOpenOnly] = useState(detail.syncOpenIssuesOnly);

  const set = (wanted: boolean): void => {
    setOpenOnly(wanted);
    updateProject.mutate(
      { projectId: detail.project.id, syncOpenIssuesOnly: wanted },
      {
        // Put back what the server still has, rather than leaving a switch
        // showing a state nothing was saved in.
        onError: () => {
          setOpenOnly(detail.syncOpenIssuesOnly);
        },
      },
    );
  };

  return (
    <div className={styles.setting}>
      <label className={styles.row}>
        <input
          type="checkbox"
          checked={openOnly}
          disabled={updateProject.isPending}
          onChange={(event) => {
            set(event.target.checked);
          }}
        />
        <span>Only sync open issues</span>
      </label>

      <p className={styles.explanation}>
        A sync reads a hundred issues. With this on they are a hundred open ones, rather than
        whatever was raised most recently — which on a repository with a past is mostly closed work.
        Nothing already on the board is removed, and a card whose issue closes still moves to the
        end.
      </p>

      {updateProject.error !== null && (
        <p className={styles.problem}>{describeFailure(updateProject.error)}</p>
      )}
    </div>
  );
}
