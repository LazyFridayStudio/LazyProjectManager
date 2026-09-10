import { useState } from 'react';
import {
  daysUntil,
  describeMilestoneState,
  type Milestone,
  type MilestonePlanView,
} from '@lpm/shared';

import { ReleasePlanDialog } from './ReleasePlanDialog.js';
import styles from './ReleasePlan.module.css';

/**
 * Every date the project is held to, across one strip.
 *
 * The design draws them side by side rather than as a list, because a plan is
 * read for the shape of the run-up: three milestones in one fortnight and
 * nothing for two months is a fact about the year that a list hides.
 */
export function ReleasePlan({
  plan,
  canWrite,
}: {
  plan: MilestonePlanView;
  canWrite: boolean;
}): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <section className={styles.block} aria-label="Release plan">
      <div className={styles.head}>
        <h2 className={styles.title}>Release plan</h2>
        <span className={styles.range}>{describeRange(plan.milestones)}</span>
        {canWrite && (
          <button
            type="button"
            className={styles.edit}
            onClick={() => {
              setIsEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>

      {plan.milestones.length === 0 ? (
        <p className={styles.empty}>
          No dates yet. A milestone is a name, a goal and two days the team can hold itself to.
        </p>
      ) : (
        <>
          <div className={styles.strip}>
            {plan.milestones.map((milestone) => (
              <div key={milestone.id} className={styles.stop}>
                <span className={styles.stopName}>{milestone.name}</span>
                <span className={styles.stopDate}>{milestone.shipsOn}</span>
                <span className={styles.stopBar} data-state={milestone.state} />
              </div>
            ))}
          </div>

          <p className={styles.note}>{describePlan(plan.milestones, plan.today)}</p>
        </>
      )}

      {isEditing && (
        <ReleasePlanDialog
          plan={plan}
          onDone={() => {
            setIsEditing(false);
          }}
        />
      )}
    </section>
  );
}

/** `2026-02-02 → 2026-11-20`, the span the whole plan covers. */
function describeRange(milestones: readonly Milestone[]): string {
  const first = milestones[0];
  const last = milestones[milestones.length - 1];

  if (first === undefined || last === undefined) return '';

  return `${first.startsOn} → ${last.shipsOn}`;
}

/**
 * What the plan is doing, in one line.
 *
 * The active milestone if there is one, and what is stuck in it — the sentence
 * somebody would say out loud about the plan, and the only part of it that
 * changes between one Monday and the next.
 */
function describePlan(milestones: readonly Milestone[], today: string): string {
  const active = milestones.find((milestone) => milestone.state === 'active');

  if (active === undefined) {
    const next = milestones.find((milestone) => milestone.state === 'planned');

    if (next === undefined) return 'Every milestone has shipped.';

    const days = daysUntil(next.startsOn, today);

    return `Nothing running · ${next.name} starts in ${String(days)} days`;
  }

  const parts = [
    `${active.name} · ${describeMilestoneState(active.state).toLowerCase()}`,
    active.daysLeft < 0
      ? `${String(-active.daysLeft)} days over`
      : `${String(active.daysLeft)} days left`,
  ];

  if (active.blockedCount > 0) {
    parts.push(`${String(active.blockedCount)} blocked`);
  }

  return parts.join(' · ');
}
