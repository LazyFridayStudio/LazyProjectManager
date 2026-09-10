import type { CandidatePerson, CandidateTeam, ProjectDetailView } from '@lpm/shared';
import { useState, type ReactNode } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { Avatar } from '../ui/index.js';
import { useMay } from '../../logic/auth/use-identity.js';
import {
  useAddProjectMember,
  useAddProjectTeam,
  useProjectCandidates,
  useRemoveProjectMember,
  useRemoveProjectTeam,
} from '../../logic/projects/use-project-membership.js';
import styles from './ProjectTeamPanel.module.css';

/**
 * Who is on this project, and how somebody else gets on it.
 *
 * The screen that decides which projects a person can open at all. A permission
 * group says *what* somebody may do and being on a project says *where* — and
 * until this panel could write, a person who was not an owner or a lead reached
 * no project on the install and there was nothing anybody could do about it.
 *
 * **On it or not on it, and no third thing.** No seat, no level, no per-project
 * role. What somebody may do here is what their team's permission groups and
 * their own say, set on the screens where those live — a dropdown on this row
 * would be a third place to change one person's access, and working out why
 * somebody cannot open a board would mean reading all three.
 *
 * Teams above people, because a team is the broader statement: a row here puts
 * everybody in it on the project for as long as they are in it, and somebody
 * who joins the team next month comes with it. A person's own row is the
 * narrower, stronger one — it names them, and it survives them leaving every
 * team they are in.
 */
export function ProjectTeamPanel({ detail }: { detail: ProjectDetailView }): React.JSX.Element {
  const may = useMay();
  const { project } = detail;
  const isArchived = project.archivedAt !== null;

  // An archived project is not being staffed. The same rule its settings form
  // follows, and the same one its commands enforce: restoring it is the one
  // press it still answers to.
  const mayInvite = may('member.invite') && !isArchived;
  const mayRemove = may('member.remove') && !isArchived;

  return (
    <section className={styles.panel} aria-label="Team">
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}>Team</h2>
        <span className={styles.count}>{describeReach(project.counts.team)}</span>
      </div>

      <TeamRows teams={detail.teams} projectId={project.id} mayRemove={mayRemove} />

      <MemberRows members={detail.members} projectId={project.id} mayRemove={mayRemove} />

      {mayInvite && <Adder projectId={project.id} />}
    </section>
  );
}

/** How many people the project reaches, counting each of them once. */
function describeReach(total: number): string {
  return `${String(total)} ${total === 1 ? 'person' : 'people'}`;
}

/**
 * The teams on the project, each with how many people it brings.
 *
 * The count is the whole question about a team row: `Audio` says nothing until
 * it says that six people arrive with it. What those six may do is the groups
 * Audio holds, which is a sentence on the Teams screen and not a control here.
 */
function TeamRows({
  teams,
  projectId,
  mayRemove,
}: {
  readonly teams: ProjectDetailView['teams'];
  readonly projectId: string;
  readonly mayRemove: boolean;
}): React.JSX.Element {
  const remove = useRemoveProjectTeam();

  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>Teams</h3>

      {teams.length === 0 && (
        <p className={styles.message}>
          No team is on this project. Everybody in a team put on it reaches it for as long as they
          are in that team.
        </p>
      )}

      <ul className={styles.rows}>
        {teams.map((team) => (
          <Row
            key={team.teamId}
            mark={String(team.memberCount)}
            name={team.name}
            facts={[describeReach(team.memberCount), team.leadDisplayName ?? 'no lead'].join(' · ')}
            mayRemove={mayRemove}
            busy={remove.isPending}
            onRemove={() => {
              remove.mutate({ projectId, teamId: team.teamId });
            }}
          />
        ))}
      </ul>

      <Problem error={remove.error} />
    </div>
  );
}

/**
 * The people on the project by name.
 *
 * Not everybody who reaches it: somebody in a team that is on the project has
 * no row here, because there is no row to take off them. Taking a person off
 * this list does not take them out of a team that puts them back.
 */
function MemberRows({
  members,
  projectId,
  mayRemove,
}: {
  readonly members: ProjectDetailView['members'];
  readonly projectId: string;
  readonly mayRemove: boolean;
}): React.JSX.Element {
  const remove = useRemoveProjectMember();

  return (
    <div className={styles.group}>
      <h3 className={styles.groupTitle}>People</h3>

      {members.length === 0 && <p className={styles.message}>Nobody is on this project by name.</p>}

      <ul className={styles.rows}>
        {members.map((member) => (
          <Row
            key={member.userId}
            mark={member.initials}
            picture={member.avatarUrl}
            name={member.displayName}
            mayRemove={mayRemove}
            busy={remove.isPending}
            onRemove={() => {
              remove.mutate({ projectId, userId: member.userId });
            }}
          />
        ))}
      </ul>

      <Problem error={remove.error} />
    </div>
  );
}

