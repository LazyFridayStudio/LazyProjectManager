import { writeFile } from 'node:fs/promises';

import type { Database } from '@lpm/database';

import { drainDomainEvents, type DomainEventConsumer } from '../outbox/index.js';
import { createSyncAttempts, syncDueProjects, type SyncAttempts } from '../modules/board/index.js';
import { purgeExpired } from '../modules/recovery/index.js';
import { ingestScmDeliveries } from '../modules/scm/index.js';

/**
 * The loop that keeps the promises nothing else is watching.
 *
 * Out of `worker.ts` and into a module of its own so it can be tested. The
 * entrypoint runs on import — it starts a worker — so nothing could reach the
 * loop to ask it what it does when a pass goes wrong, which is the question
 * that mattered and the one nobody had asked.
 */

/** Between sweeps of the bin. A week's grace does not need a fine clock. */
const PURGE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long to wait after a pass that threw.
 *
 * Longer than the poll, because whatever broke a pass is rarely fixed in half a
 * second: a database coming back, a migration landing, a store reachable again.
 * Short enough that the outbox drains promptly once it is.
 */
const DEFAULT_ERROR_PAUSE_MS = 5_000;

export interface OutboxLoop {
  readonly database: Database;
  readonly consumers: readonly DomainEventConsumer[];
  readonly pollIntervalMs: number;
  readonly heartbeatFile: string;
  /** The key a repository's private key was encrypted with, if this install has one. */
  readonly appSecret: string | undefined;
  /**
   * How the loop is asked to stop.
   *
   * The worker aborts this on `SIGTERM` and the loop returns after the pass in
   * flight, rather than being cut off part-way through one. Absent, it runs
   * until the process does.
   */
  readonly signal?: AbortSignal;
  readonly errorPauseMs?: number;
  /** Told about a pass that threw. The default writes it to stderr. */
  readonly onPassError?: (error: unknown) => void;
}

interface PassResult {
  readonly handledCount: number;
  readonly ingestedCount: number;
}

/**
 * One time round: read what has arrived, sync the repositories that are due,
 * empty the bin when it is time, drain what is waiting.
 */
async function runOnePass(
  loop: OutboxLoop,
  attempts: SyncAttempts,
  purge: { lastRunAt: number },
): Promise<PassResult> {
  const { database } = loop;

  // Deliveries first: reading one appends the events that tell an open card it
  // has changed, so doing it before the drain means they go out in the same
  // pass rather than waiting for the next.
  const ingestedCount = await ingestScmDeliveries({
    database,
    onDeliveryError: (deliveryId, error) => {
      const reason = error instanceof Error ? error.message : 'Unknown ingest error';
      process.stderr.write(`scm delivery ${deliveryId} could not be read: ${reason}\n`);
    },
  });

  /*
   * The issue sync, for every project whose own clock says it is due.
   *
   * Asked on every pass and almost always answers nothing: what is due is a
   * `where` clause, and a project that synced within its interval is not
   * selected.
   * Failures are logged and the connection is left alone for a few minutes, so
   * one repository nobody can reach does not fill the log.
   */
  await syncDueProjects({
    database,
    environment: { APP_SECRET: loop.appSecret },
    fetch,
    now: new Date(),
    attempts,
    onSyncError: (projectId, error) => {
      const reason = error instanceof Error ? error.message : 'Unknown sync error';
      process.stderr.write(`issues for project ${projectId} could not be synced: ${reason}\n`);
    },
  });

  await sweepTheBin(database, purge);

  const handledCount = await drainDomainEvents({
    database,
    consumers: loop.consumers,
    onConsumerError: (consumerName, event, error) => {
      const reason = error instanceof Error ? error.message : 'Unknown consumer error';
      process.stderr.write(
        `consumer ${consumerName} failed on event ${event.name} (${event.id}): ${reason}\n`,
      );
    },
  });

  return { handledCount, ingestedCount };
}

