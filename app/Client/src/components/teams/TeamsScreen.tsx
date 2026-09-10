import type { TeamSummary } from '@lpm/shared';
import { useState } from 'react';

import { describeFailure } from '../../api/failure-messages.js';
import { Button, ButtonIcon, Loading, TrashIcon, useDisplay } from '../ui/index.js';
import { InstallShell } from '../shell/InstallShell.js';
import { NewTeamDialog } from './NewTeamDialog.js';
import { PickLayout, PickList, type Pickable } from '../shell/PickList.js';
import styles from './TeamsScreen.module.css';
import { TeamPermissionsPanel } from './TeamPermissionsPanel.js';
import { TeamMembersPanel } from './TeamMembersPanel.js';
import { TeamSettingsPanel } from './TeamSettingsPanel.js';
import { useDeleteTeam, useTeams } from '../../logic/teams/use-teams.js';

/**
 * The teams, and who is in each of them.
 *
 * The list down the side and the one you picked beside it, which is how
 * Permissions reads — the same `PickList`, so the two screens are the same
 * shape by construction rather than by two stylesheets that happen to agree.
 *
 * It was a grid of tiles with the panels underneath. At three teams that is a
 * studio at a glance; at thirty it is a wall of tiles you scroll past to reach
 * the thing you were reading, and picking a different team moves that thing
 * down the page.
 *
 * Admins only for now, like the people. Everybody wanting to see who is in
 * their own team is a fair ask and a wider query than this one.
 */
export function TeamsScreen(): React.JSX.Element {
  const [isAdding, setIsAdding] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const teams = useTeams();
  const remove = useDeleteTeam();
  const { askToConfirm } = useDisplay();

  const listed = teams.data?.teams ?? [];
  // The picked one, or the first, so the panels are never empty next to a grid
  // that is not.
  const picked = listed.find((team) => team.teamId === pickedId) ?? listed[0] ?? null;

  return (
    <InstallShell
      active="teams"
      title="Teams"
      actions={
        <>
          <Button
            tone="go"
            onClick={() => {
              setIsAdding(true);
            }}
          >
            New team
          </Button>

          {/* Beside the one that makes a team rather than at the bottom of the
              panel about the one being read. Making and unmaking are the same
              kind of thing, and a studio looking for either looks in the same
              place. Absent while there is no team, because there is nothing to
              remove. */}
          {picked !== null && (
            <Button
              tone="stop"
              aria-label="Remove team"
              title="Remove team"
              busy={remove.isPending}
              onClick={() => {
                void askToConfirm({
                  question: `Remove ${picked.name}?`,
                  consequence: 'The people in it keep their accounts. The team does not come back.',
                  confirmLabel: 'Remove team',
                }).then((said) => {
                  if (said) {
                    remove.mutate(
                      { teamId: picked.teamId },
                      {
                        onSuccess: () => {
                          setPickedId(null);
                        },
                      },
                    );
                  }
                });
              }}
            >
              <ButtonIcon>
                <TrashIcon size={14} />
              </ButtonIcon>
            </Button>
          )}
        </>
      }
    >
      <Chosen
        teams={teams}
        picked={picked}
        pickedId={picked?.teamId ?? null}
        onPick={setPickedId}
      />

      {isAdding && (
        <NewTeamDialog
          onClose={() => {
            setIsAdding(false);
          }}
          onCreated={setPickedId}
        />
      )}
    </InstallShell>
  );
}

/**
 * The list, and whichever team is open beside it.
 *
 * Its own component because the screen around it is a shell, a button and a
 * dialog — and a function that also branches through pending, failed, empty and
 * chosen is one nobody reads to the bottom of.
 */
function Chosen({
  teams,
  picked,
  pickedId,
  onPick,
}: {
  teams: ReturnType<typeof useTeams>;
  picked: TeamSummary | null;
  pickedId: string | null;
  onPick: (teamId: string) => void;
}): React.JSX.Element {
  if (teams.isPending) {
    return <Loading what="Loading the teams" />;
  }

  if (teams.isError) {
    return (
      <p className={styles.problem} role="alert">
        {describeFailure(teams.error)}
      </p>
    );
  }

  const listed = teams.data.teams;

  if (listed.length === 0) {
    return (
      <p className={styles.message}>
        No teams yet. A team is how a studio says which people work on what, and what those people
        may do.
      </p>
    );
  }

  return (
    <PickLayout
      list={
        <PickList
          label="Teams"
          items={listed.map(asPickable)}
          pickedId={pickedId}
          onPick={onPick}
        />
      }
    >
      {/*
        The two that stay small first, and the one that does not last.
        
        What a team is called and what it may do are a handful of rows each,
        however big the studio gets. Who is in it is however many people are in
        it, and a team of a thousand puts everything under it a thousand rows
        down the page — so the things somebody came to read were reachable only
        by scrolling past the thing they did not.
      */}
      {picked !== null && (
        <>
          <TeamSettingsPanel team={picked} />
          <TeamPermissionsPanel team={picked} />
          <TeamMembersPanel team={picked} />
        </>
      )}
    </PickLayout>
  );
}

/**
 * What a team says in the six words the list has room for.
 *
 * How many people and who leads them, which is what somebody scanning twenty of
 * these is deciding between. The faces the tile used to draw went with it: a
 * column of initials is a picture of one team, and this list is read as twenty.
 */
function asPickable(team: TeamSummary): Pickable {
  const people = team.memberCount === 1 ? '1 person' : `${String(team.memberCount)} people`;
  const lead = team.lead === null ? 'no lead' : team.lead.displayName;

  return { id: team.teamId, name: team.name, facts: `${people} · ${lead}` };
}
