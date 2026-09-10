import { existsSync, readFileSync } from 'node:fs';

const ASSIGNMENT = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/;

/**
 * Makes `.env` available to a test run without requiring a `--env-file` flag.
 *
 * Variables already in the environment always win, so CI — which supplies its
 * connection strings through the job definition and has no `.env` — is
 * unaffected. Without this, database-backed tests would fail on a developer
 * machine purely because the connection string lives in a file nobody told the
 * runner about.
 *
 * Shared by the Vitest and Playwright configs rather than copied into both: two
 * copies of a rule about where secrets come from is one copy too many.
 */
export function loadEnvFileWithoutOverriding(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = ASSIGNMENT.exec(line);

    if (match === null) {
      continue;
    }

    const [, name, value] = match;

    if (name === undefined || process.env[name] !== undefined) {
      continue;
    }

    process.env[name] = (value ?? '').replace(/^["']|["']$/g, '');
  }
}
