import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getMigrationNames, migrationProvider } from './index.js';
import { rollbackLastMigration, runMigrations } from './run-migrations.js';

const TEST_DATABASE_NAME = 'lpm_migration_test';

const BASE_URL = process.env.DATABASE_URL ?? 'postgres://lpm:lpm@localhost:5432/lpm';

/**
 * A whole database rather than a schema.
 *
 * `runMigrations` opens its own connection and lets Kysely put its bookkeeping
 * table wherever the search path points. Testing against a schema meant the
 * migrator found the `kysely_migration` table in `public`, decided everything
 * was already applied, and did nothing — so the test proved nothing. A separate
 * database exercises the function exactly as production calls it.
 */
function urlForDatabase(databaseName: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withMaintenanceConnection(
  run: (database: Kysely<unknown>) => Promise<void>,
): Promise<void> {
  const maintenance = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: urlForDatabase('postgres'), max: 1 }),
    }),
  });

  try {
    await run(maintenance);
  } finally {
    await maintenance.destroy();
  }
}

async function tableNames(): Promise<string[]> {
  const database = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: urlForDatabase(TEST_DATABASE_NAME), max: 1 }),
    }),
  });

  try {
    const result = await sql<{ table_name: string }>`
      select table_name from information_schema.tables where table_schema = 'public'
    `.execute(database);
    return result.rows.map((row) => row.table_name);
  } finally {
    await database.destroy();
  }
}

