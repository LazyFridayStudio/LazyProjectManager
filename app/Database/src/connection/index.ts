export {
  createDatabase,
  measureDatabaseHealth,
  type Database,
  type DatabaseConnectionOptions,
  type DatabaseTransaction,
} from './create-database.js';

export { configureTypeParsers } from './configure-type-parsers.js';

/**
 * Re-exported so a handler that needs a raw fragment does not have to import
 * `kysely` itself. This package owns the query builder; keeping that true is
 * what lets it be swapped without touching every call site.
 *
 * Identifiers inside a fragment are passed through untouched by the
 * `CamelCasePlugin`, so they must already be snake_case.
 */
export { sql } from 'kysely';

export type { ExpressionBuilder, RawBuilder } from 'kysely';
