import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS, type Transform } from '@dnd-kit/utilities';
import type { PermissionGroup, TeamSummary } from '@lpm/shared';
import { useState } from 'react';

import { AddPermissionDialog } from './AddPermissionDialog.js';
import { describeFailure } from '../../api/failure-messages.js';
import { joinClassNames } from '../../lib/join-class-names.js';
import { Button, Loading } from '../ui/index.js';
import {
  useOrderTeamGroups,
  usePermissions,
  useSetTeamGroup,
} from '../../logic/permissions/index.js';
import styles from './TeamsScreen.module.css';

/**
 * What this team may do.
 *
 * Only what it holds. Every group on the install used to be listed here with a
 * tick beside it, which meant a panel about one team was mostly about the
 * fifteen groups it does not have — and a studio nearly always gives a team
 * one. Adding is a button and a picker now; the panel itself is the answer.
 *
 * Said here rather than on the group, because this is where somebody is
 * deciding about this team. A group is a set of rules and nothing else — it has
 * no effect at all until a team holds it, and a set of permissions that also
 * owned its own membership would be two things pretending to be one.
 */
export function TeamPermissionsPanel({ team }: { team: TeamSummary }): React.JSX.Element {
  const permissions = usePermissions();
  const setTeamGroup = useSetTeamGroup();
  const orderGroups = useOrderTeamGroups();
  const [isAdding, setIsAdding] = useState(false);

  // A few pixels of travel before a drag starts, so pressing "Take away" still
  // presses it. The board's columns are picked up the same way.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const groups = permissions.data?.groups ?? [];
  const held = inTheirOrder(groups, team.teamId);

  const reorder = (event: DragEndEvent): void => {
    const moved = String(event.active.id);
    const onto = event.over === null ? moved : String(event.over.id);

    if (moved === onto) {
      return;
    }

    const order = held.map((group) => group.id);
    const from = order.indexOf(moved);
    const to = order.indexOf(onto);

    if (from === -1 || to === -1) {
      return;
    }

    order.splice(to, 0, ...order.splice(from, 1));

    orderGroups.mutate({ teamId: team.teamId, groupIds: order });
  };

  return (
    <section className={styles.panel} aria-label={`${team.name} permissions`}>
      <div className={styles.panelHeading}>
        <h2 className={styles.panelTitle}>Permissions</h2>
        <span className={styles.count}>{describeHeld(held.length)}</span>

        <Button
          tone="go"
          onClick={() => {
            setIsAdding(true);
          }}
        >
          Add permission
        </Button>
      </div>

      {permissions.isPending && <Loading what="Loading the permissions" />}

      {permissions.isError && (
        <p className={styles.problem} role="alert">
          {describeFailure(permissions.error)}
        </p>
      )}

      {permissions.isSuccess && held.length === 0 && (
        <p className={styles.message}>
          None yet. Everybody in this team gets what their role allows and nothing more.
        </p>
      )}

      {held.length > 0 && (
        <DndContext sensors={sensors} onDragEnd={reorder}>
          <SortableContext
            items={held.map((group) => group.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className={styles.heldGroups} aria-label={`Permissions ${team.name} holds`}>
              {held.map((group) => (
                <Held
                  key={group.id}
                  group={group}
                  isBusy={setTeamGroup.isPending}
                  onRemove={() => {
                    setTeamGroup.mutate({ teamId: team.teamId, groupId: group.id, held: false });
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {setTeamGroup.error !== null && (
        <p className={styles.problem} role="alert">
          {describeFailure(setTeamGroup.error)}
        </p>
      )}

      {isAdding && (
        <AddPermissionDialog
          team={team}
          groups={groups}
          heldIds={new Set(held.map((group) => group.id))}
          onClose={() => {
            setIsAdding(false);
          }}
        />
      )}
    </section>
  );
}

/**
 * The team's permissions in the order somebody put them in.
 *
 * By position, and by name where two share one — which is what every row has
 * until somebody drags something, since the column was backfilled that way.
 */
function inTheirOrder(
  groups: readonly PermissionGroup[],
  teamId: string,
): readonly PermissionGroup[] {
  const placeOf = (group: PermissionGroup): number =>
    group.teams.find((holder) => holder.id === teamId)?.position ?? 0;

  return groups
    .filter((group) => group.teams.some((holder) => holder.id === teamId))
    .slice()
    .sort(
      (first, second) => placeOf(first) - placeOf(second) || first.name.localeCompare(second.name),
    );
}

/**
 * The travel a dragged row is allowed: down the list and nowhere else.
 *
 * A vertical list has one axis, and sideways is not one of its answers — a row
 * that follows the pointer out of the panel is a row somebody is dropping
 * nowhere. It also took the scrollbar with it: the list is `overflow-y: auto`,
 * and a box that scrolls on one axis computes the other as `auto` too, so a
 * row leaning right grew a horizontal scrollbar under it.
 */
function straightUpAndDown(travel: Transform | null): Transform | null {
  return travel === null ? null : { ...travel, x: 0 };
}

/** One permission the team has, the grip that moves it, and the way to take it back. */
function Held({
  group,
  isBusy,
  onRemove,
}: {
  readonly group: PermissionGroup;
  readonly isBusy: boolean;
  readonly onRemove: () => void;
}): React.JSX.Element {
  const sortable = useSortable({ id: group.id });

  return (
    <li
      ref={sortable.setNodeRef}
      className={joinClassNames(styles.heldGroup, sortable.isDragging && styles.heldGroupMoving)}
      style={{
        transform: CSS.Transform.toString(straightUpAndDown(sortable.transform)),
        transition: sortable.transition,
      }}
    >
      {/* Always drawn rather than appearing on hover, for the reason the board's
          columns have one: somebody who has just given a team a fourth
          permission learns they can be ordered without having to try it. */}
      <button
        type="button"
        ref={sortable.setActivatorNodeRef}
        className={styles.heldGroupGrip}
        aria-label={`Reorder ${group.name}`}
        {...sortable.attributes}
        {...sortable.listeners}
      >
        ⠿
      </button>
      <span className={styles.heldGroupName}>{group.name}</span>
      {/* How much it says, so a group can be told from an empty one without
          opening the other screen. */}
      <span className={styles.heldGroupFacts}>
        {group.rules.length} {group.rules.length === 1 ? 'rule' : 'rules'}
      </span>
      <button
        type="button"
        className={joinClassNames(styles.action, styles.actionStop)}
        disabled={isBusy}
        onClick={onRemove}
      >
        Take away
      </button>
    </li>
  );
}

/** "none", "1 permission", "3 permissions" — beside the heading. */
function describeHeld(count: number): string {
  if (count === 0) {
    return 'none';
  }

  return `${String(count)} ${count === 1 ? 'permission' : 'permissions'}`;
}
