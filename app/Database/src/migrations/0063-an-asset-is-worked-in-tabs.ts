import { sql, type Kysely } from 'kysely';

/**
 * An asset is worked through as tabs of tasks, not a status and a row of stages.
 *
 * One game item is many distinct jobs: a creature needs a mesh, UVs, textures, a
 * rig, a dozen animations and hooking up in the game, and each of those has its
 * own files, notes, checklist, hours and often its own person. A stage was one
 * line with a checkbox, so all of that went back into the one description and
 * the one file list. A card per job worked, and buried the board under pipeline
 * steps.
 *
 * Four things change at once, because each is half of one idea:
 *
 * - **Phase replaces status.** Five words mixed where an asset is in production
 *   with whether somebody had looked at it. Once the work lives in tabs, done and
 *   in-review belong to each tab, and the asset only says which broad phase it is
 *   in. `concept` is Pre-dev, `wip` and `review` are Dev, `approved` and `final`
 *   are Production.
 * - **A tab is a task on the asset**, built from blocks: notes, a checklist, the
 *   files that belong to it, the hours spent on it. Every stage becomes a tab with
 *   the same title, done or not as it was.
 * - **Files and hours stay on the asset**, and may say which tab they belong to.
 *   So the asset's totals need no adding up, and losing a tab loses nobody's
 *   hours: the column empties and the entry stays where it always was.
 * - **A project keeps templates**, a set of tabs saved from one asset to start
 *   the next, and a category can name the one it usually wants.
 *
 * `0051-an-asset-is-made-in-stages` said a pipeline that came with a category
 * would be a fourth opinion about how a studio works. A template is not that:
 * nothing ships with one, a studio writes its own, and a category only offers it.
 * What changed is the evidence — a studio making forty creatures re-types the
 * same five stages forty times.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await statusBecomesPhase(database);
  await createTemplates(database);
  await createTabs(database);
  await createBlocks(database);
  await tieFilesAndHoursToTabs(database);
  await stagesBecomeTabs(database);
  await letGroupsSpeakAboutTemplates(database);
}

/**
 * The column is renamed rather than replaced, so nothing that points at an asset
 * notices, and every asset keeps the phase its status said.
 */
async function statusBecomesPhase(database: Kysely<unknown>): Promise<void> {
  await sql`alter table asset drop constraint asset_status_known`.execute(database);
  await sql`alter table asset rename column status to phase`.execute(database);

  await sql`
    update asset set phase = case phase
      when 'concept' then 'pre_dev'
      when 'wip' then 'dev'
      when 'review' then 'dev'
      else 'production'
    end
  `.execute(database);

  await sql`alter table asset alter column phase set default 'pre_dev'`.execute(database);
  await sql`
    alter table asset
      add constraint asset_phase_known check (phase in ('pre_dev', 'dev', 'production'))
  `.execute(database);
}

/**
 * A set of tabs a project saved, to start an asset from.
 *
 * The tabs and their blocks are one `jsonb` value rather than three more tables.
 * A template is copied from and never edited a block at a time, so the only
 * question ever asked of it is "what is in it", and a copy of what an asset had
 * on the day is exactly what one is. It is read back as `text`, because the
 * `CamelCasePlugin` renames keys inside a `jsonb` column on the way out.
 *
 * Unique by name within a project: two templates both called "Creature" is a
 * picker nobody can choose from.
 */
async function createTemplates(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_template')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('project_id', 'uuid', (column) =>
      column.notNull().references('project.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('definition', 'jsonb', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('asset_template_name_unique', ['project_id', 'name'])
    .execute();

  // Offered, never imposed: an asset filed under Creatures starts with the
  // creature tabs unless whoever adds it says otherwise. A template deleted
  // later leaves the category offering nothing, which is where it started.
  await database.schema
    .alterTable('asset_category')
    .addColumn('default_template_id', 'uuid', (column) =>
      column.references('asset_template.id').onDelete('set null'),
    )
    .execute();
}

/**
 * The tabs, the blocks inside them, and the items of a checklist block.
 *
 * Every row below a tab carries the asset and the tab it is under, though both
 * could be reached through its parent. The bin finds what to keep by a column
 * pointing at the thing being deleted, and an asset and a tab are both things
 * that can be deleted; without the copies, a deleted asset would come back from
 * the bin with empty tabs.
 *
 * A tab carries `account_id` because the bin keeps one on its own, and checks
 * the account on the thing it was handed.
 */
async function createTabs(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_tab')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('account_id', 'uuid', (column) =>
      column.notNull().references('account.id').onDelete('cascade'),
    )
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('done', 'boolean', (column) => column.notNull().defaultTo(false))
    // Who is doing this part, which is often not who owns the asset: the
    // rigger is not the modeller.
    .addColumn('assignee_id', 'uuid', (column) =>
      column.references('app_user.id').onDelete('set null'),
    )
    .addColumn('due_on', 'date')
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`create index asset_tab_on_asset_idx on asset_tab (asset_id, position)`.execute(
    database,
  );
}

