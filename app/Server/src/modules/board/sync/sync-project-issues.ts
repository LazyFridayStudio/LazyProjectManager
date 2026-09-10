import type { Database } from '@lpm/database';
import type { CardType, ScmProvider } from '@lpm/shared';

import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  closingStampFor,
  isDomainError,
  ProjectArchivedError,
  ProjectNotFoundError,
} from '../../../domain/index.js';
import type { Environment } from '../../../server/environment.js';
import type { FetchLike } from '../../scm/forge/github-app.js';
import {
  loadReadableConnection,
  openRepository,
  refusing,
  type ReadableConnection,
  type RepositoryReader,
} from '../../scm/forge/read-repository.js';
import { readBoardEnds as readEnds, type BoardList } from '../cards/board-ends.js';
import { allocateCardKey } from '../cards/card-keys.js';
import { placeAtEndOfList } from '../cards/card-positions.js';
import { claimTheSync, releaseTheSync, releaseTheSyncAsFailed } from './claim-the-sync.js';
import { fetchForgeIssues } from './fetch-issues.js';
import { planIssueLabels, type LabelledIssue } from './plan-issue-labels.js';
import type { ForgeIssue } from './read-forge-issues.js';
import { writeIssueLabels, type BoardLabel } from './write-issue-labels.js';
import { changeIssue, raiseIssue, type IssueChange } from './write-issues.js';

/**
 * The board and the issue list, brought into step with each other.
 *
 * Both directions, because a studio does not keep two accounts of the same work
 * on purpose. An issue arrives as a card; a card raised here arrives as an
 * issue; and where the two disagree, the side that changed last is the side
 * that is right.
 *
 * Five rules hold the whole thing up:
 *
 * **A card that has never been linked is left alone.** Everything on the board
 * before a repository was connected stays exactly as it is — connecting a
 * repository must not empty a studio's private board onto somebody's issue
 * tracker.
 *
 * **A card made since is raised as an issue.** That is what two-way means from
 * this side, and it is why the cut-off is the moment the repository was
 * connected rather than a flag on a card.
 *
 * **Whichever changed last wins.** The forge says when an issue changed and the
 * card says when it was last touched here, so this is a comparison rather than
 * a guess. A sync's own writes do not count as touching a card, which is what
 * stops the board winning every argument after the first one.
 *
 * **Where a card sits is the board's to say.** The list becomes a label, and the
 * last list means closed. That one never argues: a board is the answer to where
 * the work is up to.
 *
 * **A card somebody deleted is not made again.** A deleted card leaves nothing
 * to match an issue against, so without a note of it the issue reads as one
 * never seen before and arrives as a card — undoing the delete on a timer.
 * `dismissed_issue` is that note.
 *
 * Called by the button on the board and by the worker every half hour, which is
 * why it takes no actor and no request.
 */

export interface IssueSyncRequest {
  readonly database: Database;
  readonly environment: Pick<Environment, 'APP_SECRET'>;
  readonly fetch: FetchLike;
  readonly projectId: string;
  /** Who pressed it, or null when nobody did and the clock came round. */
  readonly actorId: string | null;
  readonly commandId: string;
}

export interface IssueSyncOutcome {
  /** Issues that became cards. */
  readonly added: number;
  /** Cards that changed list because their issue opened or closed. */
  readonly moved: number;
  /** Cards that became issues. */
  readonly raised: number;
}

export async function syncProjectIssues(request: IssueSyncRequest): Promise<IssueSyncOutcome> {
  const project = await loadProject(request.database, request.projectId);
  const connection = await loadReadableConnection(request.database, project.id);

  /*
   * Claimed before anything is asked of the forge, and given back whatever
   * happens.
   *
   * Here rather than in the two callers, because this is the one place the
   * button and the clock both pass through — which is the reason this function
   * exists at all, and the same reason the claim belongs in it. A caller that
   * has to remember is a caller that will not.
   */
  const claim = await claimTheSync(request.database, project.id, new Date());

  try {
    const outcome = await runTheSync({ request, project, connection });

    await releaseTheSync(request.database, claim);

    return outcome;
  } catch (error) {
    await releaseTheSyncAsFailed(request.database, claim, {
      reason: sayWhyItFailed(error),
      at: new Date(),
    });

    throw error;
  }
}

/**
 * The failure, in words that belong on a screen.
 *
 * A domain error is already written for the person reading it — "…is connected
 * for events but has no app installed to read it with" is the whole answer to
 * why a board stopped. Anything else is narrowed to nothing, because an
 * unrecognised error's message can carry a connection string or a fragment of
 * SQL, and this one is stored to be shown.
 */
