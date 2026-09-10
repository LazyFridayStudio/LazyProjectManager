import pg from 'pg';

/**
 * Teaches `pg` to hand back the two column types whose defaults lie.
 *
 * This runs once per process, when `create-database` is first imported. The
 * registry is global to `pg`, which is what makes the migration runner and the
 * test helpers see the same behaviour as the application pool.
 */

/** `date`. */
const DATE_OID = 1082;
/** `bigint`. */
const INT8_OID = 20;

let configured = false;

export function configureTypeParsers(): void {
  if (configured) {
    return;
  }

  configured = true;

  // A `date` is a calendar day with no time and no zone. The default parser
  // builds a Date at local midnight, so a ship date of the 1st read back as the
  // 31st for anyone west of the server. Keep the wire format: 'YYYY-MM-DD'.
  pg.types.setTypeParser(DATE_OID, (value: string) => value);

  // A `bigint` is returned as a string because not every 64-bit integer survives
  // a JavaScript number. Left alone deliberately; callers convert with
  // `readMinorUnits` where the range is known to be safe.
  pg.types.setTypeParser(INT8_OID, (value: string) => value);
}
