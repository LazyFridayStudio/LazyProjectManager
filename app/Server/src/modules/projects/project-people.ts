import { sql, type DatabaseTransaction } from '@lpm/database';

import { InvariantViolatedError } from '../../domain/index.js';

export interface ProjectPeopleRequest {
  readonly database: DatabaseTransaction;
  readonly projectId: string;
  /** Who the work would be given to, if the edit says so. */
  readonly assigneeId?: string | null;
  /** Who asked for it, if the edit says so. */
  readonly reporterId?: string | null;
}

/**
 * Refuses work handed to somebody who is not on the project.
 *
 * A card or an asset, and the same rule for both — which is why this sits under
 * `projects` rather than beside either of them. The question is about the
 * project and the person, and nothing in it has ever been about what kind of
 * thing their name was going on.
 *
 * The crew: named on it, or in a team that is. Not merely able to reach it — an
 * owner administers the install and a lead makes the projects, so both can open
 * every board in the studio, and neither is on this job because of that. Work
 * given to somebody who is not on the job is work nobody picks up, and a
 * reporter who never touched the project is a name on a row rather than
 * somebody to go back to.
 *
 * The narrower of the two questions `projects.people` answers, and deliberately
 * narrower than a mention: naming your studio head in a remark about a card
 * they can open is a reasonable thing to do, and putting the card on them is
 * not the same act.
 *
 * This is what holds when the picker was not what named them — a pasted
 * request, an old id, or somebody taken off the project since the card was
 * written. Clearing is always allowed: `null` is nobody, and nobody is on
 * nothing.
 */
export async function assertPeopleAreOnTheProject(request: ProjectPeopleRequest): Promise<void> {
  await assertOnIt(request, request.assigneeId, 'assignee');
  await assertOnIt(request, request.reporterId, 'reporter');
}

async function assertOnIt(
  request: ProjectPeopleRequest,
  userId: string | null | undefined,
  field: 'assignee' | 'reporter',
): Promise<void> {
  // Absent means the edit did not mention them; null means it cleared them.
  if (userId === undefined || userId === null) {
    return;
  }

  if (await isOnTheProject(request.database, request.projectId, userId)) {
    return;
  }

  /*
   * The same sentence whether they are on another project or not in the install
   * at all.
   *
   * Somebody editing a card should not be able to use it to find out who
   * exists, and the person doing the editing cannot act on the difference
   * anyway: either way, the answer is to put them on the project first.
   */
  throw new InvariantViolatedError(
    `That person is not on this project, so they cannot be its ${field}.`,
    { [field]: 'Not on this project.' },
  );
}

/**
 * The two ways somebody is on a project, and the same two the crew list reads.
 *
 * Stated here rather than borrowed from `reachedLevel`, which answers a wider
 * question on purpose — it counts the roles that open every project, and those
 * are exactly the people this is meant to exclude. The two must not be merged:
 * a card assigned to a lead who has never opened this board is the thing being
 * refused.
 */
async function isOnTheProject(
  database: DatabaseTransaction,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const found = await sql<{ onIt: boolean }>`
    select exists (
      select 1 from project_member
      where project_member.project_id = ${projectId}::uuid
        and project_member.user_id = ${userId}::uuid
      union all
      select 1
      from project_team
        join team_member on team_member.team_id = project_team.team_id
      where project_team.project_id = ${projectId}::uuid
        and team_member.user_id = ${userId}::uuid
    ) as on_it
  `.execute(database);

  return found.rows[0]?.onIt ?? false;
}
