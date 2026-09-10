import type { DeletedThing } from '@lpm/shared';

import { AuditNav } from '../audit/AuditNav.js';
import { describeFailure } from '../../api/failure-messages.js';
import { Button, ButtonIcon, Loading, PlusIcon, TrashIcon, useDisplay } from '../ui/index.js';
import { InstallShell } from '../shell/InstallShell.js';
import { useMay } from '../../logic/auth/use-identity.js';
import {
  useDeletedThings,
  usePurgeDeletedThing,
  useRestoreDeletedThing,
} from '../../logic/recovery/use-deleted-things.js';
import styles from './DeletedThingsScreen.module.css';

/**
 * What has been deleted and can still be put back.
 *
 * Deleting is the one thing on this install that cannot be undone by doing the
 * opposite. Everything else has an inverse — rename it back, add them again,
 * move the card where it was — and a delete leaves nothing to act on.
 *
 * So it does not really delete. The rows are copied out first and kept whole
 * for a week, and this is where they wait.
 */
export function DeletedThingsScreen(): React.JSX.Element {
  const bin = useDeletedThings();
  const things = bin.data?.things ?? [];

  return (
    <InstallShell active="audit" title="Recently deleted">
      <AuditNav active="deleted" />

      <p className={styles.about}>
        {bin.data === undefined
          ? 'Deleted things wait here before they are really gone.'
          : `Deleted things wait here for ${String(bin.data.retentionDays)} days, then go for good.`}
      </p>

      {bin.isPending && <Loading what="Looking in the bin" />}

      {bin.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(bin.error)}
        </p>
      )}

      {bin.isSuccess && things.length === 0 && (
        <p className={styles.message}>Nothing has been deleted lately.</p>
      )}

      {things.length > 0 && (
        <ul className={styles.things} aria-label="The bin">
          {things.map((thing) => (
            <Thing key={thing.id} thing={thing} />
          ))}
        </ul>
      )}
    </InstallShell>
  );
}

function Thing({ thing }: { thing: DeletedThing }): React.JSX.Element {
  const restore = useRestoreDeletedThing();
  const purge = usePurgeDeletedThing();
  const display = useDisplay();
  const may = useMay();
  // Whichever of the two went wrong. Only one can be in flight at a time.
  const problem = restore.error ?? purge.error;

  const throwAway = async (): Promise<void> => {
    // Asked about, because this is the one button on the screen that does what
    // the screen exists to prevent.
    const confirmed = await display.askToConfirm({
      question: `Delete ${thing.name} for good?`,
      consequence: 'It will not be in the bin afterwards, and there is no other copy of it.',
      confirmLabel: 'Delete for good',
    });

    if (confirmed) {
      purge.mutate({ deletedThingId: thing.id });
    }
  };

  return (
    <li className={styles.thing}>
      <span className={styles.what}>{thing.what}</span>

      <span className={styles.named}>
        <span className={styles.name}>{thing.name}</span>
        {thing.about !== null && <span className={styles.detail}>{thing.about}</span>}
      </span>

      <span className={styles.byWhom}>
        {/* Something the server did to itself is not nobody, and saying so
            beats a blank where a name goes. */}
        {thing.deletedBy ?? 'the server'}
      </span>

      {/*
        How long is left, not when it went.

        "Deleted 5 days ago" is a fact about the past; "3 days left" is the one
        that decides whether somebody acts now or thinks about it.
      */}
      <span className={styles.left}>{describeTimeLeft(thing.purgeAfter)}</span>

      {/*
        Two permissions, not one.

        Reading the bin, putting something back and making a deletion permanent
        are three different amounts of trust, and a studio can hand out any of
        them alone. Somebody who may only look sees the row and no buttons.
      */}
      <span className={styles.doing}>
        {may('recovery.restore') && (
          <Button
            tone="go"
            aria-label="Put it back"
            title="Put it back"
            onClick={() => {
              restore.mutate({ deletedThingId: thing.id });
            }}
            busy={restore.isPending}
          >
            <ButtonIcon>
              <PlusIcon size={14} />
            </ButtonIcon>
          </Button>
        )}
        {may('recovery.purge') && (
          <Button
            tone="stop"
            aria-label="Delete for good"
            title="Delete for good"
            onClick={() => {
              void throwAway();
            }}
            busy={purge.isPending}
          >
            <ButtonIcon>
              <TrashIcon size={14} />
            </ButtonIcon>
          </Button>
        )}
      </span>

      {problem !== null && (
        <span className={styles.problem} role="alert">
          {describeFailure(problem)}
        </span>
      )}
    </li>
  );
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How much of the week is left.
 *
 * Rounded up, so "1 day left" means there is still some of today rather than
 * that it went at midnight. A thing whose date has passed but which the sweep
 * has not reached yet says so rather than reading "0 days left".
 */
function describeTimeLeft(purgeAfter: string, now: Date = new Date()): string {
  const remaining = new Date(purgeAfter).getTime() - now.getTime();

  if (remaining <= 0) {
    return 'going now';
  }

  const days = Math.ceil(remaining / MS_PER_DAY);

  return days === 1 ? '1 day left' : `${String(days)} days left`;
}
