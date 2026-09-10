import { sql, type Kysely } from 'kysely';

/**
 * A category holds categories, not only assets.
 *
 * One level of grouping is what a project outgrows first. A studio does not have
 * eight kinds of thing; it has three, each made of five — so the library filled
 * up with `Props — Interior`, `Props — Exterior`, `Props — Destructible`, where
 * the grouping lives in a naming convention nothing enforces, the budgets never
 * add up to a props budget, and the three sit next to each other only until
 * somebody drags one.
 *
 * `subcategory` was the same ask, admitted as a text box, and it is what this
 * replaces. Free text meant `Cloth`, `cloth` and `Cloths` were three different
 * things, nothing grouped by it, nothing counted it, and the library drew it as
 * grey text under a tile name. People were already filing two levels deep; the
 * product just did not know they were. Every value somebody typed becomes a real
 * category under the one it was typed in, so nobody's filing is thrown away.
 *
 * **Any depth.** A parent may itself have a parent, as far down as a studio
 * wants. The adjacency list carries it, the library assembles the tree, and the
 * only thing the database has to refuse is a category inside itself — which is
 * the move command's job, because it is the only thing that can create one.
 *
 * `on delete set null` is the safety net rather than the behaviour. Deleting a
 * category moves its children to where it sat, explicitly, in the same
 * transaction — but a subtree quietly deleted by a cascade would be the worst
 * thing this table could do, so the column is written to make that impossible
 * rather than merely unlikely.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('asset_category')
    .addColumn('parent_id', 'uuid', (column) =>
      column.references('asset_category.id').onDelete('set null'),
    )
    .execute();

  await renameIsUniqueAmongItsSiblings(database);
  await turnSubcategoriesIntoCategories(database);

  await database.schema.alterTable('asset').dropColumn('subcategory').execute();
}

/**
 * A name is unique where it sits, rather than across the whole project.
 *
 * The point of nesting is that `Weapons` under `Characters` and `Weapons` under
 * `Vehicles` are two different categories, so a project-wide constraint would
 * refuse the first thing anybody tries.
 *
 * `nulls not distinct` because top-level categories have no parent, and Postgres
 * treats two nulls as different by default — without it the constraint would
 * stop meaning anything for exactly the categories that had it before.
 */
async function renameIsUniqueAmongItsSiblings(database: Kysely<unknown>): Promise<void> {
  await sql`
    alter table asset_category
      drop constraint asset_category_name_unique_per_project
  `.execute(database);

  await sql`
    create unique index asset_category_name_unique_among_siblings
      on asset_category (project_id, parent_id, name)
      nulls not distinct
  `.execute(database);
}

/**
 * Every `subcategory` somebody typed becomes a category under the one it was
 * typed in, and the assets move into it.
 *
 * Trimmed and grouped, so `  cloth ` and `cloth` are one category rather than
 * two — which is the whole difference between a text box and a thing.
 *
 * The child takes its parent's colour. A category's colour is how the library is
 * read down the page, and a sub-category that arrived by conversion belongs to
 * the group it came out of; picking new colours here would be inventing a
 * decision nobody made.
 */
async function turnSubcategoriesIntoCategories(database: Kysely<unknown>): Promise<void> {
  await sql`
    with pairs as (
      select distinct
        asset.account_id,
        asset.project_id,
        asset.category_id,
        btrim(asset.subcategory) as name
      from asset
      where asset.subcategory is not null
        and btrim(asset.subcategory) <> ''
    ),
    made as (
      insert into asset_category (account_id, project_id, parent_id, name, color, position)
      select
        pairs.account_id,
        pairs.project_id,
        pairs.category_id,
        pairs.name,
        parent.color,
        row_number() over (partition by pairs.category_id order by pairs.name)
      from pairs
        join asset_category as parent on parent.id = pairs.category_id
      returning id, parent_id, name
    )
    update asset
    set category_id = made.id
    from made
    where made.parent_id = asset.category_id
      and btrim(asset.subcategory) = made.name
  `.execute(database);
}

/**
 * The tree is flattened back into the text box it came from.
 *
 * Every asset goes to the topmost category above it, carrying the name of the
 * one it was actually in as its `subcategory` — so a library one level deep, the
 * shape this migration converted, comes back exactly as it was. Deeper than that
 * loses the middle: there is one text box and it can hold one name.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await database.schema.alterTable('asset').addColumn('subcategory', 'text').execute();

  await sql`
    with recursive rooted as (
      select id, id as root_id, name
      from asset_category
      where parent_id is null
      union all
      select child.id, rooted.root_id, child.name
      from asset_category as child
        join rooted on child.parent_id = rooted.id
    )
    update asset
    set category_id = rooted.root_id,
        subcategory = rooted.name
    from rooted
    where rooted.id = asset.category_id
      and rooted.root_id <> asset.category_id
  `.execute(database);

  await sql`delete from asset_category where parent_id is not null`.execute(database);

  await sql`drop index asset_category_name_unique_among_siblings`.execute(database);

  await sql`
    alter table asset_category
      add constraint asset_category_name_unique_per_project unique (project_id, name)
  `.execute(database);

  await database.schema.alterTable('asset_category').dropColumn('parent_id').execute();
}
