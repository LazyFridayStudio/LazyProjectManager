import { sql, type Kysely } from 'kysely';

/**
 * A card that gathers other cards.
 *
 * Work arrives in clumps and there was nowhere to put the clump. A pass over the
 * harbour set is nine bugs and four art tasks; today that is either a naming
 * convention typed into every title or sixty-six `relates` links nobody makes.
 * Neither is a thing the product knows about, so neither can be counted or
 * closed as a unit.
 *
 * Two columns rather than a join table, because a card has **one** legend. Two
 * parents makes "which one closes it" unanswerable and makes every count on the
 * board double.
 *
 * `is_legend` is separate from `legend_id` on purpose. Being a legend is a
 * statement about a card that is true before anything is under it — a producer
 * makes the legend first and fills it afterwards — and a legend with nothing in
 * it yet has to be findable to put the first card in.
 *
 * One level deep, enforced in the command rather than here: a legend may not sit
 * under a legend. Postgres cannot say that about two columns of the same row
 * without a trigger, and a trigger for a rule the only writer already checks is
 * a second place for it to be wrong.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await database.schema
    .alterTable('card')
    .addColumn('is_legend', 'boolean', (column) => column.notNull().defaultTo(false))
    .execute();

  // `set null` rather than `cascade`: the children are real work and the
  // grouping was the disposable half. Deleting the legend loses the clump, not
  // the cards in it.
  await database.schema
    .alterTable('card')
    .addColumn('legend_id', 'uuid', (column) => column.references('card.id').onDelete('set null'))
    .execute();

  await sql`
    alter table card
    add constraint card_legend_is_not_itself
    check (legend_id is null or legend_id <> id)
  `.execute(database);

  // Partial, because the overwhelming majority of cards are under no legend and
  // an index over a column of nulls is pages of nothing to walk.
  await sql`
    create index card_by_legend_idx
    on card (legend_id)
    where legend_id is not null
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists card_by_legend_idx`.execute(database);
  await sql`alter table card drop constraint if exists card_legend_is_not_itself`.execute(database);
  await database.schema.alterTable('card').dropColumn('legend_id').execute();
  await database.schema.alterTable('card').dropColumn('is_legend').execute();
}
