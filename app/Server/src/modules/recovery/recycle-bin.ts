import { sql, type BinnedRepair, type BinnedRows, type Database } from '@lpm/database';
import { RECOVERABLE_KINDS, type RecoverableKind } from '@lpm/shared';

import type { CommandTransaction } from '../../cqrs/execute-command.js';
import { InvariantViolatedError } from '../../domain/index.js';

/**
 * How long a deleted thing waits before it is really gone.
 *
 * A week, because that is how long it takes somebody to come back from leave
 * and notice. Written onto each row rather than applied on the way past, so a
 * studio given a different number later does not silently change the date on
 * everything already in the bin.
 */
export const RETENTION_DAYS = 7;

/**
 * One table's part in putting a thing back.
 *
 * Every name here is snake_case, because these go into raw SQL and Kysely's
 * `CamelCasePlugin` does not reach inside a `sql` fragment.
 */
interface Part {
  readonly table: string;
  /**
   * What ties the rows to the thing: `id` on the thing itself, the foreign key
   * on everything under it.
   *
   * A list of columns for a table that reaches the thing more than one way.
   *
   * A link between two cards holds `from_card_id` and `to_card_id`, and a
   * card's links are the rows where *either* of them is that card. One part
   * naming both rather than two parts naming one each, because a restore looks
   * a part up by its table name and two parts on one table would leave the
   * second unreachable.
   */
  readonly by: string | readonly string[];
  /**
   * Rows here are only put back while their other end still exists.
   *
   * A team holds links to permission groups. Restore the team a fortnight after
   * one of those groups was deleted and the link has nowhere to point — and a
   * restore that fails wholesale over a link is worse than one that comes back
   * with the links that still mean something. Never set on the thing itself: if
   * *its* parent is gone, that is a failure worth saying out loud.
   */
  readonly needs?: readonly { readonly column: string; readonly table: string }[];
  /**
   * Columns emptied on the way back in, when what they pointed at has gone.
   *
   * The other half of `needs`, and which one applies is a question about what
   * the column means. A link row *is* the relationship between its two ends, so
   * losing one end leaves nothing worth restoring and the row is dropped. A
   * card's milestone is an attribute of the card: the card is still entirely
   * itself without it, so it comes back and forgets the date it was promised
   * for rather than refusing to come back at all.
   *
   * Only ever for a column the database would have emptied itself — every one
   * of these is `on delete set null` — so forgetting one puts the row into a
   * state it would have reached anyway had it not been in the bin at the time.
   */
  readonly forgets?: readonly { readonly column: string; readonly table: string }[];
}

interface Recipe {
  /** What to call it in the bin: "Team", "Milestone". */
  readonly what: string;
  /**
   * Parents first. The foreign keys these rows carry are still real, so the
   * order they were taken out in is the order they go back in.
   */
  readonly parts: readonly Part[];
}

/**
 * Every kind of thing the bin knows how to keep, and how to put each one back.
 *
 * Not every delete goes through here. A session, a tag, a link between two
 * cards — those are edits to a thing rather than the loss of one, and a bin
 * full of them is a bin nobody reads. The test is whether somebody would say
 * "I deleted the wrong one".
 *
 * Projects, lists and assets are absent for the opposite reason: they archive
 * rather than delete, and already have a way back.
 */