function sayWhyItFailed(error: unknown): string {
  return isDomainError(error)
    ? error.message
    : 'The sync failed for a reason the server log has and this screen should not.';
}

/** The sync itself, once this process is the one allowed to run it. */
async function runTheSync({
  request,
  project,
  connection,
}: {
  readonly request: IssueSyncRequest;
  readonly project: SyncedProject;
  readonly connection: ReadableConnection;
}): Promise<IssueSyncOutcome> {
  const reader = await openRepository(connection, request);

  /*
   * What to ask for, which depends on what is already here.
   *
   * With the setting on the closed half of the answer exists only to settle
   * cards that already stand for an issue — so with nothing linked, or nothing
   * reconciled to measure "since" from, there is nothing to ask for and the
   * second request is not made.
   */
  const linked = await hasLinkedCards(request.database, project.id);
  const found = await refusing(() =>
    fetchForgeIssues(reader, {
      syncedAt: connection.issuesSyncedAt,
      openOnly: project.syncOpenIssuesOnly,
      hasLinkedCards: linked,
    }),
  );

  /*
   * Raised before the reading is written, so the cards that go up come back
   * down in the same pass as everything else — and each link is stored the
   * moment the issue exists, because an issue raised and not recorded is one
   * this would raise again on the next press.
   */
  const raised = await raiseMissingIssues({ request, connection, reader, project });

  const plan = await writeWhatArrived({ request, project, connection, found });

  await pushBack({ reader, plan });

  return { added: plan.added, moved: plan.moved, raised };
}

/** Whether anything on this board already stands for an issue. */
async function hasLinkedCards(database: Database, projectId: string): Promise<boolean> {
  const linked = await database
    .selectFrom('card')
    .select('id')
    .where('projectId', '=', projectId)
    .where('externalId', 'is not', null)
    .limit(1)
    .executeTakeFirst();

  return linked !== undefined;
}

interface SyncedProject {
  readonly id: string;
  /** Whether this project has asked to be spared its repository's closed history. */
  readonly syncOpenIssuesOnly: boolean;
  readonly accountId: string;
  readonly code: string;
}

async function loadProject(database: Database, projectId: string): Promise<SyncedProject> {
  const project = await database
    .selectFrom('project')
    .select(['id', 'accountId', 'code', 'archivedAt', 'syncOpenIssuesOnly'])
    .where('id', '=', projectId)
    .executeTakeFirst();

  if (project === undefined) {
    throw new ProjectNotFoundError();
  }

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  return {
    id: project.id,
    accountId: project.accountId,
    code: project.code,
    syncOpenIssuesOnly: project.syncOpenIssuesOnly,
  };
}

interface RaiseRequest {
  readonly request: IssueSyncRequest;
  readonly connection: ReadableConnection;
  readonly reader: RepositoryReader;
  readonly project: SyncedProject;
}

/**
 * Cards written here since the repository was connected, put up as issues.
 *
 * The cut-off is the connection's own date. Everything older than it is a
 * studio's existing board, which nobody asked to publish — and there is no way
 * to un-raise a hundred issues once they are on somebody's repository.
 *
 * **Not legends.** A legend is a container: it gathers the cards under it and
 * says what the clump is called. Nobody works on one, nothing is closed by
 * finishing one, and an issue raised for it would be a ticket a repository
 * cannot act on sitting beside the ones it can. The work is the cards inside,
 * and those are raised like any other.
 *
 * A card that was raised and *then* made a legend keeps the issue it already
 * has. There is nothing to be done about an issue that exists, and unlinking it
 * would be worse than leaving it: the next sync would find an issue no card
 * claims and raise a second card for it.
 */
async function raiseMissingIssues({
  request,
  connection,
  reader,
  project,
}: RaiseRequest): Promise<number> {
  const waiting = await request.database
    .selectFrom('card')
    .select(['id', 'title', 'description'])
    .where('projectId', '=', project.id)
    .where('externalId', 'is', null)
    .where('isLegend', '=', false)
    .where('createdAt', '>', connection.connectedAt)
    .orderBy('createdAt')
    .execute();

  let raised = 0;

  for (const card of waiting) {
    const made = await refusing(() =>
      raiseIssue(reader, { cardId: card.id, title: card.title, body: card.description }),
    );

    if (made === null) {
      continue;
    }

    // Stored one at a time, on its own, immediately: the window between an
    // issue existing and this knowing about it is the window in which a crash
    // means raising it twice.
    await request.database
      .updateTable('card')
      .set({ externalId: made.externalId, externalRef: made.ref, externalUrl: made.url })
      .where('id', '=', made.cardId)
      .execute();

    raised += 1;
  }

  return raised;
}