interface RowProps {
  /** Initials for a person, the head count for a team. */
  readonly mark: string;
  /** A person's picture. Teams have none — a team is not somebody. */
  readonly picture?: string | null | undefined;
  readonly name: string;
  readonly facts?: string;
  readonly mayRemove: boolean;
  readonly busy: boolean;
  readonly onRemove: () => void;
}

/**
 * One line: who, and the way to take them off.
 *
 * The same row for a person and a team on purpose. They are two ways of saying
 * the same thing — this reaches the project — and drawing them differently
 * would suggest a difference that is not there.
 */
function Row({
  mark,
  picture,
  name,
  facts,
  mayRemove,
  busy,
  onRemove,
}: RowProps): React.JSX.Element {
  return (
    <li className={styles.row}>
      <Avatar url={picture} initials={mark} className={styles.rowMark} />

      <span className={styles.rowName}>
        {name}
        {facts !== undefined && <span className={styles.rowFacts}>{facts}</span>}
      </span>

      {mayRemove && (
        <button
          type="button"
          className={joinClassNames(styles.action, styles.actionStop)}
          disabled={busy}
          onClick={onRemove}
        >
          Take off
        </button>
      )}
    </li>
  );
}

/**
 * Searches what is left to add, and adds it.
 *
 * One box for both, because "put the audio team on this" and "put Alex on this"
 * are the same intention and a studio does not know which it wants before it
 * starts typing.
 */
function Adder({ projectId }: { projectId: string }): React.JSX.Element {
  const [search, setSearch] = useState('');
  const candidates = useProjectCandidates(projectId, search.trim(), true);
  const addPerson = useAddProjectMember();
  const addTeam = useAddProjectTeam();

  const found = candidates.data;
  const isEmpty = found?.people.length === 0 && found.teams.length === 0;
  const busy = addPerson.isPending || addTeam.isPending;

  const added = (): void => {
    setSearch('');
  };

  return (
    <div className={styles.adder}>
      <label className={styles.adderLabel} htmlFor={`add-to-${projectId}`}>
        Put somebody, or a team, on this project
      </label>
      <input
        id={`add-to-${projectId}`}
        className={styles.search}
        type="search"
        value={search}
        placeholder="Search people and teams…"
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />

      <Problem error={candidates.error ?? addPerson.error ?? addTeam.error} />

      {isEmpty && (
        <p className={styles.message}>
          {search.trim() === ''
            ? 'Everybody on the install is already on this project.'
            : 'Nothing left to add by that name.'}
        </p>
      )}

      <ul className={styles.matches}>
        {found?.teams.map((team) => (
          <Match
            key={team.teamId}
            mark={String(team.memberCount)}
            name={team.name}
            about={describeTeam(team)}
            busy={busy}
            onPick={() => {
              addTeam.mutate({ projectId, teamId: team.teamId }, { onSuccess: added });
            }}
          />
        ))}

        {found?.people.map((person) => (
          <Match
            key={person.userId}
            mark={person.initials}
            picture={person.avatarUrl}
            name={person.displayName}
            about={describePerson(person)}
            busy={busy}
            onPick={() => {
              addPerson.mutate({ projectId, userId: person.userId }, { onSuccess: added });
            }}
          />
        ))}
      </ul>

      <MoreToFind found={found} />
    </div>
  );
}

/** One thing the picker is offering, and the press that puts it on. */
function Match({
  mark,
  picture,
  name,
  about,
  busy,
  onPick,
}: {
  readonly mark: string;
  readonly picture?: string | null | undefined;
  readonly name: string;
  readonly about: string;
  readonly busy: boolean;
  readonly onPick: () => void;
}): React.JSX.Element {
  return (
    <li>
      <button type="button" className={styles.match} disabled={busy} onClick={onPick}>
        <Avatar url={picture} initials={mark} className={styles.rowMark} />
        <span className={styles.rowName}>{name}</span>
        <span className={styles.matchAbout}>{about}</span>
      </button>
    </li>
  );
}

/**
 * What the search matched and did not draw.
 *
 * Said rather than scrolled to: the way to find the ninth name is to type more
 * of it, and a list that quietly stopped at six would look like the whole
 * answer.
 */
function MoreToFind({
  found,
}: {
  readonly found: { morePeople: number; moreTeams: number } | undefined;
}): ReactNode {
  const more = (found?.morePeople ?? 0) + (found?.moreTeams ?? 0);

  if (more === 0) {
    return null;
  }

  return <p className={styles.message}>{more} more — keep typing to narrow it.</p>;
}

/** Where a person already is, so adding them is an informed press. */
function describePerson(person: CandidatePerson): string {
  return person.teams.length === 0 ? person.email : person.teams.join(', ');
}

/** How many people come with a team, which is the whole question about one. */
function describeTeam(team: CandidateTeam): string {
  return describeReach(team.memberCount);
}

/** Whatever went wrong most recently in this part of the panel. */
function Problem({ error }: { readonly error: Error | null | undefined }): ReactNode {
  if (error === null || error === undefined) {
    return null;
  }

  return (
    <p className={styles.problem} role="alert">
      {describeFailure(error)}
    </p>
  );
}
