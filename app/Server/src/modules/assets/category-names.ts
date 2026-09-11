import { sql, type DatabaseTransaction } from '@lpm/database';

/**
 * The rule that a category's name is unique among its siblings, as Postgres
 * calls it.
 *
 * Made in `0060-a-category-inside-a-category`, and made deferrable in
 * `0061-a-name-can-wait-for-the-end-of-a-command`. A clash is recognised by this
 * name rather than by the error code: any other unique violation from the same
 * statement is a genuine surprise, and should not be reported as a name clash.
 */
export const CATEGORY_NAME_CONSTRAINT = 'asset_category_name_unique_among_siblings';

interface NamesSettling {
  readonly transaction: DatabaseTransaction;
  /** Writes that may pass through a clash, as long as they do not end in one. */
  readonly work: () => Promise<void>;
}

/**
 * Runs writes that pass through a name clash on the way to a library without one.
 *
 * Deleting a `Props` that holds a `Props` stands the two side by side until the
 * parent has gone, and only the end of the delete is a library anybody sees. So
 * names are checked once `work` is done rather than at every row it writes — and
 * checked here rather than left to the commit, so a clash that really is left
 * over fails inside the command that made it, the way any other refusal does.
 */
export async function whileNamesSettle({ transaction, work }: NamesSettling): Promise<void> {
  await sql`set constraints ${sql.ref(CATEGORY_NAME_CONSTRAINT)} deferred`.execute(transaction);

  await work();

  await sql`set constraints ${sql.ref(CATEGORY_NAME_CONSTRAINT)} immediate`.execute(transaction);
}
