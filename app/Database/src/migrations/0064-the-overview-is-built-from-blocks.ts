import { sql, type Kysely } from 'kysely';

/**
 * An asset's Overview is built from blocks, the way its tabs are.
 *
 * It drew every section whether or not the asset had anything in it: a cost box
 * reading "Not estimated", "Nothing yet" under Files, empty links. Now it always
 * has a description, an assignee and a reporter — columns on the asset, never
 * blocks — and shows anything else only once somebody adds it.
 *
 * An Overview block is a row of `asset_tab_block` with no tab. Its kinds are a
 * tab's four and the sections only an asset has: its estimate, its list of
 * tabs, its tags, and the cards and assets it is linked to. Those carry nothing
 * of their own, so taking one off hides what it showed and putting it back
 * shows it again.
 *
 * Every asset that already has something gets the block that shows it, in the
 * order the Overview drew them, so nothing anybody filed disappears from the
 * panel the day this lands. An asset with nothing gets nothing.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`alter table asset_tab_block alter column tab_id drop not null`.execute(database);
  await sql`alter table asset_tab_checklist_item alter column tab_id drop not null`.execute(
    database,
  );

  await sql`alter table asset_tab_block drop constraint asset_tab_block_kind_known`.execute(
    database,
  );
  await sql`
    alter table asset_tab_block
      add constraint asset_tab_block_kind_known
      check (kind in ('notes', 'checklist', 'files', 'work', 'estimate', 'tabs', 'tags', 'cards', 'assets'))
  `.execute(database);

  // The asset's own sections are the Overview's. A tab is one job, and an
  // estimate or a list of links on it would be the whole asset's again.
  await sql`
    alter table asset_tab_block
      add constraint asset_tab_block_kind_fits_a_tab
      check (tab_id is null or kind in ('notes', 'checklist', 'files', 'work'))
  `.execute(database);

  // What the Overview shows of the asset, it shows once.
  await sql`
    create unique index asset_overview_one_view
      on asset_tab_block (asset_id, kind)
      where tab_id is null and kind not in ('notes', 'checklist')
  `.execute(database);

  await sql`
    create index asset_overview_block_idx on asset_tab_block (asset_id, position)
      where tab_id is null
  `.execute(database);

  await showWhatEachAssetHas(database);
}

/**
 * One block for each section an asset has something in, numbered in the order
 * the Overview drew them: estimate, tabs, tags, files, work, cards, assets.
 */
async function showWhatEachAssetHas(database: Kysely<unknown>): Promise<void> {
  const sections = [
    ['estimate', sql`asset.estimated_cost_minor is not null or asset.due_on is not null`],
    ['tabs', sql`exists (select 1 from asset_tab where asset_tab.asset_id = asset.id)`],
    ['tags', sql`exists (select 1 from asset_tag where asset_tag.asset_id = asset.id)`],
    ['files', sql`exists (select 1 from asset_file where asset_file.asset_id = asset.id)`],
    ['work', sql`exists (select 1 from work_log where work_log.asset_id = asset.id)`],
    [
      'cards',
      sql`exists (select 1 from card_asset_link where card_asset_link.asset_id = asset.id)`,
    ],
    [
      'assets',
      sql`exists (
        select 1 from asset_link
        where asset_link.first_asset_id = asset.id or asset_link.second_asset_id = asset.id
      )`,
    ],
  ] as const;

  for (const [index, [kind, has]] of sections.entries()) {
    await sql`
      insert into asset_tab_block (asset_id, tab_id, kind, body, position)
      select asset.id, null, ${kind}, null, ${index + 1}
      from asset
      where ${has}
    `.execute(database);
  }
}

/**
 * The Overview goes back to drawing every section, and its blocks go — notes
 * and checklists written on it included, which a tab could not have held.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`delete from asset_tab_block where tab_id is null`.execute(database);
  await sql`drop index asset_overview_block_idx`.execute(database);
  await sql`drop index asset_overview_one_view`.execute(database);
  await sql`alter table asset_tab_block drop constraint asset_tab_block_kind_fits_a_tab`.execute(
    database,
  );
  await sql`alter table asset_tab_block drop constraint asset_tab_block_kind_known`.execute(
    database,
  );
  await sql`
    alter table asset_tab_block
      add constraint asset_tab_block_kind_known
      check (kind in ('notes', 'checklist', 'files', 'work'))
  `.execute(database);
  await sql`alter table asset_tab_checklist_item alter column tab_id set not null`.execute(
    database,
  );
  await sql`alter table asset_tab_block alter column tab_id set not null`.execute(database);
}