const RECIPES = {
  team: {
    what: 'Team',
    parts: [
      { table: 'team', by: 'id' },
      { table: 'team_member', by: 'team_id', needs: [{ column: 'user_id', table: 'app_user' }] },
      {
        table: 'team_permission_group',
        by: 'team_id',
        needs: [{ column: 'group_id', table: 'permission_group' }],
      },
      // And the projects it was on, which is reach rather than permission: a
      // team restored without them is a team whose people can no longer open
      // anything, and nothing on the screen would say why.
      {
        table: 'project_team',
        by: 'team_id',
        needs: [{ column: 'project_id', table: 'project' }],
      },
    ],
  },
  permissionGroup: {
    what: 'Permission group',
    parts: [
      { table: 'permission_group', by: 'id' },
      { table: 'permission_rule', by: 'group_id' },
      {
        table: 'team_permission_group',
        by: 'group_id',
        needs: [{ column: 'team_id', table: 'team' }],
      },
      // And whoever held it in their own right. Same reasoning as the team's:
      // a link to somebody who has since gone is left out rather than failing
      // the whole restore.
      {
        table: 'user_permission_group',
        by: 'group_id',
        needs: [{ column: 'user_id', table: 'app_user' }],
      },
    ],
  },
  milestone: {
    what: 'Milestone',
    parts: [{ table: 'milestone', by: 'id' }],
  },
  projectDoc: {
    what: 'Document',
    parts: [{ table: 'project_doc', by: 'id' }],
  },
  projectRelease: {
    what: 'Release',
    parts: [
      { table: 'project_release', by: 'id' },
      { table: 'release_asset', by: 'release_id' },
    ],
  },
  assetCategory: {
    what: 'Asset category',
    parts: [{ table: 'asset_category', by: 'id' }],
  },
  card: {
    what: 'Card',
    parts: [
      {
        table: 'card',
        by: 'id',
        /*
         * The only two things a card points at that can go while it waits.
         *
         * Everything else it holds is a row nothing in the product deletes: its
         * list and its project archive, and people are suspended rather than
         * removed. These two do go, and both are `on delete set null` — so a
         * card whose milestone was dropped last Tuesday comes back unpromised,
         * which is exactly where it would have been had it never left.
         */
        forgets: [
          { column: 'milestone_id', table: 'milestone' },
          { column: 'legend_id', table: 'card' },
        ],
      },
      { table: 'subtask', by: 'card_id' },
      // Including the ones somebody had already deleted. A comment removed from
      // a conversation is part of what that card was, and restoring the card as
      // it stood means restoring the row in the state it was in.
      { table: 'comment', by: 'card_id' },
      {
        table: 'card_link',
        by: ['from_card_id', 'to_card_id'],
        needs: [
          { column: 'from_card_id', table: 'card' },
          { column: 'to_card_id', table: 'card' },
        ],
      },
      { table: 'card_attachment', by: 'card_id', needs: [{ column: 'file_id', table: 'file' }] },
      {
        table: 'scm_link',
        by: 'card_id',
        needs: [{ column: 'connection_id', table: 'scm_connection' }],
      },
      { table: 'card_asset_link', by: 'card_id', needs: [{ column: 'asset_id', table: 'asset' }] },
    ],
  },
  // Typed against the wire's own list rather than inferred from these keys,
  // so a kind offered to the client with no recipe behind it — or a recipe
  // nothing can ask for — is a compile error rather than a button that fails.
} as const satisfies Readonly<Record<RecoverableKind, Recipe>>;

export type { RecoverableKind };

/**
 * The line under a name in the bin: "4 people", "1 rule".
 *
 * Here rather than at each of the deletes that write one, because they all say
 * the same shape of thing and a bin reading "1 people" is the kind of small
 * wrongness that makes a screen feel unfinished.
 */
