import { sql, type Kysely } from 'kysely';

/**
 * Files, and what they are attached to.
 *
 * Bytes never come near Postgres. A row here is the metadata for an object in
 * the store, and `storage_key` is where that object lives.
 */

const FILE_STATES = ['pending', 'stored'] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  await createFileTable(database);
  await createCardAttachmentTable(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const tableName of ['card_attachment', 'file']) {
    await database.schema.dropTable(tableName).ifExists().execute();
  }
}

async function createFileTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('file')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    /** Where the object lives in the store. Never guessed at, always read. */
    .addColumn('storage_key', 'text', (column) => column.notNull().unique())
    .addColumn('filename', 'text', (column) => column.notNull())
    .addColumn('mime', 'text', (column) => column.notNull())
    .addColumn('bytes', 'bigint')
    .addColumn('sha256', 'text')
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    /**
     * `pending` until the browser says the upload finished.
     *
     * The API hands out a presigned URL and never sees the bytes, so this is the
     * only thing that distinguishes a file that arrived from one somebody asked
     * to send and then closed the tab on.
     */
    .addColumn('state', 'text', (column) => column.notNull().defaultTo('pending'))
    .addColumn('uploaded_by', 'uuid', (column) => column.references('app_user.id'))
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('stored_at', 'timestamptz')
    .addCheckConstraint(
      'file_state_known',
      sql`state in (${sql.join(FILE_STATES.map((state) => sql.lit(state)))})`,
    )
    .addCheckConstraint('file_bytes_not_negative', sql`bytes is null or bytes >= 0`)
    .execute();

  // Sweeping up uploads nobody finished, which needs the old pending ones.
  await sql`
    create index file_pending_idx on file (account_id, created_at)
      where state = 'pending'
  `.execute(database);
}

async function createCardAttachmentTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('card_attachment')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('card_id', 'uuid', (column) =>
      column.notNull().references('card.id').onDelete('cascade'),
    )
    .addColumn('file_id', 'uuid', (column) =>
      column.notNull().references('file.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    // The same file on the same card twice is one attachment.
    .addUniqueConstraint('card_attachment_unique', ['card_id', 'file_id'])
    .execute();

  await sql`
    create index card_attachment_on_card_idx on card_attachment (card_id, created_at)
  `.execute(database);
}
