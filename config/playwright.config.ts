import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { loadEnvFileWithoutOverriding } from '../scripts/load-env-file.js';
import { E2E_ORIGIN, readE2eServerEnvironment } from '../app/Client/e2e/e2e-environment.js';

/**
 * Written from the repository root, not from `config/` where this file sits.
 *
 * Playwright resolves `testDir`, `outputDir` and the web server's working
 * directory against the config file, so every one of them says so explicitly
 * rather than inheriting a root that is one directory too deep.
 */
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

loadEnvFileWithoutOverriding(fileURLToPath(new URL('../.env', import.meta.url)));

/**
 * End-to-end tests run against the product as it ships: the built API process
 * serving the built web client from one origin, backed by a real Postgres,
 * Redis and object store.
 *
 * That is the whole point of having them. Vitest already covers the modules in
 * isolation with a database behind them; what it cannot tell you is whether a
 * person can sign up, make a project and write on a card — which is the only
 * question this suite exists to answer. Anything under `e2e/` belongs here.
 */
export default defineConfig({
  testDir: '../app/Client/e2e',
  outputDir: '../.output/playwright',
  // Every test drives the same install through the same browser-visible state,
  // so they run in order rather than racing each other through one database.
  fullyParallel: false,
  workers: 1,
  /*
   * Never. Not even on CI, where this used to retry once to absorb runner
   * noise.
   *
   * A retry re-runs one test, and every test here is one step of a journey
   * through a database the steps before it have already changed. So the retry
   * of step one looks for the setup screen on an install that step one has
   * already set up, fails for that reason, and is reported as flaky — while the
   * step that actually broke, thirty tests later, is reported as "did not run".
   * The suite answers a question nobody asked and buries the one that matters.
   *
   * Which is also the rule `docs/Testing-Standards.md` already states: a test
   * that only passes on a retry is a broken test. There was nothing for the
   * retry to absorb.
   */
  retries: 0,
  reporter:
    process.env.CI === undefined
      ? 'list'
      : [['list'], ['html', { open: 'never', outputFolder: '../.output/playwright-report' }]],

  /*
   * Longer than the default thirty seconds, because of what an overrun costs
   * here.
   *
   * The journey is one serial describe sharing a single browser context, so a
   * test that runs out of time does not fail alone — Playwright tears the
   * context down and every test after it reports "target page, context or
   * browser has been closed", which reads like a browser fault rather than one
   * slow step. On a loaded CI runner the suite takes twice what it takes on a
   * developer machine, and that headroom is the difference between a red build
   * and a slow one.
   */
  timeout: 60_000,

  use: {
    baseURL: E2E_ORIGIN,
    /*
     * Kept whenever a test fails, rather than only on a retry.
     *
     * `on-first-retry` collects nothing where there are no retries, which is
     * every run on a developer machine. The suite has timed out twice on a
     * click, on two different tests, and both times the only record was the
     * error line — the trace that would have named the element and shown what
     * was over it was never written, because the run that failed was the only
     * run there was.
     */
    trace: 'retain-on-failure',
    /*
     * Shorter than the test, on purpose.
     *
     * With no action timeout an action may spend the whole test budget, and a
     * click that hangs then reports as `Test timeout of 60000ms exceeded` —
     * which says a test was slow and nothing about what it was waiting for.
     * Bounded, the same hang reports as Playwright's own account of it: the
     * element it was retrying, and whether it was invisible, unstable,
     * disabled, or covered by something else. That last one is the whole
     * question here.
     *
     * Long enough not to fire on a slow CI runner doing ordinary work — the
     * journey already waits explicitly, with its own timeouts, wherever it
     * expects to be kept waiting.
     */
    actionTimeout: 20_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /*
   * The worker runs beside the API for the length of a suite.
   *
   * It drains the outbox, which is what turns a command into the invalidation
   * frame a second tab hears, and what makes thumbnails. Without it the suite
   * cannot tell a product that keeps two tabs in step from one that does not.
   *
   * Started here rather than as a second `webServer` because Playwright decides
   * a server is up by asking a URL, and the worker does not listen on one.
   */
  globalSetup: fileURLToPath(new URL('../app/Client/e2e/global-setup.ts', import.meta.url)),
  globalTeardown: fileURLToPath(new URL('../app/Client/e2e/global-teardown.ts', import.meta.url)),

  webServer: {
    // The database is emptied here rather than in `globalSetup`, which
    // Playwright runs after the server is already up — and the server migrates
    // on the way up, so it has to find an empty database when it gets there.
    command: 'node scripts/reset-e2e-database.mjs && node app/Server/dist/index.js',
    // Both of those are repository-root paths, and Playwright would otherwise
    // run them from the directory this config is in.
    cwd: repositoryRoot,
    url: `${E2E_ORIGIN}/health`,
    env: readE2eServerEnvironment(),
    // Never reused: a server left running from a previous run is pointed at a
    // database this one has just dropped.
    reuseExistingServer: false,
    // It migrates an empty database on the way up.
    timeout: 120_000,
    // The API logs every request, which would bury the test output. Its stderr
    // is kept, because that is where a server that failed to start says why.
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
