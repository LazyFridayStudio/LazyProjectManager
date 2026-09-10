import { sql, type Kysely } from 'kysely';

/**
 * The key an asset is referred to by: `DRCH-AST-6`.
 *
 * The same shape as a ticket key, because it is the same idea — a short thing
 * to say out loud in a stand-up, put in a commit message, or write on a
 * whiteboard. "The watchtower" is ambiguous across two projects; `DRCH-AST-6`
 * is not.
 *
 * A counter of its own rather than a row in `card_sequence`. That table carries
 * a check constraint naming the four card prefixes, which is a deliberate guard
 * saying what it is for; widening it to let assets in would be removing the
 * guard rather than using the table. This is one integer per project, and it
 * leaves the ticket-key screen about tickets.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_sequence')
    .addColumn('project_id', 'uuid', (column) =>
      column.primaryKey().references('project.id').onDelete('cascade'),
    )
    // A row per project rather than a Postgres sequence, for the reason
    // `card_sequence` gives: keys must have no gaps, and a sequence keeps its
    // consumed value when a transaction rolls back.
    .addColumn('last_value', 'integer', (column) => column.notNull().defaultTo(0))
    .addCheckConstraint('asset_sequence_not_negative', sql`last_value >= 0`)
    .execute();

  await database.schema.alterTable('asset').addColumn('asset_key', 'text').execute();

  // Everything already in a library gets a key, numbered the way the library
  // reads: down each project in the order the assets sit in.
  await sql`
    with numbered as (
      select
        asset.id,
        project.code as project_code,
        row_number() over (
          partition by asset.project_id
          order by asset.position, asset.created_at, asset.id
        ) as number
      from asset
        join project on project.id = asset.project_id
    )
    update asset
    set asset_key = numbered.project_code || '-AST-' || numbered.number
    from numbered
    where numbered.id = asset.id
  `.execute(database);

  // And the counter starts where the backfill left off, so the next asset does
  // not take a key something already has.
  await sql`
    insert into asset_sequence (project_id, last_value)
    select project.id, count(asset.id)
    from project
      left join asset on asset.project_id = project.id
    group by project.id
  `.execute(database);

  await sql`alter table asset alter column asset_key set not null`.execute(database);

  await database.schema
    .alterTable('asset')
    .addUniqueConstraint('asset_key_unique_per_project', ['project_id', 'asset_key'])
    .execute();
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('asset')
    .dropConstraint('asset_key_unique_per_project')
    .ifExists()
    .execute();

  await database.schema.alterTable('asset').dropColumn('asset_key').execute();
  await database.schema.dropTable('asset_sequence').ifExists().execute();
}