interface WriteRequest {
  readonly request: IssueSyncRequest;
  readonly project: SyncedProject;
  readonly connection: ReadableConnection;
  readonly found: readonly ForgeIssue[];
}

/** What the database settled on, and what the forge is about to be told. */
interface PushPlan {
  readonly added: number;
  readonly moved: number;
  readonly changes: IssueChange[];
  readonly labelled: LabelledIssue[];
  readonly boardLabels: BoardLabel[];
}

async function writeWhatArrived({
  request,
  project,
  connection,
  found,
}: WriteRequest): Promise<PushPlan> {
  let plan: PushPlan = { added: 0, moved: 0, changes: [], labelled: [], boardLabels: [] };

  await executeCommand({
    database: request.database,
    commandName: 'board.syncIssues',
    commandId: request.commandId,
    actorId: request.actorId,
    run: async (transaction) => {
      plan = await reconcile({ transaction, project, provider: connection.provider, found });

      await transaction.database
        .updateTable('scmConnection')
        .set({ issuesSyncedAt: new Date() })
        .where('id', '=', connection.id)
        .execute();

      transaction.appendEvent({
        accountId: project.accountId,
        aggregateType: 'project',
        aggregateId: project.id,
        // Named for cards rather than for issues, so the frame it becomes
        // carries the board, the card and the counts in the sidebar — all three
        // of which a sync can change.
        name: 'board.cardsSynced',
        payload: { projectId: project.id, added: plan.added, moved: plan.moved },
      });
    },
  });

  return plan;
}

interface Reconcile {
  readonly transaction: CommandTransaction;
  readonly project: SyncedProject;
  readonly provider: ScmProvider;
  readonly found: readonly ForgeIssue[];
}

/** Where a card goes on, where it goes when finished, and what each list is called. */
interface BoardEnds {
  readonly arriving: string;
  readonly finished: string;
  readonly nameById: ReadonlyMap<string, string>;
  readonly labels: BoardLabel[];
}

/** The forge wants a colour without the hash. */
function toBoardLabel(list: BoardList): BoardLabel {
  return { name: list.name, color: list.color.replace('#', '') };
}

interface LinkedCard {
  readonly id: string;
  readonly listId: string;
  readonly title: string;
  readonly description: string | null;
  readonly updatedAt: Date;
  /** Kept rather than rewritten, so a re-sync does not refinish a card. */
  readonly closedAt: Date | null;
}

async function reconcile({ transaction, project, provider, found }: Reconcile): Promise<PushPlan> {
  const ends = await readBoardEnds(transaction, project.id);
  const linked = await readLinkedCards(transaction, project.id);
  const dismissed = await readDismissedIssues(transaction, project.id);
  const labelled: LabelledIssue[] = [];
  const changes: IssueChange[] = [];

  let added = 0;
  let moved = 0;

  /*
   * Oldest first, so the keys this issues run the same way the issue numbers
   * do. The forge answers newest first, which would number a studio's oldest
   * issue highest and read as though the board had been filled in backwards.
   */
  for (const issue of [...found].reverse()) {
    const card = linked.get(issue.externalId);
    let listId: string;

    if (card === undefined) {
      if (dismissed.has(issue.externalId)) {
        /*
         * Somebody deleted the card this issue had, and making another is the
         * one thing that would undo that.
         *
         * Its labels are left alone too. A label here is the board saying which
         * list a card is in, and this board has nothing to say about an issue
         * it is deliberately not tracking.
         */
        continue;
      }

      if (project.syncOpenIssuesOnly && issue.isClosed) {
        /*
         * Finished before this board ever saw it.
         *
         * The closed half of the answer is here to settle cards that already
         * stand for an issue. One with no card is a piece of a repository's
         * history, and history arriving as cards is the whole of what this
         * setting was turned on to stop.
         */
        continue;
      }

      listId = await addCard({ transaction, project, provider, issue, ends });
      added += 1;
    } else {
      const outcome = await settle({ transaction, issue, card, ends });

      listId = outcome.listId;
      moved += outcome.moved ? 1 : 0;

      if (outcome.change !== null) {
        changes.push(outcome.change);
      }
    }

    labelled.push({
      ref: issue.ref,
      labels: issue.labels,
      listName: ends.nameById.get(listId) ?? null,
    });
  }

  return { added, moved, changes, labelled, boardLabels: ends.labels };
}

