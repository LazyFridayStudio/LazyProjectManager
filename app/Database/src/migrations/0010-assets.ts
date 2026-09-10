import { sql, type Kysely } from 'kysely';

/**
 * The asset library: what a project has to make, grouped by what kind of thing
 * it is.
 *
 * Separate from the board on purpose. A card is a piece of work somebody is
 * doing this week; an asset is a thing the game needs, which may take four cards
 * and three months, or none at all because it was cut. Modelling one as the
 * other is how a tracker ends up with a "task" nobody can close because the
 * thing it names still exists.
 */

const ASSET_STATUSES = ['concept', 'wip', 'review', 'approved', 'final'] as const;

export async function up(database: Kysely<unknown>): Promise<void> {
  await createAssetCategoryTable(database);
  await createAssetTable(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const tableName of ['asset', 'asset_category']) {
    await database.schema.dropTable(tableName).ifExists().execute();
  }
}

async function createAssetCategoryTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_category')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    /** Its own colour, as the lists on the board have. */
    .addColumn('color', 'text', (column) => column.notNull())
    /**
     * What the studio expects this category to cost, for the bar beside its
     * name. Nullable: a category nobody has budgeted is a normal thing, and a
     * zero would read as "budgeted at nothing" instead.
     */
    .addColumn('budget_minor', 'bigint')
    /** Numeric, as list positions are, so a category can be dropped between two. */
    .addColumn('position', 'numeric(20, 10)', (column) => column.notNull())
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('asset_category_name_unique_per_project', ['project_id', 'name'])
    .execute();
}

async function createAssetTable(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    /**
     * Restricted rather than cascaded: deleting a category with assets in it
     * would take the assets with it, and a category is a way of grouping things
     * rather than a thing that owns them.
     */
    .addColumn('category_id', 'uuid', (column) =>
      column.notNull().references('asset_category.id').onDelete('restrict'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    /** Free text — "cloth", "tier 3" — rather than a second level of category. */
    .addColumn('subcategory', 'text')
    .addColumn('status', 'text', (column) => column.notNull().defaultTo('concept'))
    .addColumn('description', 'text')
    /**
     * What it is expected to cost. Minor units, as the project's budget is, so
     * the two add up without anybody rounding twice.
     */
    .addColumn('estimated_cost_minor', 'bigint')
    .addColumn('assignee_id', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .addColumn('due_on', 'date')
    .addColumn('position', 'numeric(20, 10)', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'asset_status_known',
      sql`status in (${sql.join(ASSET_STATUSES.map((status) => sql.lit(status)))})`,
    )
    .execute();

  // How the library reads: one category at a time, in order.
  await database.schema
    .createIndex('asset_category_position_idx')
    .on('asset')
    .columns(['category_id', 'position'])
    .execute();
}
