import { sql, type Kysely } from 'kysely';

/**
 * A tab, and an Overview, has one block of each kind.
 *
 * Two checklists on one tab were two places to look for whether the rig was
 * done, and two sets of notes were two places to write the brief. A block that
 * shows something the asset has was already one of a kind; now a checklist and
 * notes are too.
 *
 * Anything already doubled up is folded into the first of its kind rather than
 * thrown away: a second checklist's lines move onto the end of the first, and a
 * second set of notes is written under the first. Then the extra blocks go.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  // Which block each block folds into: the first of its kind in its place.
  await sql`
    create temporary table folding on commit drop as
    select block.id, first_value(block.id) over (
      partition by block.asset_id, block.tab_id, block.kind
      order by block.position, block.created_at, block.id
    ) as into_id
    from asset_tab_block as block
  `.execute(database);

  await sql`delete from folding where id = into_id`.execute(database);

  // A second checklist's lines go on after the first's, in their own order.
  await sql`
    update asset_tab_checklist_item as item
    set block_id = folding.into_id,
        position = item.position + 1000000 * (
          select count(*) from folding as earlier
          where earlier.into_id = folding.into_id and earlier.id <= folding.id
        )
    from folding
    where item.block_id = folding.id
  `.execute(database);

  // A second set of notes is written under the first, a blank line apart.
  await sql`
    update asset_tab_block as kept
    set body = concat_ws(e'\\n\\n', nullif(kept.body, ''), folded.bodies)
    from (
      select folding.into_id, string_agg(nullif(block.body, ''), e'\\n\\n' order by block.position) as bodies
      from folding
      join asset_tab_block as block on block.id = folding.id
      where block.kind = 'notes'
      group by folding.into_id
    ) as folded
    where kept.id = folded.into_id and folded.bodies is not null
  `.execute(database);

  await sql`
    delete from asset_tab_block where id in (select id from folding)
  `.execute(database);

  await sql`drop index asset_tab_block_one_view_per_tab`.execute(database);
  await sql`drop index asset_overview_one_view`.execute(database);

  await sql`
    create unique index asset_tab_block_one_of_each
      on asset_tab_block (tab_id, kind) where tab_id is not null
  `.execute(database);

  await sql`
    create unique index asset_overview_one_of_each
      on asset_tab_block (asset_id, kind) where tab_id is null
  `.execute(database);
}

/**
 * Back to as many notes and checklists as anybody likes. What was folded
 * together stays together: there is nothing left to say where one ended.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop index asset_overview_one_of_each`.execute(database);
  await sql`drop index asset_tab_block_one_of_each`.execute(database);

  await sql`
    create unique index asset_tab_block_one_view_per_tab
      on asset_tab_block (tab_id, kind) where kind in ('files', 'work')
  `.execute(database);

  await sql`
    create unique index asset_overview_one_view
      on asset_tab_block (asset_id, kind)
      where tab_id is null and kind not in ('notes', 'checklist')
  `.execute(database);
}