/**
 * The two lists a sync ever puts a card in.
 *
 * The first and the last by position, which is how a board is read: work arrives
 * on the left and finishes on the right. By position rather than by name, so a
 * studio that calls its last column Shipped keeps the behaviour they can see
 * rather than the one a string match guessed at.
 */
async function readBoardEnds(
  transaction: CommandTransaction,
  projectId: string,
): Promise<BoardEnds> {
  const { arriving, finished, lists } = await readEnds(transaction.database, projectId);

  return {
    arriving,
    finished,
    nameById: new Map(lists.map((list) => [list.id, list.name])),
    labels: lists.map(toBoardLabel),
  };
}

/**
 * The cards that already stand for an issue, by the id the forge knows them as.
 *
 * By external id rather than by source: a card raised here and linked afterwards
 * still came from here, and saying otherwise would lose where it was written.
 */
async function readLinkedCards(
  transaction: CommandTransaction,
  projectId: string,
): Promise<Map<string, LinkedCard>> {
  const cards = await transaction.database
    .selectFrom('card')
    .select(['id', 'externalId', 'listId', 'title', 'description', 'updatedAt', 'closedAt'])
    .where('projectId', '=', projectId)
    .where('externalId', 'is not', null)
    .execute();

  return new Map(
    cards.flatMap((card) =>
      card.externalId === null
        ? []
        : [
            [
              card.externalId,
              {
                id: card.id,
                listId: card.listId,
                title: card.title,
                description: card.description,
                updatedAt: card.updatedAt,
                closedAt: card.closedAt,
              },
            ] as const,
          ],
    ),
  );
}

/**
 * The issues this board has turned down, by the id the forge knows them as.
 *
 * Read once per sync rather than asked per issue: a repository with a thousand
 * issues would otherwise be a thousand round trips to answer a question about
 * the handful anybody has ever deleted.
 */
async function readDismissedIssues(
  transaction: CommandTransaction,
  projectId: string,
): Promise<ReadonlySet<string>> {
  const dismissed = await transaction.database
    .selectFrom('dismissedIssue')
    .select('externalId')
    .where('projectId', '=', projectId)
    .execute();

  return new Set(dismissed.map((row) => row.externalId));
}

interface CardWrite {
  readonly transaction: CommandTransaction;
  readonly project: SyncedProject;
  readonly provider: ScmProvider;
  readonly issue: ForgeIssue;
  readonly ends: BoardEnds;
}

/**
 * An issue nothing here has seen before.
 *
 * A closed one lands straight at the finished end rather than arriving and then
 * being moved: the first sync of a repository with a year of history behind it
 * should read as that history, not as a hundred cards to work through.
 *
 * The list's WIP limit is not consulted. A limit is about how much work is in
 * progress at once, and this is the forge saying what exists — refusing to
 * record an issue because a column is full would lose the issue rather than
 * enforce anything.
 */
