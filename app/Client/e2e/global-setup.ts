import { startWorker } from './run-worker.js';

/**
 * Runs once, after the API is up and before the first test.
 *
 * Playwright starts `webServer` before this, which is why the database reset
 * lives in the server's own start command — by the time this runs, the schema
 * is already there and the worker has something to drain.
 */
export default function globalSetup(): void {
  startWorker();
}
