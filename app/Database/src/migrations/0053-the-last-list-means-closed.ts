import { sql, type Kysely } from 'kysely';

/**
 * The board's own answer to what is finished, written down at last.
 *
 * `closed_at` has been on `card` since the beginning and no screen ever wrote
 * it, so every card on every install reads as open — including the ones that
 * have sat in Done for a year. That is why the sidebar badge only ever went up.
 *
 * The rule the product already had is the one applied here: **a card on the list
 * its board finishes on is closed.** The issue sync has read it that way from
 * the start — closing an issue moves the card, moving the card closes the issue
 * — and now `board.moveCard` writes the stamp to match. This brings the rows
 * that predate that into line, in both directions:
 *
 * - A card on the last list with no stamp gets one.
 * - A card anywhere else with a stamp loses it, because nothing could have set
 *   one honestly and a stray flag would outrank the column it sits in.
 *
 * The last list **by position among the lists that are not archived**, which is
 * the same reading `readBoardEnds` does. By position rather than by name, so a
 * studio that calls its last column Shipped is not left behind by a string
 * match.
 *
 * The stamp is `updated_at` rather than now: a card finished in March was not
 * finished the evening somebody upgraded, and a burndown reading otherwise
 * would show a year of work landing in one day.
 *
 * Migrations run on an untyped Kysely instance without the `CamelCasePlugin`, so
 * every identifier here is snake_case exactly as it lands in Postgres.
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    with finishing as (
      select distinct on (list.board_id)
        list.board_id,
        list.id as list_id
      from list
      where list.archived_at is null
      order by list.board_id, list.position desc
    )
    update card
    set closed_at = case
                      when card.list_id = finishing.list_id then card.updated_at
                    end
    from board
      join finishing on finishing.board_id = board.id
    where board.id = (
      select list.board_id from list where list.id = card.list_id
    )
      and (card.list_id = finishing.list_id) <> (card.closed_at is not null)
  `.execute(database);
}

/**
 * Every stamp goes.
 *
 * Not "the ones this put there", because there is no way to tell them apart
 * afterwards and guessing would leave a board half-closed. Nothing is lost that
 * running the migration again does not put straight back: which list a card is
 * on is the fact, and the stamp is only ever read off it.
 */
export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`update card set closed_at = null where closed_at is not null`.execute(database);
}
