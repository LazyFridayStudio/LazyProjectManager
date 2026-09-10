import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { loadEnvFileWithoutOverriding } from '../scripts/load-env-file.js';

/**
 * Paths here are written from the repository root, not from `config/`.
 *
 * Vitest takes its root from wherever its config file sits, which since the
 * config moved is one directory too deep — so `root` says the repository
 * explicitly and every glob below goes on meaning what it says.
 */
const resolveFromRoot = (relativePath: string): string =>
  fileURLToPath(new URL(`../${relativePath}`, import.meta.url));

loadEnvFileWithoutOverriding(resolveFromRoot('.env'));

export default defineConfig({
  root: resolveFromRoot('.'),
  resolve: {
    /**
     * Tests run against workspace source, not built output, so `pnpm test` works
     * on a clean checkout without a build step first and a failure points at the
     * line you would edit rather than at a `.js` file in dist.
     */
    alias: {
      '@lpm/shared': resolveFromRoot('app/Shared/src/index.ts'),
      '@lpm/database/testing': resolveFromRoot('app/Database/src/testing/index.ts'),
      '@lpm/database': resolveFromRoot('app/Database/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['app/*/src/**/*.test.ts'],
    // Playwright owns end-to-end; Vitest must not try to run those specs.
    exclude: ['**/node_modules/**', '**/dist/**', 'app/Client/e2e/**'],
    clearMocks: true,
    // Drops the per-worker schemas afterwards. A leftover kysely_migration
    // table convinces a later `runMigrations` that setup is already done.
    globalSetup: [resolveFromRoot('app/Database/src/testing/vitest-global-setup.ts')],
    // Argon2 is deliberately slow, and each database-backed worker migrates a
    // schema before its first test.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: '.output/coverage',
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
      include: ['app/*/src/**/*.ts', 'app/Client/src/**/*.tsx'],
      exclude: [
        '**/*.test.ts',
        // Barrels re-export and hold no logic of their own.
        '**/index.ts',
        // Type declarations only.
        '**/schema/*-tables.ts',
        '**/database-schema.ts',
        '**/*.d.ts',
        // Process entrypoints: wiring, covered by the container healthcheck and
        // the end-to-end suite rather than by unit tests.
        'app/Server/src/index.ts',
        'app/Server/src/worker.ts',
        'app/Server/src/seed-demo-cli.ts',
        'app/Client/src/main.tsx',
        'app/Database/src/migrate-cli.ts',
        // The harness the tests themselves run on.
        'app/Database/src/testing/**',
        'app/Server/src/testing/**',
      ],
      /**
       * Per-package floors rather than one repository-wide number. A single
       * average lets a well-tested package hide a poorly-tested one, which is
       * exactly what a coverage gate exists to reveal.
       *
       * `app/Client` is absent on purpose: it is covered by Playwright against
       * real screens, and a line floor there would be satisfied by shallow
       * render tests that assert nothing a user would notice.
       */
      thresholds: {
        'app/Shared/src/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'app/Database/src/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
        'app/Server/src/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});
