import type { DatabaseTransaction } from '@lpm/database';
import { readMentionedUserIds } from '@lpm/shared';

import { loadProjectLevel } from '../../projects/project-access.js';

export interface MentionRequest {
  readonly database: DatabaseTransaction;
  readonly commentId: string;
  readonly projectId: string;
  readonly accountId: string;
  readonly body: string;
  /** Whoever wrote it, so they are not told about their own sentence. */
  readonly authorId: string;
}

/**
 * Records who a comment named, for the people it was allowed to name.
 *
 * Read out of the body the server has just stored, never taken from the client.
 * A browser that posted a comment naming nobody and a mention naming everybody
 * would otherwise be a way to light up the whole studio's marks, and the body is
 * the only account of what was actually said.
 *
 * **Only people who reach the project.** Being told about a card you cannot open
 * is worse than not being told: it is a notification that leads to a page saying
 * the thing does not exist. The picker offers nobody else, and this is what
 * holds when the picker was not what put the name there — a pasted comment, an
 * old id, somebody since taken off the project.
 *
 * A name that fails that test is not an error. The sentence still says it,
 * because somebody wrote it and a comment is a record of what was said; what
 * does not happen is the telling.
 *
 * And never yourself. Naming yourself while writing is a thing people do, and a
 * red circle for a sentence you have just typed is a notification about your own
 * hands.
 */
export async function recordMentions(request: MentionRequest): Promise<string[]> {
  const named = readMentionedUserIds(request.body).filter((userId) => userId !== request.authorId);

  if (named.length === 0) {
    return [];
  }

  const reachable = await whoReaches(request, named);

  if (reachable.length === 0) {
    return [];
  }

  await request.database
    .insertInto('commentMention')
    .values(reachable.map((userId) => ({ commentId: request.commentId, userId })))
    // Naming somebody twice in one sentence is naming them once. The parser
    // already says so; this is the database agreeing rather than a second
    // opinion about it.
    .onConflict((conflict) => conflict.doNothing())
    .execute();

  return reachable;
}

/**
 * Which of the named can open the card the remark is on.
 *
 * Asked through `loadProjectLevel`, which is the same expression every list of
 * projects filters by — the rule about who reaches what lives in one place, and
 * a second copy here is how a mention would still be delivered a year after
 * that rule changed.
 *
 * One question per person named, which sounds worse than it is: a sentence names
 * one or two people and the pathological case is a handful. Rewriting the rule
 * to take a set would buy a round trip and cost the single source of it.
 */
async function whoReaches(request: MentionRequest, named: string[]): Promise<string[]> {
  const members = await request.database
    .selectFrom('membership')
    .select(['userId', 'role'])
    .where('accountId', '=', request.accountId)
    .where('userId', 'in', named)
    .execute();

  const reachable: string[] = [];

  for (const member of members) {
    const level = await loadProjectLevel(
      request.database,
      { actor: { userId: member.userId, accountId: request.accountId }, role: member.role },
      request.projectId,
    );

    if (level !== 'none') {
      reachable.push(member.userId);
    }
  }

  return reachable;
}