export function howMany(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** What the bin calls this kind of thing. */
export function describeKind(kind: RecoverableKind): string {
  return RECIPES[kind].what;
}

/** Whether a string off a row is a kind the bin still knows how to restore. */
export function isRecoverableKind(kind: string): kind is RecoverableKind {
  return (RECOVERABLE_KINDS as readonly string[]).includes(kind);
}

interface BinRequest {
  readonly transaction: CommandTransaction;
  readonly kind: RecoverableKind;
  readonly accountId: string;
  readonly actorId: string;
  readonly subjectId: string;
  /** What it was called. The only part of a bin row anybody reads. */
  readonly name: string;
  /** The line under the name: "4 people", "in Saltmarsh". */
  readonly about?: string | null;
  /** Null for a thing that belongs to the install rather than to a project. */
  readonly projectId?: string | null;
  /**
   * What the delete is about to change on rows it is not deleting.
   *
   * Gathered by the caller, because only the caller knows: the category command
   * knows which assets it is about to move, and the bin has no way to work that
   * out afterwards.
   */
  readonly repairs?: readonly BinnedRepair[];
}

/**
 * Takes a copy of a thing, immediately before it is deleted.
 *
 * Called first, inside the same transaction as the delete: the rows have to
 * still be there to be copied, and a bin row for a delete that then rolled back
 * would be an offer to restore something that never went.
 *
 * `to_jsonb(row)` rather than a list of columns, so adding a column to one of
 * these tables next year does not quietly stop being kept.
 */
export async function binIt(request: BinRequest): Promise<void> {
  const { transaction, kind, accountId, subjectId } = request;
  const rows: BinnedRows[] = [];

  for (const part of RECIPES[kind].parts) {
    const found = await gather(transaction, part, { subjectId, accountId });

    // A part with nothing under it is not written down. Restoring reads what is
    // here and nothing else, so an empty list would only be noise.
    if (found.length > 0) {
      rows.push({ table: part.table, rows: found });
    }
  }

  if (rows.length === 0) {
    // Every recipe's first part is the thing itself, so nothing at all means
    // the caller binned something that was not there.
    throw new InvariantViolatedError('There is nothing there to keep.');
  }

  await transaction.database
    .insertInto('deletedThing')
    .values({
      accountId,
      kind,
      subjectId,
      name: request.name,
      about: request.about ?? null,
      projectId: request.projectId ?? null,
      rows: JSON.stringify(rows),
      repairs: JSON.stringify(request.repairs ?? []),
      deletedBy: request.actorId,
      /*
       * The database's clock rather than the server's.
       *
       * `deleted_at` defaults to `now()`, so working the date out here would
       * put the two a request's worth of latency apart — and "seven days from
       * when it was deleted" should be exactly that, measured against the same
       * clock that recorded the deletion.
       */
      purgeAfter: sql<Date>`now() + make_interval(days => ${RETENTION_DAYS})`,
    })
    .execute();
}

/** The columns a part is tied to the thing by, however it was written. */
function columnsOf(part: Part): readonly string[] {
  return typeof part.by === 'string' ? [part.by] : part.by;
}

async function gather(
  transaction: CommandTransaction,
  part: Part,
  what: { readonly subjectId: string; readonly accountId: string },
): Promise<Record<string, unknown>[]> {
  /*
   * The account is checked on the thing itself and nowhere else.
   *
   * The thing is found by an id the caller supplied, so which account it
   * belongs to is a real question. Its children are found by *its* id, which
   * has just been proved — and half of them have no `account_id` at all,
   * because being in a team is already as scoped as a team is.
   */
  const inTheAccount = part.by === 'id' ? sql`and each.account_id = ${what.accountId}` : sql``;

  // Parenthesised, because a part naming two columns is an `or` and the account
  // check above is an `and` beside it.
  const reaches = sql.join(
    columnsOf(part).map((column) => sql`each.${sql.ref(column)} = ${what.subjectId}`),
    sql` or `,
  );

  /*
   * Back as text, and parsed here.
   *
   * `CamelCasePlugin` walks the objects and arrays inside a result and renames
   * their keys — including the ones inside a `jsonb` column. These keys *are*
   * column names, and a payload that came back as `accountId` would go back in
   * as a row with no `account_id`. Text is a string, which the plugin leaves
   * alone, and `JSON.parse` here is a parse nothing else has an opinion about.
   */
  const gathered = await sql<{ rows: string }>`
    select coalesce(jsonb_agg(to_jsonb(each)), '[]'::jsonb)::text as rows
    from ${sql.table(part.table)} as each
    where (${reaches})
    ${inTheAccount}
  `.execute(transaction.database);

  const found: unknown = JSON.parse(gathered.rows[0]?.rows ?? '[]');

  return found as Record<string, unknown>[];
}

/**
 * Puts a thing back where it was.
 *
 * `jsonb_populate_recordset(null::the_table, …)` rather than a column list:
 * Postgres casts each field against the table's own row type, so a timestamp
 * comes back a timestamp and a `numeric` position comes back at full precision,
 * without anybody writing the conversions out. It also means a column added to
 * one of these tables needs no change here.
 */
export async function restoreFrom(
  transaction: CommandTransaction,
  binned: {
    readonly kind: RecoverableKind;
    readonly rows: readonly BinnedRows[];
    readonly repairs: readonly BinnedRepair[];
  },
): Promise<void> {
  const parts = RECIPES[binned.kind].parts;

  /*
   * Whatever can wait until the whole thing is back, waits.
   *
   * A thing comes back in pieces — its rows, then the repairs that undo what its
   * delete moved — and is only whole once the last of them has landed. A `Props`
   * deleted out from over a `Props` comes back to a level its own child is
   * standing in, and stops clashing only when a repair moves the child back
   * inside it. `all` rather than a name, because the bin does not know which of
   * its tables carry a constraint that can wait; one made deferrable said so.
   */
  await sql`set constraints all deferred`.execute(transaction.database);

  for (const saved of binned.rows) {
    const part = parts.find((each) => each.table === saved.table);

    if (part === undefined) {
      // The recipe changed under a bin row written by an older version. Better
      // to say so than to leave a table out and call the thing restored.
      throw new InvariantViolatedError(
        'This was deleted by an older version of the app and can no longer be put back.',
      );
    }

    await insertPart(transaction, part, saved.rows);
  }

  for (const repair of binned.repairs) {
    await applyRepair(transaction, repair);
  }

  // Checked now rather than at the commit, so a thing that genuinely cannot fit
  // back fails inside the restore that tried.
  await sql`set constraints all immediate`.execute(transaction.database);
}

/**
 * Empties the columns whose other end has gone since.
 *
 * In JavaScript rather than in the insert, because the insert's whole trick is
 * `select back.*` — it never names a column, which is what lets a column added
 * next year come back without anybody editing this. Overriding one field would
 * mean writing out all of them and losing that.
 */
async function forgetWhatIsGone(
  transaction: CommandTransaction,
  part: Part,
  rows: readonly Record<string, unknown>[],
): Promise<readonly Record<string, unknown>[]> {
  let kept = rows;

  for (const forget of part.forgets ?? []) {
    const pointedAt = [
      ...new Set(
        kept.map((row) => row[forget.column]).filter((id): id is string => typeof id === 'string'),
      ),
    ];

    if (pointedAt.length === 0) {
      continue;
    }

    const found = await sql<{ id: string }>`
      select each.id::text as id
      from ${sql.table(forget.table)} as each
      where each.id = any(${sql.val(pointedAt)}::uuid[])
    `.execute(transaction.database);

    const stillThere = new Set(found.rows.map((row) => row.id));

    kept = kept.map((row) => {
      const value = row[forget.column];

      return typeof value === 'string' && !stillThere.has(value)
        ? { ...row, [forget.column]: null }
        : row;
    });
  }

  return kept;
}

async function insertPart(
  transaction: CommandTransaction,
  part: Part,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const table = sql.table(part.table);
  const payload = JSON.stringify(await forgetWhatIsGone(transaction, part, rows));

  // Each `needs` is one more reason a row is left out. The things themselves
  // have none, so a missing parent stays a failure rather than a silent
  // nothing.
  const stillThere = (part.needs ?? []).map(
    (need) => sql`exists (
      select 1 from ${sql.table(need.table)} as other
      where other.id = back.${sql.ref(need.column)}
    )`,
  );

  const onlyWhatFits =
    stillThere.length === 0 ? sql`` : sql`where ${sql.join(stillThere, sql` and `)}`;

  await sql`
    insert into ${table}
    select back.* from jsonb_populate_recordset(null::${table}, ${payload}::jsonb) as back
    ${onlyWhatFits}
  `.execute(transaction.database);
}

/**
 * Puts one column back, but only where the delete's own change is still what is
 * there.
 *
 * `is not distinct from` rather than `=`, because most of these were set to
 * null and null is not equal to anything, itself included. Somebody who refiled
 * the asset in the meantime meant it, and undoing a delete is not licence to
 * undo that too.
 */
async function applyRepair(transaction: CommandTransaction, repair: BinnedRepair): Promise<void> {
  await sql`
    update ${sql.table(repair.table)}
    set ${sql.ref(repair.column)} = ${repair.was}
    where id = ${repair.id}
      and ${sql.ref(repair.column)} is not distinct from ${repair.now}
  `.execute(transaction.database);
}

/**
 * Drops everything past its date, across every account.
 *
 * The whole of the retention promise. Nothing else deletes a bin row except a
 * restore, so a row that is gone from here is gone.
 */
export async function purgeExpired(database: Database, now: Date): Promise<number> {
  const gone = await database
    .deleteFrom('deletedThing')
    .where('purgeAfter', '<=', now)
    .executeTakeFirst();

  return Number(gone.numDeletedRows);
}
