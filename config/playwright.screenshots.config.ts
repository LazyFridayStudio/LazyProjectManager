import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { loadEnvFileWithoutOverriding } from '../scripts/load-env-file.js';
import { E2E_ORIGIN, readE2eServerEnvironment } from '../app/Client/e2e/e2e-environment.js';

/** Written from the repository root, as `playwright.config.ts` beside it is. */
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

loadEnvFileWithoutOverriding(fileURLToPath(new URL('../.env', import.meta.url)));

/**
 * The pictures in the readme, taken by a machine.
 *
 * A separate configuration rather than a spec under `e2e/`, because this is not
 * a test. The suite beside it is one serial journey that asserts what a person
 * can do; this asserts nothing and produces files. Putting a generator in that
 * run would mean a red build for a screenshot that came out wrong, and a suite
 * whose passing no longer means only one thing.
 *
 * It borrows that suite's install wholesale, though, and deliberately: the same
 * reset, the same environment, the same worker. The readme used to carry the
 * instructions for doing this by hand — four comments saying which screen to
 * capture and where to save it — and after however many months it still had
 * four comments and no pictures. A procedure nobody runs is not a procedure.
 *
 *   pnpm screenshots
 */
export default defineConfig({
  testDir: '../app/Client/screenshots',
  outputDir: '../.output/playwright-screenshots',
  // One install, set up once and then filled with the demo. The shots are steps
  // through it in order, not independent cases.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  /*
   * Longer than the suite's, because seeding is in here.
   *
   * `seed:demo` writes a studio, five people, a library and the art for all of
   * it through the object store, which on a cold MinIO takes a good deal longer
   * than any single thing the journey does.
   */
  timeout: 180_000,

  use: {
    baseURL: E2E_ORIGIN,
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    /*
     * Wide enough that the board shows real columns rather than a phone's worth
     * of one, and scaled 1:1.
     *
     * GitHub renders a readme in a column about 830px across, so an image twice
     * that is drawn at two device pixels per CSS pixel on any screen worth
     * having — which is the same crispness `deviceScaleFactor: 2` would buy at
     * four times the file size.
     */
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  globalSetup: fileURLToPath(new URL('../app/Client/e2e/global-setup.ts', import.meta.url)),
  globalTeardown: fileURLToPath(new URL('../app/Client/e2e/global-teardown.ts', import.meta.url)),

  webServer: {
    command: 'node scripts/reset-e2e-database.mjs && node app/Server/dist/index.js',
    cwd: repositoryRoot,
    url: `${E2E_ORIGIN}/health`,
    env: readE2eServerEnvironment(),
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
