import { formatDuration, parseDuration, type WorkDone } from '@lpm/shared';
import { useState } from 'react';

import { Avatar, Button, Field } from '../ui/index.js';
import { describeFailure } from '../../api/failure-messages.js';
import { useLogWork, useRemoveWork, type WorkedOnWhat } from '../../logic/work/use-work.js';
import styles from './WorkLog.module.css';

export interface WorkLogProps {
  readonly what: WorkedOnWhat;
  readonly work: WorkDone;
  /** What it was expected to take, for the comparison that is the whole point. */
  readonly estimateMinutes: number | null;
  /** An archived project, or somebody who may read this and not write to it. */
  readonly canWrite: boolean;
}

/**
 * The hours put into a card or an asset, and the box for adding some.
 *
 * One component for both, because an entry is the same thing whichever it hangs
 * off and the two panels ask the same question of it.
 *
 * It is live rather than behind Edit, for the reason the conversation is: coming
 * to a card to say what you did today is the whole errand, and arming every
 * field on the panel to type `3h` would be a strange way to allow it.
 */
export function WorkLog({
  what,
  work,
  estimateMinutes,
  canWrite,
}: WorkLogProps): React.JSX.Element {
  return (
    <section className={styles.section} aria-label="Work">
      <h3 className={styles.heading}>
        Work
        <Totals logged={work.loggedMinutes} estimate={estimateMinutes} />
      </h3>

      {work.entries.length === 0 && <p className={styles.empty}>No hours logged yet.</p>}

      {work.entries.length > 0 && (
        <ul className={styles.entries}>
          {work.entries.map((entry) => (
            <Entry key={entry.id} entry={entry} canWrite={canWrite} />
          ))}
        </ul>
      )}

      {canWrite && <LogSomeWork what={what} />}
    </section>
  );
}

/**
 * What it has taken, and what it was meant to.
 *
 * The percentage only once there is an estimate to be a percentage of — over an
 * estimate of nothing every figure is infinity, and a card nobody estimated is
 * not a card that is over.
 */
function Totals({
  logged,
  estimate,
}: {
  readonly logged: number;
  readonly estimate: number | null;
}): React.JSX.Element | null {
  if (logged === 0 && estimate === null) {
    return null;
  }

  const share = estimate === null || estimate === 0 ? null : Math.round((logged / estimate) * 100);

  return (
    <span className={styles.totals}>
      <strong className={share !== null && share > 100 ? styles.over : undefined}>
        {formatDuration(logged)}
      </strong>
      {estimate !== null && <span className={styles.against}>of {formatDuration(estimate)}</span>}
      {share !== null && <span className={styles.share}>{share}%</span>}
    </span>
  );
}

/** One entry: who, how long, which day, and what it went on. */
function Entry({
  entry,
  canWrite,
}: {
  readonly entry: WorkDone['entries'][number];
  readonly canWrite: boolean;
}): React.JSX.Element {
  const remove = useRemoveWork();

  return (
    <li className={styles.entry}>
      <Avatar
        url={entry.who?.avatarUrl}
        initials={entry.who?.initials ?? '··'}
        className={styles.face}
      />

      <span className={styles.what}>
        <span className={styles.who}>
          {/* Somebody who has left the studio still did the work. */}
          {entry.who?.displayName ?? 'Somebody who has left'} · {entry.workedOn}
        </span>
        {entry.note !== null && entry.note !== '' && (
          <span className={styles.note}>{entry.note}</span>
        )}
      </span>

      <span className={styles.long}>{formatDuration(entry.minutes)}</span>

      {/* Only your own, and only while the card can be written to at all. */}
      {canWrite && entry.isMine && (
        <button
          type="button"
          className={styles.remove}
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate(entry.id);
          }}
        >
          Remove
        </button>
      )}
    </li>
  );
}

/**
 * The box for saying what you did.
 *
 * The duration is read the way an estimate is — `2d 4h`, `90m`, a bare number
 * meaning hours — because a studio that says "half a day" about one should not
 * have to say "240 minutes" about the other.
 *
 * The day defaults to today and can be moved back, because nobody logs as they
 * go: Friday afternoon gets written up on Monday.
 */
function LogSomeWork({ what }: { readonly what: WorkedOnWhat }): React.JSX.Element {
  const [howLong, setHowLong] = useState('');
  const [workedOn, setWorkedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const log = useLogWork(what, () => {
    setHowLong('');
    setNote('');
  });

  const submit = (): void => {
    const parsed = parseDuration(howLong);

    if (!parsed.ok) {
      setProblem(parsed.reason);
      return;
    }

    if (parsed.minutes === null) {
      setProblem('How long did it take? Try 3h, 90m, or 1d 4h.');
      return;
    }

    setProblem(null);
    log.mutate({ minutes: parsed.minutes, workedOn, note: note.trim() === '' ? undefined : note });
  };

  return (
    <div className={styles.adder}>
      <div className={styles.pair}>
        <Field
          label="How long"
          placeholder="3h, 90m, 1d 4h"
          value={howLong}
          onChange={(event) => {
            setHowLong(event.target.value);
          }}
          problem={problem ?? undefined}
        />
        {/* `Day` rather than a second `Worked on`: the box beside this one says
            what the hours went on, and two labels reading the same thing is a
            form where nobody can tell which is which. */}
        <Field
          label="Day"
          type="date"
          value={workedOn}
          onChange={(event) => {
            setWorkedOn(event.target.value);
          }}
        />
      </div>

      {/* The button on the line it finishes, rather than under everything: this
          is the last thing typed, and the press belongs beside it. */}
      <div className={styles.saying}>
        <Field
          label="Worked on"
          placeholder="Optional"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <Button tone="go" busy={log.isPending} busyLabel="Logging…" onClick={submit}>
          Log work
        </Button>
      </div>

      {log.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(log.error)}
        </p>
      )}
    </div>
  );
}
