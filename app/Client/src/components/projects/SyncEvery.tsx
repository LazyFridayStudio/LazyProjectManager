import { useState } from 'react';

import { describeSyncEvery, SYNC_EVERY_CHOICES, type ProjectDetailView } from '@lpm/shared';

import { describeFailure } from '../../api/failure-messages.js';
import { useUpdateProject } from '../../logic/projects/index.js';
import { Select, type SelectOption } from '../ui/index.js';
import styles from './SyncEvery.module.css';

/**
 * How often this board reads its repository without being asked.
 *
 * Beside the connection it governs, because it is a fact about how this board
 * reads that repository rather than about the credentials it reads with.
 *
 * A short list rather than a number somebody types: the useful answers are "as
 * fast as it goes", "a few times an hour" and "leave it alone", and a minute is
 * the floor because a sync costs requests against somebody else's rate limit.
 */
export function SyncEvery({ detail }: { readonly detail: ProjectDetailView }): React.JSX.Element {
  const updateProject = useUpdateProject();
  const [everySeconds, setEverySeconds] = useState(detail.syncEverySeconds);

  const set = (wanted: number | null): void => {
    setEverySeconds(wanted);
    updateProject.mutate(
      { projectId: detail.project.id, syncEverySeconds: wanted },
      {
        // Put back what the server still has, rather than leaving a control
        // showing a state nothing was saved in.
        onError: () => {
          setEverySeconds(detail.syncEverySeconds);
        },
      },
    );
  };

  return (
    <div className={styles.setting}>
      <Select
        label="Sync"
        options={OPTIONS}
        value={everySeconds === null ? OFF : String(everySeconds)}
        disabled={updateProject.isPending}
        onChange={(event) => {
          set(event.target.value === OFF ? null : Number(event.target.value));
        }}
      />

      <p className={styles.explanation}>
        How often the board reads the repository on its own. A merge that closes an issue is picked
        up straight away whatever this says — the repository tells us — so this is the clock
        underneath, for the delivery that never arrived and everything that changed while the server
        was off.
      </p>

      {updateProject.error !== null && (
        <p className={styles.problem}>{describeFailure(updateProject.error)}</p>
      )}
    </div>
  );
}

/**
 * The value standing for no clock at all.
 *
 * A `select` deals in strings and an empty one reads as "nothing chosen", which
 * is a different thing from choosing Off.
 */
const OFF = 'off';

const OPTIONS: readonly SelectOption[] = [
  ...SYNC_EVERY_CHOICES.map((seconds) => ({
    value: String(seconds),
    label: describeSyncEvery(seconds),
  })),
  { value: OFF, label: describeSyncEvery(null) },
];