/** What a tab is built from, and the lines of a checklist block. */
async function createBlocks(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .createTable('asset_tab_block')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('tab_id', 'uuid', (column) =>
      column.notNull().references('asset_tab.id').onDelete('cascade'),
    )
    .addColumn('kind', 'text', (column) => column.notNull())
    // What a notes block says. Nothing else has text of its own.
    .addColumn('body', 'text')
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'asset_tab_block_kind_known',
      sql`kind in ('notes', 'checklist', 'files', 'work')`,
    )
    .execute();

  await sql`create index asset_tab_block_on_tab_idx on asset_tab_block (tab_id, position)`.execute(
    database,
  );

  // A files block and a work block show what is tagged to their tab, so a
  // second of either would show the same things twice.
  await sql`
    create unique index asset_tab_block_one_view_per_tab
      on asset_tab_block (tab_id, kind) where kind in ('files', 'work')
  `.execute(database);

  await database.schema
    .createTable('asset_tab_checklist_item')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('tab_id', 'uuid', (column) =>
      column.notNull().references('asset_tab.id').onDelete('cascade'),
    )
    .addColumn('block_id', 'uuid', (column) =>
      column.notNull().references('asset_tab_block.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('done', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`
    create index asset_tab_checklist_item_on_block_idx
      on asset_tab_checklist_item (block_id, position)
  `.execute(database);
}

/**
 * A working file and an hour logged can say which tab they were for.
 *
 * `set null` when the tab goes, so a deleted tab takes nobody's hours and no
 * file with it: they stay on the asset, untagged. The bin puts the tag back if
 * the tab comes back.
 */
async function tieFilesAndHoursToTabs(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('asset_file')
    .addColumn('tab_id', 'uuid', (column) => column.references('asset_tab.id').onDelete('set null'))
    .execute();

  await database.schema
    .alterTable('work_log')
    .addColumn('asset_tab_id', 'uuid', (column) =>
      column.references('asset_tab.id').onDelete('set null'),
    )
    .execute();

  // A tab belongs to an asset, so hours on a tab are hours on an asset. A card's
  // hours naming a tab would be counted by two things that know nothing of each
  // other.
  await sql`
    alter table work_log
      add constraint work_log_tab_is_on_an_asset
      check (asset_tab_id is null or asset_id is not null)
  `.execute(database);
}

/**
 * Every stage becomes a tab of the same name, done or not as it was, in the same
 * order. Same id too, so nothing that wrote one down is left pointing at nothing.
 */
async function stagesBecomeTabs(database: Kysely<unknown>): Promise<void> {
  await sql`
    insert into asset_tab (id, account_id, asset_id, title, done, position, created_at)
    select stage.id, asset.account_id, stage.asset_id, stage.title, stage.done,
           stage.position, stage.created_at
    from asset_subtask as stage
    join asset on asset.id = stage.asset_id
  `.execute(database);

  await database.schema.dropTable('asset_subtask').execute();
}

/**
 * Templates are their own permission, `asset.manageTemplate`, and every group
 * already says what it thinks of it: whatever it says about the library's
 * categories, which are the other half of how a project's library is set up.
 *
 * As `0062` did for linking: a group written before today would otherwise say
 * nothing, and nothing falls back to the role.
 */
async function letGroupsSpeakAboutTemplates(database: Kysely<unknown>): Promise<void> {
  await sql`
    insert into permission_rule (account_id, group_id, action, effect)
    select rule.account_id, rule.group_id, 'asset.manageTemplate', rule.effect
    from permission_rule as rule
    where rule.action = 'asset.manageCategory'
    on conflict (group_id, action) do nothing
  `.execute(database);
}

/**
 * Back to a status and a row of stages.
 *
 * Each tab becomes a stage again, and its blocks, its checklists and every
 * template go: the stages could only ever hold a title and a tick. A phase goes
 * back to the earliest status it covered, so nothing claims to be further along
 * than it was.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`delete from permission_rule where action = 'asset.manageTemplate'`.execute(database);

  await database.schema
    .createTable('asset_subtask')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('asset_id', 'uuid', (column) =>
      column.notNull().references('asset.id').onDelete('cascade'),
    )
    .addColumn('title', 'text', (column) => column.notNull())
    .addColumn('done', 'boolean', (column) => column.notNull().defaultTo(false))
    .addColumn('position', 'numeric', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await sql`create index asset_subtask_on_asset_idx on asset_subtask (asset_id, position)`.execute(
    database,
  );

  await sql`
    insert into asset_subtask (id, asset_id, title, done, position, created_at)
    select id, asset_id, title, done, position, created_at from asset_tab
  `.execute(database);

  await sql`alter table work_log drop constraint work_log_tab_is_on_an_asset`.execute(database);
  await database.schema.alterTable('work_log').dropColumn('asset_tab_id').execute();
  await database.schema.alterTable('asset_file').dropColumn('tab_id').execute();
  await database.schema.dropTable('asset_tab_checklist_item').execute();
  await database.schema.dropTable('asset_tab_block').execute();
  await database.schema.dropTable('asset_tab').execute();
  await database.schema.alterTable('asset_category').dropColumn('default_template_id').execute();
  await database.schema.dropTable('asset_template').execute();

  await sql`alter table asset drop constraint asset_phase_known`.execute(database);
  await sql`alter table asset rename column phase to status`.execute(database);

  await sql`
    update asset set status = case status
      when 'pre_dev' then 'concept'
      when 'dev' then 'wip'
      else 'approved'
    end
  `.execute(database);

  await sql`alter table asset alter column status set default 'concept'`.execute(database);
  await sql`
    alter table asset
      add constraint asset_status_known
      check (status in ('concept', 'wip', 'review', 'approved', 'final'))
  `.execute(database);
}
