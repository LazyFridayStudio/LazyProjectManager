import { describeRole, type Person, type TeamSummary } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { Avatar, Button } from '../ui/index.js';
import styles from './TeamsScreen.module.css';
import { usePeople } from '../../logic/people/use-people.js';
import { useAddTeamMember, useRemoveTeamMember } from '../../logic/teams/use-teams.js';

/**
 * Who is in one team, and the way to put somebody else in it.
 *
 * The list is paged like the people list, because a team can be most of the
 * studio — an outsourcing partner with two hundred people in it is a team, and
 * a panel that tried to draw all of them would be the screen.
 */
export function TeamMembersPanel({ team }: { team: TeamSummary }): React.JSX.Element {
  const members = usePeople({ search: '', inTeamId: team.teamId });
  const remove = useRemoveTeamMember();

  const listed = members.data?.pages.flatMap((page) => page.people) ?? [];

  return (
    <section className={styles.panel} aria-label={`${team.name} members`}>
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}>{team.name} · members</h2>
        <span className={styles.count}>
          {team.lead === null ? 'no lead' : `led by ${team.lead.displayName}`}
        </span>
      </div>

      {members.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(members.error)}
        </p>
      )}

      {listed.length === 0 && !members.isPending && (
        <p className={styles.message}>Nobody is in this team yet.</p>
      )}

      {listed.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Member</th>
              <th scope="col">Role</th>
              <th scope="col">
                <span className={styles.hidden}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {listed.map((person) => (
              <tr key={person.userId}>
                <td>
                  <span className={styles.person}>
                    <Avatar
                      url={person.avatarUrl}
                      initials={person.initials}
                      className={styles.avatar}
                    />
                    <span className={styles.personName}>{person.displayName}</span>
                  </span>
                </td>
                <td className={styles.role}>{describeRole(person.role)}</td>
                <td className={styles.rowActions}>
                  <button
                    type="button"
                    className={joinClassNames(styles.action, styles.actionStop)}
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.mutate({ teamId: team.teamId, userId: person.userId });
                    }}
                  >
                    Take out
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {members.hasNextPage && (
        <Button
          onClick={() => {
            void members.fetchNextPage();
          }}
          busy={members.isFetchingNextPage}
          busyLabel="Loading…"
        >
          Load more
        </Button>
      )}

      <AddMember team={team} />
    </section>
  );
}

/**
 * Searches the people who are not in the team, and puts one in.
 *
 * Narrowed by the server rather than by filtering a list here: at a thousand
 * people, "everybody except these eight" is still a thousand people to send.
 */
function AddMember({ team }: { team: TeamSummary }): React.JSX.Element {
  const [search, setSearch] = useState('');
  const add = useAddTeamMember();
  const candidates = usePeople({ search: search.trim(), notInTeamId: team.teamId });

  const matches = candidates.data?.pages[0]?.people ?? [];
  const total = candidates.data?.pages[0]?.total ?? 0;

  return (
    <div className={styles.adder}>
      <label className={styles.adderLabel} htmlFor={`add-to-${team.teamId}`}>
        Add somebody to {team.name}
      </label>
      <input
        id={`add-to-${team.teamId}`}
        className={styles.search}
        type="search"
        value={search}
        placeholder="Search by name or email…"
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />

      {search.trim() !== '' && matches.length === 0 && (
        <p className={styles.message}>Nobody left to add by that name.</p>
      )}

      {search.trim() !== '' && matches.length > 0 && (
        <ul className={styles.matches}>
          {matches.slice(0, MATCHES_SHOWN).map((person) => (
            <li key={person.userId}>
              <button
                type="button"
                className={styles.match}
                disabled={add.isPending}
                onClick={() => {
                  add.mutate(
                    { teamId: team.teamId, userId: person.userId },
                    {
                      onSuccess: () => {
                        setSearch('');
                      },
                    },
                  );
                }}
              >
                <Avatar
                  url={person.avatarUrl}
                  initials={person.initials}
                  className={styles.avatar}
                />
                <span className={styles.personName}>{person.displayName}</span>
                <span className={styles.matchEmail}>{person.email}</span>
                <span className={styles.matchTeams}>{describeTeams(person)}</span>
              </button>
            </li>
          ))}
          {total > MATCHES_SHOWN && (
            <li className={styles.matchMore}>
              {total - MATCHES_SHOWN} more — keep typing to narrow it
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** How many candidates a picker shows before it asks for a better search. */
const MATCHES_SHOWN = 6;

/** Where somebody already is, so adding them somewhere else is an informed act. */
function describeTeams(person: Person): string {
  return person.teams.length === 0 ? 'no team' : person.teams.join(', ');
}