async function columnNames(tableName: string): Promise<string[]> {
  const database = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: urlForDatabase(TEST_DATABASE_NAME), max: 1 }),
    }),
  });

  try {
    const result = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${tableName}
    `.execute(database);
    return result.rows.map((row) => row.column_name);
  } finally {
    await database.destroy();
  }
}

/** What a check constraint actually checks, as Postgres holds it. */
async function checkConstraint(constraintName: string): Promise<string> {
  const database = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: urlForDatabase(TEST_DATABASE_NAME), max: 1 }),
    }),
  });

  try {
    const result = await sql<{ definition: string }>`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint where conname = ${constraintName}
    `.execute(database);
    return result.rows[0]?.definition ?? '';
  } finally {
    await database.destroy();
  }
}

/** How an index is defined, as Postgres holds it. */
async function indexDefinition(indexName: string): Promise<string> {
  const database = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: urlForDatabase(TEST_DATABASE_NAME), max: 1 }),
    }),
  });

  try {
    const result = await sql<{ definition: string }>`
      select indexdef as definition from pg_indexes where indexname = ${indexName}
    `.execute(database);
    return result.rows[0]?.definition ?? '';
  } finally {
    await database.destroy();
  }
}

const ACCOUNT = '00000000-0000-4000-8000-00000000ac01';
const PROJECT = '00000000-0000-4000-8000-00000000d001';
const CATEGORY = '00000000-0000-4000-8000-00000000ca01';

/** A connection to the migrated database, closed however the work goes. */
async function withTestDatabase(run: (database: Kysely<unknown>) => Promise<void>): Promise<void> {
  const database = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: urlForDatabase(TEST_DATABASE_NAME), max: 1 }),
    }),
  });

  try {
    await run(database);
  } finally {
    await database.destroy();
  }
}

describe('GIVEN the migration set', () => {
  beforeAll(async () => {
    await withMaintenanceConnection(async (maintenance) => {
      await sql.raw(`drop database if exists ${TEST_DATABASE_NAME}`).execute(maintenance);
      await sql.raw(`create database ${TEST_DATABASE_NAME}`).execute(maintenance);
    });
  });

  afterAll(async () => {
    await withMaintenanceConnection(async (maintenance) => {
      await sql.raw(`drop database if exists ${TEST_DATABASE_NAME}`).execute(maintenance);
    });
  });

  describe('WHEN the registry is read', () => {
    it('THEN it lists the migrations in order', async () => {
      const names = getMigrationNames();
      const provided = Object.keys(await migrationProvider.getMigrations());

      expect(names).toEqual([
        '0001-initial-schema',
        '0002-projects',
        '0003-board',
        '0004-wip-advisory',
        '0005-card-activity',
        '0006-files',
        '0007-thumbnails',
        '0008-scm',
        '0009-scm-links',
        '0010-assets',
        '0011-card-asset-links',
        '0012-asset-key-art',
        '0013-asset-references',
        '0014-asset-files',
        '0015-asset-tags',
        '0016-asset-keys',
        '0017-scm-app-access',
        '0018-member-capacity',
        '0019-design-doc',
        '0020-milestones',
        '0021-one-design-document',
        '0022-many-design-documents',
        '0023-who-wrote-it-last',
        '0024-releases',
        '0025-synced-releases',
        '0026-build-runs',
        '0027-no-lfs-links',
        '0028-issue-cards',
        '0029-teams',
        '0030-team-access',
        '0031-no-build-runs',
        '0032-legend-cards',
        '0033-permission-groups',
        '0034-rules-name-one-action',
        '0035-no-team-grants',
        '0036-a-week-to-change-your-mind',
        '0037-the-install-owner',
        '0038-a-deleted-card-stays-deleted',
        '0039-no-portfolios',
        '0040-people-hold-groups',
        '0041-permissions-in-an-order',
        '0042-everybody-has-a-whole-day',
        '0043-a-project-has-a-logo',
        '0044-a-team-can-be-on-a-project',
        '0045-a-person-has-a-picture',
        '0046-somebody-was-named',
        '0047-work-that-was-done',
        '0048-a-theme-of-your-own',
        '0049-an-agent-is-somebody',
        '0050-an-asset-was-asked-for',
        '0051-an-asset-is-made-in-stages',
        '0052-a-download-says-where-it-is',
        '0053-the-last-list-means-closed',
        '0054-sections-a-project-does-not-use',
        '0055-a-delivery-makes-the-sync-due',
        '0056-sync-only-the-open-issues',
        '0057-a-theme-you-write-yourself',
        '0058-how-often-a-repository-syncs',
        '0059-one-sync-at-a-time',
        '0060-a-category-inside-a-category',
        '0061-a-name-can-wait-for-the-end-of-a-command',
      ]);
      expect(provided).toEqual(names);
    });

    it('THEN the provider hands out a fresh object, so a caller cannot mutate the registry', async () => {
      const first = await migrationProvider.getMigrations();
      delete first['0001-initial-schema'];

      const second = await migrationProvider.getMigrations();

      expect(Object.keys(second)).toEqual([
        '0001-initial-schema',
        '0002-projects',
        '0003-board',
        '0004-wip-advisory',
        '0005-card-activity',
        '0006-files',
        '0007-thumbnails',
        '0008-scm',
        '0009-scm-links',
        '0010-assets',
        '0011-card-asset-links',
        '0012-asset-key-art',
        '0013-asset-references',
        '0014-asset-files',
        '0015-asset-tags',
        '0016-asset-keys',
        '0017-scm-app-access',
        '0018-member-capacity',
        '0019-design-doc',
        '0020-milestones',
        '0021-one-design-document',
        '0022-many-design-documents',
        '0023-who-wrote-it-last',
        '0024-releases',
        '0025-synced-releases',
        '0026-build-runs',
        '0027-no-lfs-links',
        '0028-issue-cards',
        '0029-teams',
        '0030-team-access',
        '0031-no-build-runs',
        '0032-legend-cards',
        '0033-permission-groups',
        '0034-rules-name-one-action',
        '0035-no-team-grants',
        '0036-a-week-to-change-your-mind',
        '0037-the-install-owner',
        '0038-a-deleted-card-stays-deleted',
        '0039-no-portfolios',
        '0040-people-hold-groups',
        '0041-permissions-in-an-order',
        '0042-everybody-has-a-whole-day',
        '0043-a-project-has-a-logo',
        '0044-a-team-can-be-on-a-project',
        '0045-a-person-has-a-picture',
        '0046-somebody-was-named',
        '0047-work-that-was-done',
        '0048-a-theme-of-your-own',
        '0049-an-agent-is-somebody',
        '0050-an-asset-was-asked-for',
        '0051-an-asset-is-made-in-stages',
        '0052-a-download-says-where-it-is',
        '0053-the-last-list-means-closed',
        '0054-sections-a-project-does-not-use',
        '0055-a-delivery-makes-the-sync-due',
        '0056-sync-only-the-open-issues',
        '0057-a-theme-you-write-yourself',
        '0058-how-often-a-repository-syncs',
        '0059-one-sync-at-a-time',
        '0060-a-category-inside-a-category',
        '0061-a-name-can-wait-for-the-end-of-a-command',
      ]);
    });
  });

  describe('WHEN they are applied to an empty database', () => {
    it('THEN every table is created', async () => {
      const { error, results } = await runMigrations(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(results?.map((result) => result.status)).toEqual(
        Array.from({ length: getMigrationNames().length }, () => 'Success'),
      );
      expect(await tableNames()).toEqual(
        expect.arrayContaining([
          'account',
          'app_user',
          'membership',
          'team',
          'team_member',
          'session',
          'install_settings',
          'command_log',
          'domain_event',
          'project',
          'project_member',
          'project_team',
          'card_sequence',
          'board',
          'list',
          'card',
          'subtask',
          'comment',
          'card_link',
          'file',
          'card_attachment',
          'scm_connection',
          'scm_event_raw',
          'scm_link',
          'asset_category',
          'asset',
          'asset_reference',
          'asset_file',
          'asset_tag',
          'asset_subtask',
          'asset_sequence',
          'card_asset_link',
          'project_doc',
          'milestone',
          'project_release',
          'release_asset',
          'permission_group',
          'permission_rule',
          'team_permission_group',
          'user_permission_group',
          'dismissed_issue',
        ]),
      );
    });

    it('THEN a link can only be one of the three kinds a delivery carries', async () => {
      // The fourth was `lfs_object`, which needed a repository read per path a
      // push touched to fill in, and named a file nobody could open from here.
      expect(await checkConstraint('scm_link_kind_known')).not.toContain('lfs_object');
    });

    it('THEN two sibling categories may share a name until the command that asked ends', async () => {
      const definition = await checkConstraint('asset_category_name_unique_among_siblings');

      // Deferrable, so deleting a `Props` can bring a `Props` up out of it before
      // the parent has gone — and only when a command asks, so every other write
      // is still checked as it happens.
      expect(definition).toContain('DEFERRABLE');
      expect(definition).not.toContain('INITIALLY DEFERRED');
    });

    it('THEN applying them again is a no-op, so a restart is safe', async () => {
      const { error, results } = await runMigrations(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(results).toEqual([]);
    });
  });

  describe('WHEN migrations are rolled back one at a time', () => {
    it('THEN a category name is checked at every row again', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await checkConstraint('asset_category_name_unique_among_siblings')).toBe('');
      // Still unique among siblings: what goes is only the ability to wait.
      expect(await indexDefinition('asset_category_name_unique_among_siblings')).toContain(
        'NULLS NOT DISTINCT',
      );
    });

    it('THEN a category cannot hold a category, and the text box is back', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('asset_category')).not.toContain('parent_id');
      // The free-text field the tree replaced, and what a flattened library
      // writes the name it came out of back into.
      expect(await columnNames('asset')).toContain('subcategory');
      // Unique across the project again, which is what a library with one level
      // can promise.
      expect(await checkConstraint('asset_category_name_unique_per_project')).not.toBe('');
    });

    it('THEN nothing records what a sync is doing or how the last one went', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('scm_connection')).not.toContain('syncing_since');
      expect(await columnNames('scm_connection')).not.toContain('sync_failed_at');
      expect(await columnNames('scm_connection')).not.toContain('sync_failure');
      // When a sync last worked survives: it is what the header reads.
      expect(await columnNames('scm_connection')).toContain('issues_synced_at');
    });

    it('THEN the clock is half an hour for everybody again', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('project')).not.toContain('sync_every_seconds');
      // The setting beside it stays: they are two different decisions about a
      // sync, and only one of them is going.
      expect(await columnNames('project')).toContain('sync_open_issues_only');
    });

    it('THEN there are two themes again, and nobody is left on a third', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('app_user')).not.toContain('theme_colors');
      // The constraint is addable again only because anybody on `custom` was
      // moved to dark first, which is where everybody was before any of this.
      expect(await checkConstraint('app_user_theme_is_known')).not.toContain('custom');
    });

    it('THEN every sync reads the whole issue list again', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('project')).not.toContain('sync_open_issues_only');
      // Cards it kept off a board were never made, so the next sync makes them.
      expect(await columnNames('project')).toContain('disabled_sections');
    });

    it('THEN the sweep is back to the clock alone, and still knows when it last ran', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('scm_connection')).not.toContain('forge_spoke_at');
      // The other half of the pair stays: it is what the header reads to say
      // when the board last looked.
      expect(await columnNames('scm_connection')).toContain('issues_synced_at');
    });

    it('THEN every project has all eight sections again', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('project')).not.toContain('disabled_sections');
      // Turning a section off never deleted anything, so there is nothing here
      // that going back could lose.
      expect(await tableNames()).toEqual(expect.arrayContaining(['card', 'asset', 'milestone']));
    });

    it('THEN no card claims to be finished, and every card keeps its list', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      // The stamp is derived from the column a card sits in, so dropping every
      // stamp loses nothing: the list is still there to read it back off.
      expect(await columnNames('card')).toContain('closed_at');
      expect(await columnNames('card')).toContain('list_id');
    });

    it('THEN a download forgets where it is, and still says what it is', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('release_asset')).not.toContain('download_url');
      // What the row was before the link: still a named file with a size.
      expect(await columnNames('release_asset')).toContain('name');
      expect(await columnNames('release_asset')).toContain('size_bytes');
    });

    it('THEN an asset is one job again, and its status is all it can say', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await tableNames()).not.toEqual(expect.arrayContaining(['asset_subtask']));
      // The stages were the only thing that held them, so they really are gone.
      // What the asset always said about itself is untouched.
      expect(await columnNames('asset')).toContain('status');
    });

    it('THEN nobody asked for an asset, and everybody is still making one', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('asset')).not.toContain('reporter_id');
      // Who is making a thing is a different column and is untouched: the two
      // were separate questions about an asset before this step and after it.
      expect(await columnNames('asset')).toContain('assignee_id');
    });

    it('THEN the keys go and every agent becomes a person again', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await tableNames()).not.toEqual(expect.arrayContaining(['api_token']));
      expect(await columnNames('app_user')).not.toContain('kind');
      // Nothing an agent did goes with it: its comments, its cards and its lines
      // in the trail are a user's like anybody else's.
      expect(await tableNames()).toEqual(expect.arrayContaining(['comment', 'domain_event']));
    });

    it('THEN nobody has a theme of their own, and everybody is back on dark', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('app_user')).not.toContain('theme');
      // Nothing else about a person goes with it: their picture, their letters
      // and their name are separate columns and are untouched.
      expect(await columnNames('app_user')).toContain('avatar_file_id');
    });

    it('THEN the hours anybody logged go, and the estimates do not', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['work_log']));
      // What a card was expected to take is a column on the card and is
      // untouched. What it actually took is what this throws away, and it is
      // the one rollback in the set that loses something nobody can work out
      // again.
      expect(await columnNames('card')).toContain('estimate_minutes');
    });

    it('THEN nothing is waiting for anybody, and every comment still says it', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['comment_mention']));
      // What was said is untouched: a mention is a run of text inside the
      // comment, and only the knowledge of which were unread goes.
      expect(remaining).toEqual(expect.arrayContaining(['comment']));
    });

    it('THEN nobody has a picture, and the column that never held one comes back', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('app_user')).not.toContain('avatar_file_id');
      // The text column returns empty, which is the state it was in on every
      // install: nothing ever wrote it.
      expect(await columnNames('app_user')).toContain('avatar_url');
    });

    it('THEN no team is on any project, and everybody reached that way has to be named', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['project_team']));
      // Which narrows access rather than widening it, and leaves both ends of
      // what it joined exactly where they were.
      expect(remaining).toEqual(expect.arrayContaining(['team', 'project_member']));
    });

    it('THEN a project has nowhere to keep a logo', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();

      // The picture itself stays in the store, as every file a project stops
      // pointing at does. It is the pointer that goes.
      expect(await columnNames('project')).not.toContain('logo_file_id');
      expect(await columnNames('project')).toContain('key_art_file_id');
    });

    it('THEN nobody gets their old hours back, because they were not kept', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();

      // The step wrote a number over a number and had nowhere to put the ones
      // it replaced, so rolling back leaves the column exactly where it stands.
      expect(await columnNames('project_member')).toContain('daily_capacity_hours');
    });

    it('THEN a team’s permissions lose the order somebody put them in', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();

      // Which costs nobody anything they may do: the order was how the panel
      // read, never what it decided.
      expect(await columnNames('team_permission_group')).not.toContain('position');
      expect(await columnNames('team_permission_group')).toContain('group_id');
    });

    it('THEN a group can no longer be given to a person', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();

      // Which costs nobody their access: a group held by a person only ever
      // widened what their role already allowed, so rolling back leaves the
      // role deciding again — the state it was in before this ran.
      expect(await tableNames()).not.toEqual(expect.arrayContaining(['user_permission_group']));
      expect(await tableNames()).toEqual(expect.arrayContaining(['team_permission_group']));
    });

    it('THEN portfolios come back, empty, and projects can be filed again', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();

      // The shape returns and what was filed under it does not. That went with
      // the table on the way forward, and inventing a filing nobody chose would
      // be worse than admitting it is gone.
      expect(await tableNames()).toEqual(expect.arrayContaining(['portfolio']));
      expect(await columnNames('project')).toContain('portfolio_id');
    });

    it('THEN the board forgets which issues it turned down', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();

      // Which is not a loss: a build without the table is a build whose sync
      // would put those cards back anyway.
      expect(await tableNames()).not.toEqual(expect.arrayContaining(['dismissed_issue']));
    });

    it('THEN the install stops naming who owns it', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('install_settings')).not.toContain('owner_user_id');

      // Rolling forward finds them again: the backfill picks the earliest
      // owner, which is the person setup made.
      expect(await columnNames('install_settings')).toContain('server_name');
    });

    it('THEN the bin goes with the step that made it', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();

      // What was in it goes too, which is the honest thing for a rollback of a
      // table whose whole content is copies of rows that no longer exist.
      expect(await tableNames()).not.toEqual(expect.arrayContaining(['deleted_thing']));
    });

    it('THEN a team can be granted a project again, with nothing in the table', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await tableNames()).toEqual(expect.arrayContaining(['team_grant']));
      expect(await columnNames('team')).toContain('default_level');

      // The shape comes back and the sentences do not: nothing was left holding
      // "this team, this portfolio, read" to read them from.
      expect(await columnNames('portfolio')).toContain('name');
    });

    it('THEN rolling back the rule expansion leaves the rules alone', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      // Deliberately nothing to put back: seven rows that each say what they
      // mean cannot be folded into one word without deciding which of them the
      // word covered, and by then somebody may have changed three of them.
      expect(error).toBeUndefined();
      expect(await tableNames()).toEqual(expect.arrayContaining(['permission_rule']));
    });

    it('THEN the permission groups go with the step that made them', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(
        expect.arrayContaining(['permission_group', 'permission_rule', 'team_permission_group']),
      );
      // What a team may do goes; the team, and where it reaches, stay.
      expect(remaining).toEqual(expect.arrayContaining(['team', 'team_grant']));
    });

    it('THEN a card stops gathering others, and keeps everything else', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('card')).not.toContain('is_legend');
      expect(await columnNames('card')).not.toContain('legend_id');
      // The cards themselves were never the grouping.
      expect(await columnNames('card')).toContain('title');
    });

    it('THEN the build history comes back with the step that dropped it', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      // The step that dropped them puts them back by calling the step that made
      // them, so this is also the check that the two have not drifted.
      expect(await tableNames()).toEqual(
        expect.arrayContaining(['build_run', 'build_step', 'build_artifact']),
      );
    });

    it('THEN what a team can reach goes, and the teams themselves stay', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['team_grant', 'portfolio']));
      expect(await columnNames('team')).not.toContain('default_level');
      expect(await columnNames('project')).not.toContain('portfolio_id');
      // Rolling back is one step, not a reset: the teams are the step before.
      expect(remaining).toEqual(expect.arrayContaining(['team', 'team_member']));
    });

    it('THEN the teams go with the step that made them, and the people stay', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['team', 'team_member']));
      // A team is a grouping of people, not the people.
      expect(remaining).toEqual(expect.arrayContaining(['app_user', 'membership']));
    });

    it('THEN a card stops knowing which issue it came from, and keeps what it says', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('card')).not.toContain('source');
      expect(await columnNames('card')).not.toContain('external_id');
      expect(await columnNames('scm_connection')).not.toContain('issues_synced_at');
      // Where it came from is worth less than what is written on it.
      expect(await columnNames('card')).toContain('title');
    });

    it('THEN the kind of link that stood for a large file is allowed again', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      // The constraint comes back; the rows it refused do not. They were read
      // from deliveries that are still in `scm_event_raw` either way.
      expect(await checkConstraint('scm_link_kind_known')).toContain('lfs_object');
    });

    it('THEN the build history goes with the step that made it', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(
        expect.arrayContaining(['build_run', 'build_step', 'build_artifact']),
      );
      // What the project shipped is a different thing from how it was built.
      expect(remaining).toEqual(expect.arrayContaining(['project_release']));
    });

    it('THEN a release keeps its prose when it stops knowing where it came from', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('project_release')).not.toContain('source');
      expect(await columnNames('project_release')).not.toContain('external_id');
      expect(await columnNames('scm_connection')).not.toContain('releases_synced_at');
      // Where it came from is worth less than what it says.
      expect(await columnNames('project_release')).toContain('notes');
    });

    it('THEN the releases go with the step that made them', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['project_release', 'release_asset']));
      // The project that shipped them is untouched.
      expect(remaining).toEqual(expect.arrayContaining(['project']));
    });

    it('THEN a document keeps its prose when the name of its author is taken off', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('project_doc')).not.toContain('updated_by');
      // Who last wrote it is worth less than what they wrote.
      expect(await columnNames('project_doc')).toContain('body');
    });

    it('THEN a project keeping several documents goes back to keeping one', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      // The table stays; what goes is a document's name and its place in the
      // row of tabs, which is what having more than one needed.
      expect(await columnNames('project_doc')).not.toContain('title');
      expect(await columnNames('project_doc')).toContain('body');
    });

    it('THEN the one design document goes back to being chapters of sections', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['project_doc']));
      expect(remaining).toEqual(expect.arrayContaining(['doc_chapter', 'doc_section']));
    });

    it('THEN a card survives losing the milestone it was promised for', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['milestone']));
      expect(await columnNames('card')).not.toContain('milestone_id');
      // The work was never the milestone's to take with it.
      expect(remaining).toEqual(expect.arrayContaining(['card']));
    });

    it('THEN the design document goes with the step that made it', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['doc_chapter', 'doc_section']));
      // The project it was written about is untouched.
      expect(remaining).toEqual(expect.arrayContaining(['project']));
    });

    it('THEN a member keeps their role when their capacity is taken away', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('project_member')).not.toContain('daily_capacity_hours');
      // Being on a project is what the table is for; how many hours a day is an
      // answer the timeline wanted, and the row survives without it.
      expect(await columnNames('project_member')).toContain('role');
    });

    it('THEN the credentials for reading a repository go with the step that added them', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('scm_connection')).not.toContain('app_id');
      // The webhook is untouched: reading the repository was always the
      // optional half.
      expect(await columnNames('scm_connection')).toContain('webhook_secret_enc');
    });

    it('THEN the asset keys go with the step that made them', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['asset_sequence']));
      expect(await columnNames('asset')).not.toContain('asset_key');
      expect(remaining).toEqual(expect.arrayContaining(['asset_tag', 'asset']));
    });

    it('THEN the tags go with the step that made them', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['asset_tag']));
      expect(remaining).toEqual(expect.arrayContaining(['asset_file', 'asset']));
    });

    it('THEN the working files go with the step that made them', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['asset_file']));
      // Rolling back is one step, not a reset: the pictures are a different one.
      expect(remaining).toEqual(expect.arrayContaining(['asset_reference', 'asset']));
    });

    it('THEN the sheet of reference images goes, and the one picture comes back', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['asset_reference']));
      // The column it replaced is put back, so the step before this one still
      // has something to drop.
      expect(await columnNames('asset')).toContain('key_art_file_id');
      // Rolling back is one step, not a reset: everything before it survives.
      expect(remaining).toEqual(expect.arrayContaining(['card_asset_link', 'asset', 'card']));
    });

    it('THEN the one picture goes with the step that added it', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(await columnNames('asset')).not.toContain('key_art_file_id');
      expect(remaining).toEqual(expect.arrayContaining(['card_asset_link', 'asset', 'card']));
    });

    it('THEN the link between a card and an asset goes with its own step', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['card_asset_link']));
      expect(remaining).toEqual(expect.arrayContaining(['asset', 'account', 'card']));
    });

    it('THEN the library goes with the step that made it', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['asset', 'asset_category']));
      expect(remaining).toEqual(expect.arrayContaining(['scm_link', 'account', 'card']));
    });

    it('THEN the repository links go with the step that made them', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['scm_link']));
      // Rolling back is one step, not a reset: everything before it survives.
      expect(remaining).toEqual(expect.arrayContaining(['scm_connection', 'account', 'card']));
    });

    it('THEN the repository tables go with the step that made them', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['scm_connection', 'scm_event_raw']));
      // Rolling back is one step, not a reset: everything before it survives.
      expect(remaining).toEqual(expect.arrayContaining(['account', 'project', 'board', 'card']));
    });

    it('THEN the one before that takes its column back off', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('file')).not.toContain('thumbnail_key');
    });

    it('THEN the one before that rolls back too', async () => {
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await tableNames()).not.toEqual(expect.arrayContaining(['file', 'card_attachment']));
    });

    it('THEN the step before it rolls back too, and leaves what came before alone', async () => {
      // Every `down` has to work, not only the newest one. A migration whose
      // rollback was never run is a rollback nobody finds out is broken until
      // they need it.
      const { error } = await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      const remaining = await tableNames();

      expect(error).toBeUndefined();
      expect(remaining).not.toEqual(expect.arrayContaining(['subtask', 'comment', 'card_link']));
      expect(remaining).toEqual(expect.arrayContaining(['account', 'project', 'board', 'card']));
    });

    it('THEN they can all be applied again, so the cycle is repeatable', async () => {
      const { error } = await runMigrations(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();
      expect(await columnNames('project')).toContain('wip_is_advisory');
      expect(await tableNames()).toEqual(
        expect.arrayContaining([
          'subtask',
          'comment',
          'card_link',
          'scm_connection',
          'asset',
          'card_asset_link',
          'project_doc',
          'milestone',
          'project_release',
          'release_asset',
          'permission_group',
          'permission_rule',
          'team_permission_group',
          'team',
          'team_member',
        ]),
      );
    });
  });

  /*
   * The one migration in the set that moves data rather than shape.
   *
   * Run last, after the cycle above has put every migration back, so it starts
   * from a complete schema and leaves one. It undoes the tree, writes a library
   * filed the old way, and applies it again — which is exactly what will happen
   * to an install that upgrades, and the only part of this change that could
   * lose somebody's filing.
   */
  describe('WHEN a library filed with subcategories is migrated', () => {
    it('THEN every subcategory becomes a category, and the assets move into it', async () => {
      // Back past the step that lets a name wait as well, which came after the
      // tree and depends on the index it made.
      await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));
      await rollbackLastMigration(urlForDatabase(TEST_DATABASE_NAME));

      await withTestDatabase(async (database) => {
        await sql`
          insert into account (id, name, slug) values (${ACCOUNT}, 'Northwind', 'northwind')
        `.execute(database);
        await sql`
          insert into project (id, account_id, name, code, slug)
          values (${PROJECT}, ${ACCOUNT}, 'Saltmarsh', 'SLTM', 'saltmarsh')
        `.execute(database);
        await sql`
          insert into asset_category (id, account_id, project_id, name, color, position)
          values (${CATEGORY}, ${ACCOUNT}, ${PROJECT}, 'Props', '#adadad', 1)
        `.execute(database);

        // Two spellings of one word and a third thing, which is the whole
        // trouble with a text box: `cloth` and `  Cloth ` are one category.
        for (const [id, name, subcategory] of [
          ['00000000-0000-4000-8000-0000000000a1', 'Banner', 'Cloth'],
          ['00000000-0000-4000-8000-0000000000a2', 'Curtain', '  Cloth '],
          ['00000000-0000-4000-8000-0000000000a3', 'Anvil', 'Metal'],
          ['00000000-0000-4000-8000-0000000000a4', 'Crate', null],
        ] as const) {
          await sql`
            insert into asset
              (id, account_id, project_id, category_id, asset_key, name, subcategory, position)
            values
              (${id}, ${ACCOUNT}, ${PROJECT}, ${CATEGORY}, ${'SLTM-AST-' + id.slice(-1)},
               ${name}, ${subcategory}, 1)
          `.execute(database);
        }
      });

      const { error } = await runMigrations(urlForDatabase(TEST_DATABASE_NAME));

      expect(error).toBeUndefined();

      await withTestDatabase(async (database) => {
        const made = await sql<{ name: string; parent_id: string | null }>`
          select name, parent_id from asset_category
          where parent_id is not null order by name
        `.execute(database);

        expect(made.rows.map((row) => row.name)).toEqual(['Cloth', 'Metal']);
        expect(made.rows.every((row) => row.parent_id === CATEGORY)).toBe(true);

        const filed = await sql<{ name: string; category: string }>`
          select asset.name, asset_category.name as category
          from asset join asset_category on asset_category.id = asset.category_id
          order by asset.name
        `.execute(database);

        expect(filed.rows).toEqual([
          { name: 'Anvil', category: 'Metal' },
          // Trimmed, so one spelling rather than two categories.
          { name: 'Banner', category: 'Cloth' },
          // Nothing typed in the box, so it stays where it was.
          { name: 'Crate', category: 'Props' },
          { name: 'Curtain', category: 'Cloth' },
        ]);
      });
    });
  });
});
