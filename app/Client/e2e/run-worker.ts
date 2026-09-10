import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readE2eServerEnvironment } from './e2e-environment.js';

/**
 * The worker, running beside the API for the length of a suite.
 *
 * Not a `webServer` entry, because Playwright decides a server is up by asking
 * a URL and the worker does not listen on one. A spawned child with a setup and
 * a teardown is the honest way to supervise a process that answers to nothing.
 *
 * It has to be here at all because the worker is what drains the outbox: it
 * turns domain events into the invalidation frames a second tab hears, and it
 * makes thumbnails. Without it the suite could not tell a product that keeps
 * two tabs in step from one that does not — which is exactly the kind of
 * question these tests exist to answer.
 */
let worker: ChildProcess | null = null;

export function startWorker(): void {
  worker = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../Server/dist/worker.js', import.meta.url))],
    {
      env: { ...process.env, ...readE2eServerEnvironment() },
      // Its log is the API's log: noisy, and already ignored by the reporter.
      stdio: 'ignore',
    },
  );
}

export function stopWorker(): void {
  worker?.kill();
  worker = null;
}
