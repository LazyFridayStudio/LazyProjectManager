import type { Person } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Avatar, Button } from '../ui/index.js';
import { formatTimeAgo } from '../../logic/projects/format-project-values.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { InstallShell } from '../shell/InstallShell.js';
import { NewPersonDialog } from './NewPersonDialog.js';
import { PersonGroupsDialog } from './PersonGroupsDialog.js';
import { ResetPasswordDialog } from './ResetPasswordDialog.js';
import styles from './UsersScreen.module.css';
import { usePeople, useSetUserStatus } from '../../logic/people/use-people.js';
import { UsersTabs } from './UsersTabs.js';

/**
 * Everybody on this install, and what each of them may do.
 *
 * Admins only. It names every person on the server, including the ones whose
 * projects the caller was never added to — which is the point of it, and the
 * reason the query behind it is behind the strictest role.
 */
export function UsersScreen(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [resetting, setResetting] = useState<Person | null>(null);
  const [editingGroups, setEditingGroups] = useState<Person | null>(null);
  const people = usePeople({ search: search.trim() });

  return (
    <InstallShell
      active="users"
      title="Users"
      actions={
        <>
          <UsersTabs active="people" />
          <input
            className={styles.search}
            type="search"
            value={search}
            placeholder="Search people…"
            aria-label="Search people"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
          <Button
            tone="go"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            New person
          </Button>
        </>
      }
    >
      <PeopleSection
        people={people}
        search={search.trim()}
        onResetPassword={setResetting}
        onEditGroups={setEditingGroups}
      />

      {isAdding && (
        <NewPersonDialog
          onClose={() => {
            setIsAdding(false);
          }}
        />
      )}

      {resetting !== null && (
        <ResetPasswordDialog
          person={resetting}
          onClose={() => {
            setResetting(null);
          }}
        />
      )}

      {editingGroups !== null && (
        <PersonGroupsDialog
          person={editingGroups}
          onClose={() => {
            setEditingGroups(null);
          }}
        />
      )}
    </InstallShell>
  );
}

interface PeopleSectionProps {
  readonly people: ReturnType<typeof usePeople>;
  /** What was typed, so an empty list can say which of the two empties it is. */
  readonly search: string;
  readonly onResetPassword: (person: Person) => void;
  readonly onEditGroups: (person: Person) => void;
}

/**
 * The list, and whatever it is doing instead of being a list.
 *
 * Loading, failed and empty live here with the table rather than beside it in
 * the screen, because they are the same thing in four states — and a screen
 * that branches four ways before it draws anything stops reading as a screen.
 */
function PeopleSection({
  people,
  search,
  onResetPassword,
  onEditGroups,
}: PeopleSectionProps): React.JSX.Element {
  const pages = people.data?.pages ?? [];
  const listed = pages.flatMap((page) => page.people);

  if (people.isPending) {
    return <p className={styles.message}>Loading people…</p>;
  }

  if (people.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(people.error)}
      </p>
    );
  }

  if (listed.length === 0) {
    return (
      <p className={styles.message}>
        {search === '' ? 'Nobody here yet.' : `Nobody matches “${search}”.`}
      </p>
    );
  }

  return (
    <>
      <PeopleTable
        people={listed}
        total={pages[0]?.total ?? listed.length}
        onResetPassword={onResetPassword}
        onEditGroups={onEditGroups}
      />

      {people.hasNextPage && (
        <div className={styles.more}>
          <Button
            onClick={() => {
              void people.fetchNextPage();
            }}
            busy={people.isFetchingNextPage}
            busyLabel="Loading…"
          >
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

interface PeopleTableProps {
  readonly people: readonly Person[];
  /** Everybody the search matched, which is more than one page of them. */
  readonly total: number;
  readonly onResetPassword: (person: Person) => void;
  readonly onEditGroups: (person: Person) => void;
}

/**
 * The people, as a table.
 *
 * A real one, because this is one: a heading per column and a row per person,
 * so a screen reader moving across a row can say which column each cell is in.
 * The grid of divs the prototype draws would need all of that bolted back on.
 */
function PeopleTable({
  people,
  total,
  onResetPassword,
  onEditGroups,
}: PeopleTableProps): React.JSX.Element {
  return (
    <section className={styles.panel} aria-label="People">
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}>People</h2>
        <span className={styles.count}>
          {people.length === total
            ? `${String(total)} on this server`
            : `${String(people.length)} of ${String(total)}`}
        </span>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Email</th>
            <th scope="col">Permissions</th>
            <th scope="col">Teams</th>
            <th scope="col">Last seen</th>
            <th scope="col">
              <span className={styles.hidden}>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <PersonRow
              key={person.userId}
              person={person}
              onResetPassword={() => {
                onResetPassword(person);
              }}
              onEditGroups={() => {
                onEditGroups(person);
              }}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * One person.
 *
 * What they may do is a summary and a way in rather than a control on the row.
 * It was a role dropdown — one of five rungs, each standing for a bundle of
 * permissions nobody could read off the screen — and a group says the same
 * thing by name instead of by rank.
 */
function PersonRow({
  person,
  onResetPassword,
  onEditGroups,
}: {
  readonly person: Person;
  readonly onResetPassword: () => void;
  readonly onEditGroups: () => void;
}): React.JSX.Element {
  const setStatus = useSetUserStatus();
  const isSuspended = person.status === 'suspended';

  return (
    <tr className={joinClassNames(isSuspended && styles.suspendedRow)}>
      <td>
        <span className={styles.person}>
          <Avatar url={person.avatarUrl} initials={person.initials} className={styles.avatar} />
          <span className={styles.personName}>{person.displayName}</span>
          {isSuspended && <span className={styles.suspendedTag}>Suspended</span>}
          {/* Said on the row rather than only in the refusal, so nobody
              reaches for a control that will turn them down. */}
          {person.isInstallOwner && (
            <span className={styles.ownerTag} title="They set this install up">
              Install owner
            </span>
          )}
        </span>
      </td>

      <td className={styles.email}>{person.email}</td>

      <td>
        <button
          type="button"
          className={styles.groupsCell}
          onClick={onEditGroups}
          aria-label={`Permissions for ${person.displayName}`}
        >
          {person.permissionGroups.length === 0
            ? 'no groups'
            : person.permissionGroups.map((group) => group.name).join(', ')}
        </button>
      </td>

      {/* Where they belong, which is the other half of what they may do. */}
      <td className={styles.teams}>{person.teams.join(', ') || 'no team'}</td>

      <td className={styles.lastSeen}>
        {person.lastSeenAt === null ? 'never' : formatTimeAgo(person.lastSeenAt)}
      </td>

      <td className={styles.actions}>
        <button type="button" className={styles.action} onClick={onResetPassword}>
          Reset password
        </button>
        {/* The owner cannot be suspended, so there is nothing to offer. Reset
            password stays: it is theirs to use on themselves. */}
        {!person.isInstallOwner && (
          <button
            type="button"
            // One control doing two opposite jobs. Letting somebody back in is
            // not a removal, so it is not red.
            className={joinClassNames(styles.action, !isSuspended && styles.actionStop)}
            disabled={setStatus.isPending}
            onClick={() => {
              setStatus.mutate({
                userId: person.userId,
                status: isSuspended ? 'active' : 'suspended',
              });
            }}
          >
            {isSuspended ? 'Let back in' : 'Suspend'}
          </button>
        )}
      </td>
    </tr>
  );
}