async function addCard({
  transaction,
  project,
  provider,
  issue,
  ends,
}: CardWrite): Promise<string> {
  const listId = issue.isClosed ? ends.finished : ends.arriving;
  const type = readCardType(issue.labels);

  const card = await transaction.database
    .insertInto('card')
    .values({
      accountId: project.accountId,
      projectId: project.id,
      listId,
      cardKey: await allocateCardKey({
        database: transaction.database,
        projectId: project.id,
        projectCode: project.code,
        cardType: type,
      }),
      title: issue.title,
      description: issue.body,
      type,
      // Nobody here reported it. Naming whoever pressed the button would put
      // their face on a hundred cards they have never read.
      reporterId: null,
      position: await placeAtEndOfList(transaction.database, listId),
      source: provider,
      externalId: issue.externalId,
      externalRef: issue.ref,
      externalUrl: issue.url,
      /*
       * The issue's own time, not now.
       *
       * A card this made is not a card anybody has touched, and starting it at
       * `now` would make the board newer than the issue the moment it arrives —
       * which would hand the board every argument from the next sync onwards.
       */
      updatedAt: issue.updatedAt,
      /*
       * A closed issue arrives finished, and says so.
       *
       * The stamp is the issue's own time rather than now, for the reason above:
       * a year of history should read as history, not as a hundred things that
       * were all finished the afternoon somebody connected the repository.
       */
      closedAt: issue.isClosed ? issue.updatedAt : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  transaction.appendEvent({
    accountId: project.accountId,
    aggregateType: 'card',
    aggregateId: card.id,
    name: 'board.cardCreated',
    payload: { projectId: project.id, listId, type, source: provider },
  });

  return listId;
}

interface Settlement {
  readonly listId: string;
  readonly moved: boolean;
  readonly change: IssueChange | null;
}

/**
 * A card and its issue, brought into step.
 *
 * Whichever changed last wins the words. The state is separate and always the
 * board's: which list a card is on is the answer to where the work is up to, so
 * closing an issue moves the card and moving the card closes the issue.
 */
async function settle({
  transaction,
  issue,
  card,
  ends,
}: {
  transaction: CommandTransaction;
  issue: ForgeIssue;
  card: LinkedCard;
  ends: BoardEnds;
}): Promise<Settlement> {
  const cardIsClosed = card.listId === ends.finished;
  const cardChangedLast = card.updatedAt.getTime() > issue.updatedAt.getTime();

  /*
   * The state, decided before the words.
   *
   * The side that changed last says whether this is finished, the same rule the
   * title follows — otherwise dragging a card to Done would be undone by an
   * issue that has been open since last week.
   */
  const isClosed = cardChangedLast ? cardIsClosed : issue.isClosed;
  const listId = isClosed ? ends.finished : ends.arriving;
  const moves = isClosed !== cardIsClosed;

  const change = cardChangedLast ? whatTheIssueShouldSay({ issue, card, isClosed }) : null;
  const pulled = cardChangedLast ? {} : whatTheCardShouldSay(issue, card);

  const patch = {
    ...pulled,
    externalRef: issue.ref,
    externalUrl: issue.url,
    ...(moves
      ? {
          listId,
          position: await placeAtEndOfList(transaction.database, listId),
          /*
           * The same stamp a move by hand would leave. This writes `list_id`
           * itself rather than going through `board.moveCard`, so it owes the
           * board the one thing that move would have done.
           */
          closedAt: closingStampFor({
            isFinishingList: listId === ends.finished,
            closedAt: card.closedAt,
            now: new Date(),
          }),
        }
      : undefined),
  };

  /*
   * `updatedAt` is deliberately not set.
   *
   * A sync is not somebody touching a card, and saying it was would make the
   * board newer than the issue every time — which would hand the board every
   * argument from the second sync onwards.
   */
  await transaction.database.updateTable('card').set(patch).where('id', '=', card.id).execute();

  return { listId: moves ? listId : card.listId, moved: moves, change };
}

/**
 * What the issue is told, when the card is the side that changed.
 *
 * Null when there is nothing to say: a change carrying only the ref would be a
 * request that asks the forge to leave an issue exactly as it is.
 */
function whatTheIssueShouldSay({
  issue,
  card,
  isClosed,
}: {
  issue: ForgeIssue;
  card: LinkedCard;
  isClosed: boolean;
}): IssueChange | null {
  const change: IssueChange = {
    ref: issue.ref,
    ...(card.title === issue.title ? {} : { title: card.title }),
    ...((card.description ?? '') === (issue.body ?? '') ? {} : { body: card.description }),
    ...(issue.isClosed === isClosed ? {} : { state: isClosed ? 'closed' : 'open' }),
  };

  return Object.keys(change).length === 1 ? null : change;
}

/** What the card is told, when the issue is the side that changed. */
function whatTheCardShouldSay(
  issue: ForgeIssue,
  card: LinkedCard,
): { title?: string; description?: string | null } {
  return {
    ...(card.title === issue.title ? {} : { title: issue.title }),
    ...((card.description ?? '') === (issue.body ?? '') ? {} : { description: issue.body }),
  };
}

/**
 * Everything the forge is told, once the board has settled.
 *
 * After the transaction and outside it: these are requests to somebody else's
 * server, and the board is not staying locked while GitHub thinks about them —
 * which also means a forge that refuses costs nobody their cards.
 */
async function pushBack({
  reader,
  plan,
}: {
  reader: RepositoryReader;
  plan: PushPlan;
}): Promise<void> {
  await refusing(async () => {
    for (const change of plan.changes) {
      await changeIssue(reader, change);
    }

    const labelChanges = planIssueLabels(
      plan.labelled,
      plan.boardLabels.map((label) => label.name),
    );

    if (labelChanges.length > 0) {
      await writeIssueLabels({ reader, changes: labelChanges, boardLabels: plan.boardLabels });
    }
  });
}

/**
 * What kind of card an issue becomes.
 *
 * A label saying bug is the one signal a forge gives that maps onto anything
 * here, and studios do use it. Everything else is a task, which is what a card
 * with no other information is.
 */
function readCardType(labels: readonly string[]): CardType {
  return labels.some((label) => label.toLowerCase() === 'bug') ? 'bug' : 'task';
}