/**
 * Round and round until asked to stop, and a pass that throws is not the end.
 *
 * It used to be: a bare `for (;;)` of awaits, so the first throw anywhere in a
 * pass ended the loop for good. On a fresh database that was the first pass —
 * the worker starts beside the API, the API applies the migrations, and the
 * worker asked for a table that did not exist yet. It threw once and never
 * drained the outbox again, while staying up.
 *
 * Which is the shape of the thing rather than that one cause: a database
 * restarting, a store briefly unreachable, one bad row a consumer chokes on.
 * A worker exists to keep going, so a failed pass is reported, waited out, and
 * tried again.
 */
export async function runOutboxLoop(loop: OutboxLoop): Promise<void> {
  // Failures per connection, for the life of the worker: a repository that
  // refuses every request should be left alone for a while rather than asked
  // again on the next pass, which is twice a second.
  const attempts = createSyncAttempts();
  const purge = { lastRunAt: 0 };
  const errorPauseMs = loop.errorPauseMs ?? DEFAULT_ERROR_PAUSE_MS;
  const report = loop.onPassError ?? reportToStderr;

  /**
   * Whether the last pass got all the way round.
   *
   * What decides if the heartbeat is touched, and the reason the file means
   * anything. A loop going round and failing every time is not doing its job,
   * and a heartbeat touched regardless would report it as though it were.
   *
   * False to begin with, so a worker that has never once got round writes no
   * heartbeat at all — the healthcheck cannot stat a file that is not there, so
   * a boot that never worked is reported as a boot that never worked rather
   * than sailing through `--wait` on a file written before the first throw.
   */
  let lastPassFinished = false;

  while (loop.signal?.aborted !== true) {
    // At the top of a pass rather than the end, so the file's age is how long
    // the loop has been stuck rather than how long the work itself takes — a
    // pass that reconciles thirty projects is slow, not wedged. Which is also
    // why the first success is not written until the second pass starts, half a
    // second later: one write per pass, and the file still means what it says.
    if (lastPassFinished) {
      await writeHeartbeat(loop.heartbeatFile);
    }

    try {
      const { handledCount, ingestedCount } = await runOnePass(loop, attempts, purge);

      lastPassFinished = true;

      // Only sleep when there was nothing at all. A full batch means there is
      // more waiting, and pausing would let the backlog grow faster than it
      // drains.
      if (handledCount === 0 && ingestedCount === 0) {
        await sleep(loop.pollIntervalMs);
      }
    } catch (error) {
      lastPassFinished = false;
      report(error);
      await sleep(errorPauseMs);
    }
  }
}

function reportToStderr(error: unknown): void {
  const reason = error instanceof Error ? error.message : 'Unknown error';

  process.stderr.write(`outbox pass failed, trying again shortly: ${reason}\n`);
}

/**
 * Says the loop came round again.
 *
 * Failures are ignored on purpose: a worker that cannot write to /tmp should
 * carry on draining the outbox and be reported unhealthy, not stop.
 */
async function writeHeartbeat(path: string): Promise<void> {
  try {
    await writeFile(path, new Date().toISOString(), 'utf8');
  } catch {
    // Reported by the healthcheck, which is watching this file's age.
  }
}

/**
 * Throws away what is past its date, every few minutes.
 *
 * Paced rather than run on every pass: the loop comes round twice a second when
 * there is nothing to do, and a delete statement at that rate is a write lock
 * taken a hundred and seventy thousand times a day to find nothing.
 *
 * Here rather than on its own timer so the promise is kept by the process that
 * is already proving it is alive. A worker that has wedged stops purging, and
 * the heartbeat file is what says so.
 */
async function sweepTheBin(database: Database, purge: { lastRunAt: number }): Promise<void> {
  const now = Date.now();

  if (now - purge.lastRunAt < PURGE_INTERVAL_MS) {
    return;
  }

  // Stamped before rather than after, so a sweep that throws is not retried
  // twice a second for as long as whatever broke it lasts.
  purge.lastRunAt = now;

  await purgeExpired(database, new Date(now));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
