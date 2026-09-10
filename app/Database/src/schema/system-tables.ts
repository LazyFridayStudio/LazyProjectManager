import type { ColumnType, Generated, JSONColumnType } from 'kysely';

type CreatedAt = ColumnType<Date, Date | undefined, never>;

/**
 * Idempotency ledger for commands.
 *
 * Every command carries a client-generated `commandId`. Inserting it here inside
 * the same transaction as the write means a retried request conflicts on the
 * primary key instead of applying twice.
 */
export interface CommandLogTable {
  commandId: string;
  name: string;
  actorId: string | null;
  createdAt: CreatedAt;
}

/**
 * The transactional outbox.
 *
 * A command appends its events here in the same transaction as the state change,
 * and the worker drains rows where `processedAt` is null. This buys the audit
 * trail, integrations and projections that event sourcing would offer, without
 * the replay and versioning machinery a 10k-row tracker will never repay.
 */
export interface DomainEventTable {
  /** UUIDv7, so the primary key sorts by time and the drain query stays ordered. */
  id: Generated<string>;
  accountId: string;
  aggregateType: string;
  aggregateId: string;
  name: string;
  payload: JSONColumnType<Record<string, unknown>>;
  actorId: string | null;
  occurredAt: CreatedAt;
  processedAt: Date | null;
}

/**
 * A thing that was deleted, kept whole for a week in case it should not have
 * been.
 *
 * The rows themselves, in the order they go back — parents before children,
 * because the foreign keys they carry are still real. Plus the repairs the
 * delete made to rows it did not delete, each recording what the column was and
 * what the delete left it as, so a restore can put it back only where nobody
 * has changed it since.
 */
export interface DeletedThingTable {
  id: Generated<string>;
  accountId: string;
  /** Which recipe puts it back: `team`, `milestone`, `projectDoc`. */
  kind: string;
  subjectId: string;
  /** Copied at the moment it went, because it is the only part anybody reads. */
  name: string;
  about: string | null;
  /** Null for the things that belong to the install rather than to a project. */
  projectId: string | null;
  rows: JSONColumnType<readonly BinnedRows[]>;
  repairs: JSONColumnType<readonly BinnedRepair[]>;
  /** Null once they have left. The deletion still happened. */
  deletedBy: string | null;
  deletedAt: CreatedAt;
  purgeAfter: Date;
}

/** Every row one table lost, in the order they were selected. */
export interface BinnedRows {
  readonly table: string;
  readonly rows: readonly Record<string, unknown>[];
}

/** One column on a surviving row that the delete changed. */
export interface BinnedRepair {
  readonly table: string;
  readonly id: string;
  readonly column: string;
  /** What it pointed at before. */
  readonly was: string;
  /** What the delete left it as. Only put back while it is still this. */
  readonly now: string | null;
}
