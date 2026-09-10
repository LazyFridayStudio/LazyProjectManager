import {
  AUDIT_SUBJECT_KINDS,
  describeDomainEvent,
  type AuditEntry,
  type AuditSubjectKind,
} from '@lpm/shared';
import { useState } from 'react';

import { AuditNav } from './AuditNav.js';
import { describeFailure } from '../../api/failure-messages.js';
import { Avatar, Button, Loading } from '../ui/index.js';
import { InstallShell } from '../shell/InstallShell.js';
import { formatTimeAgo } from '../../logic/projects/format-project-values.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { useAuditTrail } from '../../logic/audit/use-audit-trail.js';
import { useDebouncedValue } from '../../logic/assets/use-debounced-value.js';
import styles from './AuditTrailScreen.module.css';

/**
 * What has happened on this install.
 *
 * Reads `domain_event`, which every command appends to in the same transaction
 * as its write — so this is not a log somebody remembered to add a line to. If a
 * change happened, it is here.
 *
 * Read-only: there is nothing to press, because the point of a record is that
 * it is not something anybody can tidy. Who may read it is `audit.view`, which a
 * permission group can hand to somebody who is not an owner.
 */
export function AuditTrailScreen(): React.JSX.Element {
  const [kind, setKind] = useState<AuditSubjectKind | null>(null);
  const [typed, setTyped] = useState('');
  // Debounced, because the trail is every write the install has ever made and
  // asking again on each keystroke is asking the database to scan it per letter.
  const search = useDebouncedValue(typed);
  const trail = useAuditTrail({ ...(kind === null ? {} : { kind }), search });
  const entries = trail.data?.pages.flatMap((page) => page.entries) ?? [];
  const isNarrowed = kind !== null || search.trim() !== '';

  return (
    <InstallShell
      active="audit"
      title="Audit trail"
      actions={
        <input
          className={styles.search}
          type="search"
          value={typed}
          placeholder="A card key, a name, or what happened…"
          aria-label="Search the trail"
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
      }
    >
      <AuditNav active="history" />

      {/* One row, matched against what a thing is rather than against what was
          done to it: "cards" is the question somebody has, and "created" is
          what the search box is for. */}
      <div className={styles.kinds} role="radiogroup" aria-label="Show which kind of thing">
        <Kind
          name="Everything"
          isPicked={kind === null}
          onPick={() => {
            setKind(null);
          }}
        />
        {AUDIT_SUBJECT_KINDS.map((each) => (
          <Kind
            key={each}
            name={describeSubjectKind(each)}
            isPicked={kind === each}
            onPick={() => {
              setKind(each);
            }}
          />
        ))}
      </div>

      {trail.isPending && <Loading what="Loading the trail" />}

      {trail.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(trail.error)}
        </p>
      )}

      {trail.isSuccess && entries.length === 0 && (
        <p className={styles.message}>
          {isNarrowed
            ? 'Nothing matches that. The trail holds every write this install has made, so a search that finds none means those words are not in it.'
            : 'Nothing has happened yet.'}
        </p>
      )}

      {entries.length > 0 && (
        <ul className={styles.entries} aria-label="The trail">
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {trail.hasNextPage && (
        <div className={styles.more}>
          <Button
            onClick={() => {
              void trail.fetchNextPage();
            }}
            busy={trail.isFetchingNextPage}
            busyLabel="Loading…"
          >
            Load more
          </Button>
        </div>
      )}
    </InstallShell>
  );
}

function Entry({ entry }: { entry: AuditEntry }): React.JSX.Element {
  return (
    <li className={styles.entry}>
      <Avatar
        url={entry.actor?.avatarUrl}
        initials={entry.actor?.initials ?? '··'}
        className={styles.who}
      />

      <span className={styles.what}>
        {/* The event name in words. An unmapped one shows as itself rather than
            as nothing, which is how it gets noticed and given a phrase. */}
        {describeDomainEvent(entry.name)}
        {entry.subject.label !== null && (
          <span className={styles.subject}>{entry.subject.label}</span>
        )}
      </span>

      <span className={styles.byWhom}>
        {/* Something the server did to itself is not nobody, and saying so is
            better than a blank where a name goes. */}
        {entry.actor?.displayName ?? 'the server'}
      </span>

      <time className={styles.when} dateTime={entry.occurredAt}>
        {formatTimeAgo(entry.occurredAt)}
      </time>
    </li>
  );
}

/** One chip in the row: a kind of thing, or all of them. */
function Kind({
  name,
  isPicked,
  onPick,
}: {
  name: string;
  isPicked: boolean;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isPicked}
      className={joinClassNames(styles.kind, isPicked && styles.kindPicked)}
      onClick={onPick}
    >
      {name}
    </button>
  );
}

/** `board` is what the column holds; "lists" is what somebody calls it. */
function describeSubjectKind(kind: AuditSubjectKind): string {
  const words: Readonly<Record<AuditSubjectKind, string>> = {
    card: 'Cards',
    project: 'Projects',
    board: 'Lists',
    install: 'The install',
    user: 'People',
    team: 'Teams',
  };

  return words[kind];
}
