import { createDatabase } from '@lpm/database';
import { z } from 'zod';

import { isDomainError } from './domain/index.js';
import { seedDemoProject } from './seed-demo/seed-demo-project.js';
import { ObjectStore } from './storage/index.js';

/**
 * Fills a set-up install with the demo studio, for looking at.
 *
 * Run by hand, never on boot. A fresh install has to come up empty — an install
 * that invented a project and five people the first time it started is one
 * nobody can trust to be theirs.
 *
 * Safe to run again: everything is looked up by name and left alone if it is
 * already there, so a demo can be topped up once a new screen exists without
 * disturbing anything somebody has since typed. It never deletes.
 *
 *   pnpm seed:demo
 */

/**
 * The database and the store, and nothing else.
 *
 * The API's own environment asks for a dozen settings it cannot start without —
 * a session secret, a public origin, a Redis address — and none of them mean
 * anything to a script that writes rows and objects and exits.
 */
const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

async function main(): Promise<void> {
  const environment = environmentSchema.parse(process.env);
  const database = createDatabase({
    connectionString: environment.DATABASE_URL,
    maxConnections: 2,
  });

  // The demo's pictures are written straight into the store, as the API writes a
  // thumbnail: they are files this server made rather than files anybody sent.
  const storage = new ObjectStore({
    endpoint: environment.S3_ENDPOINT,
    bucket: environment.S3_BUCKET,
    accessKey: environment.S3_ACCESS_KEY,
    secretKey: environment.S3_SECRET_KEY,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE,
  });

  try {
    await storage.ensureBucket();

    const result = await seedDemoProject(database, new Date(), storage);

    // Named counts of what this run added, so a top-up says what it topped up
    // rather than reporting the whole demo every time.
    const added = [
      [result.cardsCreated, 'cards'],
      [result.assetsCreated, 'assets'],
      [result.milestonesCreated, 'milestones'],
      [result.documentWords, 'words of design doc'],
      [result.releasesCreated, 'releases'],
      [result.peopleCreated, 'people'],
      [result.cardsGathered, 'cards under a legend'],
      [result.picturesCreated, 'pictures'],
      [result.teamsCreated, 'teams'],
      [result.permissionGroupsCreated, 'permission groups'],
    ] as const;

    const summary = added
      .filter(([count]) => count > 0)
      .map(([count, noun]) => `${String(count)} ${noun}`)
      .join(', ');

    process.stdout.write(
      `${summary === '' ? `${DEMO_LABEL} was already complete` : `Added to ${DEMO_LABEL}: ${summary}`}.\n` +
        `Open /p/${result.slug}\n`,
    );
  } finally {
    await database.destroy();
  }
}

const DEMO_LABEL = 'the demo project';

main().catch((error: unknown) => {
  // A refusal — no install yet, or the project already exists — is a message for
  // a person, not a stack trace.
  const message = isDomainError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : 'Unknown error';

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
