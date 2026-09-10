import {
  MENTIONS_LISTED,
  readCommentAsText,
  waitingMentionsQuery,
  type WaitingMentionsView,
} from '@lpm/shared';

import type { RawBuilder } from '@lpm/database';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import { pictureUrl } from '../../files/index.js';
import { canReachProject, loadMembershipRole } from '../../projects/project-access.js';

/**
 * What is waiting for the person asking, newest first.
 *
 * Yours and nobody else's, and it answers to no permission for the reason
 * `identity.me` does not: there is no user id on the query, so the only rows it
 * can reach are the ones the session names.
 *
 * A mention only exists at all if the person named could reach that project
 * when it was said — but reach is not for life. Somebody taken off a project a
 * week later still has the rows, and a panel that offered them the key of a
 * card that now answers "no such thing" would be worse than one that said
 * nothing. So both halves are filtered by the same expression every list of
 * projects filters by, and a mention on a project you have left goes quiet.
 *
 * Quiet rather than deleted. Put back on the project and it is waiting again,
 * which is right: nobody unsaid it.
 */
export const waitingMentionsHandler = defineQueryHandler({
  definition: waitingMentionsQuery,

  async execute(_params: Record<string, never>, context): Promise<WaitingMentionsView> {
    const actor = requireActor(context, waitingMentionsQuery.name);
    const role = await loadMembershipRole(context.database, actor);
    const reaches = canReachProject({ actor, role });

    const [rows, counted] = await Promise.all([
      selectWaiting(context, actor, reaches),
      countWaiting(context, actor, reaches),
    ]);

    return {
      mentions: rows.map((row) => ({
        id: row.id,
        said:
          row.saidBy === null || row.saidName === null
            ? null
            : {
                displayName: row.saidName,
                initials: row.saidInitials ?? '',
                avatarUrl: pictureUrl(row.saidAvatarFileId, row.saidAvatarState),
              },
        // Written out as the words the marks stand for. A panel is read rather
        // than pressed through, and `@[Mira Kaur](user:018f…)` is not a sentence.
        excerpt: readCommentAsText(row.body),
        cardId: row.cardId,
        cardKey: row.cardKey,
        cardTitle: row.cardTitle,
        projectSlug: row.projectSlug,
        createdAt: row.createdAt.toISOString(),
      })),
      total: Number(counted.total),
    };
  },
});

/**
 * The page the panel draws.
 *
 * Joined to the card and its project because a mention is worth nothing without
 * somewhere to go: the panel names the card and pressing it opens that board.
 * A deleted comment is left out — the row goes with it on the cascade, but a
 * comment can also be soft-deleted, and a mark pointing at a sentence nobody can
 * read any more is a mark that cannot be cleared by reading it.
 */
function selectWaiting(context: RequestContext, actor: RequestActor, reaches: RawBuilder<boolean>) {
  return context.database
    .selectFrom('commentMention')
    .innerJoin('comment', 'comment.id', 'commentMention.commentId')
    .innerJoin('card', 'card.id', 'comment.cardId')
    .innerJoin('project', 'project.id', 'card.projectId')
    .leftJoin('appUser as said', 'said.id', 'comment.authorId')
    .leftJoin('file as saidAvatar', 'saidAvatar.id', 'said.avatarFileId')
    .select([
      'commentMention.id as id',
      'commentMention.createdAt as createdAt',
      'comment.body as body',
      'said.id as saidBy',
      'said.displayName as saidName',
      'said.initials as saidInitials',
      'said.avatarFileId as saidAvatarFileId',
      'saidAvatar.state as saidAvatarState',
      'card.id as cardId',
      'card.cardKey as cardKey',
      'card.title as cardTitle',
      'project.slug as projectSlug',
    ])
    .where('commentMention.userId', '=', actor.userId)
    .where('commentMention.seenAt', 'is', null)
    .where('comment.deletedAt', 'is', null)
    .where(reaches)
    .orderBy('commentMention.createdAt', 'desc')
    .limit(MENTIONS_LISTED)
    .execute();
}

/**
 * Everything still waiting, which is the number on the mark.
 *
 * The same joins as the list even though it selects none of them, because the
 * reach expression needs `project` in scope — and because a circle saying four
 * over a panel showing two is the kind of small wrongness people stop trusting
 * the whole control for.
 */
function countWaiting(context: RequestContext, actor: RequestActor, reaches: RawBuilder<boolean>) {
  return context.database
    .selectFrom('commentMention')
    .innerJoin('comment', 'comment.id', 'commentMention.commentId')
    .innerJoin('card', 'card.id', 'comment.cardId')
    .innerJoin('project', 'project.id', 'card.projectId')
    .select((builder) => builder.fn.countAll<string>().as('total'))
    .where('commentMention.userId', '=', actor.userId)
    .where('commentMention.seenAt', 'is', null)
    .where('comment.deletedAt', 'is', null)
    .where(reaches)
    .executeTakeFirstOrThrow();
}
