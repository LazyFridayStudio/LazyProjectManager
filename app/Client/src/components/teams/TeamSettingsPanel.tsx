import type { TeamSummary } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure, readFieldProblems } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { Avatar, Button, Field } from '../ui/index.js';
import styles from './TeamsScreen.module.css';
import { usePeople } from '../../logic/people/use-people.js';
import { useUpdateTeam } from '../../logic/teams/use-teams.js';

/**
 * What a team is called and who answers for it.
 *
 * The lead is chosen from the team's own members: leading a team you are not in
 * is a state somebody would have to explain, and a picker that allows it is how
 * it happens by accident.
 */
export function TeamSettingsPanel({ team }: { readonly team: TeamSummary }): React.JSX.Element {
  // Keyed by the team, so picking another tile puts its own name in the box
  // rather than leaving the last one's there.
  return <TeamSettingsForm key={team.teamId} team={team} />;
}

function TeamSettingsForm({ team }: { readonly team: TeamSummary }): React.JSX.Element {
  const [name, setName] = useState(team.name);
  const update = useUpdateTeam();
  const problems = readFieldProblems(update.error);

  return (
    <section className={styles.panel} aria-label={`${team.name} settings`}>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({ teamId: team.teamId, name });
        }}
      >
        {/* The heading is inside the form so the button in it is a real submit
            rather than one wired back to a form it sits outside of. Saving is
            one button on a panel of two fields, and a row of its own for it was
            the tallest thing here saying the least. */}
        <div className={styles.panelHeading}>
          <h2 className={styles.panelTitle}>Team</h2>

          <span className={styles.headingAction}>
            <Button tone="go" type="submit" busy={update.isPending} busyLabel="Saving…">
              Save name
            </Button>
          </span>
        </div>

        <Field
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          problem={problems.name}
        />

        <LeadPicker
          team={team}
          onPick={(leadUserId) => {
            update.mutate({ teamId: team.teamId, leadUserId });
          }}
        />

        {update.error !== null && Object.keys(problems).length === 0 && (
          <p className={styles.problem} role="alert">
            {describeFailure(update.error)}
          </p>
        )}
      </form>
    </section>
  );
}

/**
 * Who answers for the team, searched rather than listed.
 *
 * It was a dropdown of the team's members until an install with eighty-four
 * people in a team showed what that meant: the list is a page of the members,
 * so the thirty-four people past the first fifty could never be made the lead
 * and nothing on the screen said so. A search asks the server, which knows
 * about all of them.
 */
function LeadPicker({
  team,
  onPick,
}: {
  readonly team: TeamSummary;
  readonly onPick: (leadUserId: string | null) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const matches = usePeople({ search: search.trim(), inTeamId: team.teamId });
  const found = search.trim() === '' ? [] : (matches.data?.pages[0]?.people ?? []);

  return (
    <div className={styles.adder}>
      <label className={styles.adderLabel} htmlFor={`lead-${team.teamId}`}>
        Lead
      </label>

      {/* Who answers for the team and the box that changes them, side by side.
          They are two halves of one question, and stacked they read as two. */}
      <div className={styles.leadRow}>
        <div className={styles.leadNow}>
          <span>{team.lead === null ? 'Nobody answers for this team' : team.lead.displayName}</span>
          {team.lead !== null && (
            <button
              type="button"
              className={joinClassNames(styles.action, styles.actionStop)}
              onClick={() => {
                onPick(null);
              }}
            >
              Clear
            </button>
          )}
        </div>

        <input
          id={`lead-${team.teamId}`}
          className={styles.search}
          type="search"
          value={search}
          placeholder="Search this team for a lead…"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>

      {search.trim() !== '' && found.length === 0 && matches.isSuccess && (
        <p className={styles.message}>Nobody in this team by that name.</p>
      )}

      <ul className={styles.matches}>
        {found.slice(0, LEADS_SHOWN).map((person) => (
          <li key={person.userId}>
            <button
              type="button"
              className={styles.match}
              onClick={() => {
                onPick(person.userId);
                setSearch('');
              }}
            >
              <Avatar url={person.avatarUrl} initials={person.initials} className={styles.avatar} />
              <span className={styles.personName}>{person.displayName}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How many the picker shows before it asks for a better search. */
const LEADS_SHOWN = 5;
