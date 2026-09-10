import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The compose file that ships to people, against the one this repository runs.
 *
 * These two drifted, and nothing noticed. `docker/install/compose.yml` never handed the
 * container `APP_SECRET`, so connecting a repository was impossible on every
 * released install however the operator wrote their `.env`.
 *
 * The second was a store address the browser was supposed to use, which the
 * shipped file did not pass through — and then did, pointing at a port it does
 * not publish. Both were the same mistake twice: a setting that only a real
 * install exercises. It is gone rather than fixed (#172), because files go
 * through the app now and there is no second address to be wrong about.
 *
 * Neither could be caught by anything else here: development and CI both use
 * the root compose, which has always been right. The only way to find it was to
 * deploy, which is exactly the moment it is most expensive to find.
 *
 * The third one was a whole service. A release shipped without a worker for its
 * entire life, so on an installed copy nothing the outbox carries ever happened:
 * a delivery from a repository was stored and never read, thumbnails were never
 * made, and a second tab never heard that the first had changed anything. This
 * file compared the settings and never thought to compare the services.
 */
const root = new URL('../../../../', import.meta.url);

/** The services a compose file defines, by name. */
function readServiceNames(composePath: string): Set<string> {
  const text = readFileSync(fileURLToPath(new URL(composePath, root)), 'utf8');
  const services = text.slice(text.indexOf('services:'));
  const end = /^[a-z]/mu.exec(services.slice('services:'.length));
  const block = end === null ? services : services.slice(0, 'services:'.length + end.index);

  return new Set([...block.matchAll(/^ {2}([a-z][\w-]*):/gmu)].map(([, name]) => name ?? ''));
}

function readAppEnvironment(composePath: string): Set<string> {
  const text = readFileSync(fileURLToPath(new URL(composePath, root)), 'utf8');
  const app = text.slice(text.indexOf('  app:'));
  const environment = app.slice(app.indexOf('    environment:'));
  // Up to whatever ends the block: the next key at service-property depth.
  const block = environment.slice(0, indexOfBlockEnd(environment));

  return new Set([...block.matchAll(/^\s{6}([A-Z][A-Z0-9_]*):/gmu)].map(([, name]) => name ?? ''));
}

function indexOfBlockEnd(environment: string): number {
  const next = /^ {4}[a-z_]+:/mu.exec(environment.slice(environment.indexOf('\n')));

  return next === null ? environment.length : environment.indexOf('\n') + next.index;
}

describe('GIVEN the compose file a release ships with', () => {
  const shipped = readAppEnvironment('docker/install/compose.yml');
  const development = readAppEnvironment('docker/compose.yml');

  describe('WHEN it is compared with the one this repository runs', () => {
    it('THEN it hands the container every setting the development stack does', () => {
      const missing = [...development].filter((name) => !shipped.has(name));

      expect(missing).toEqual([]);
    });

    it('THEN it runs every service the development stack runs', () => {
      const shippedServices = readServiceNames('docker/install/compose.yml');
      const developmentServices = readServiceNames('docker/compose.yml');
      // The fake forge is a workbench, not a service: it answers as a repository
      // and takes anybody's word for everything, which is fine on a laptop and
      // nowhere else.
      const missing = [...developmentServices].filter(
        (name) => name !== 'fake-forge' && !shippedServices.has(name),
      );

      expect(missing).toEqual([]);
    });

    it('THEN the worker is one of them, because a release shipped without one', () => {
      // Spelled out as well as compared, for the reason the settings below are.
      // Without it a delivery is stored and never read, and a card never hears
      // about the commit that named it.
      expect(readServiceNames('docker/install/compose.yml')).toContain('worker');
    });

    it('THEN the setting that was missing is named, so this cannot silently pass', () => {
      // Spelled out as well as compared: a refactor that broke the comparison
      // above would otherwise leave an empty list looking like agreement.
      expect(shipped).toContain('APP_SECRET');
      expect(development.size).toBeGreaterThan(5);
    });

    it('THEN neither of them hands the container a second address for the store', () => {
      // The browser never addresses it, so there is nothing to configure and
      // nothing to get wrong. A setting that comes back here is one somebody is
      // about to have to be right about on an install they cannot test.
      expect(shipped).not.toContain('S3_PUBLIC_ENDPOINT');
      expect(development).not.toContain('S3_PUBLIC_ENDPOINT');
    });
  });
});

/**
 * The folder that ships, against what the release step expects to find in it.
 *
 * `docker/install/` is the bundle: the workflow takes the whole folder and
 * renames nothing, because every file in it is already called what it is called
 * on an installed machine.
 *
 * Asked of git rather than of the disk, which is the same question the release
 * step asks — it runs `git archive` rather than `cp`, so only committed files
 * ship. That matters here more than it reads: an operator's own `.env` sits in
 * this folder on any machine the stack has been run from, and a plain copy
 * would have put their secrets in a public zip. Reading the disk would also
 * make this test fail on those machines for a reason that is not a defect.
 *
 * A file committed here ships, which is the point of the arrangement and the
 * reason the contents are named rather than counted: something new belongs in
 * the list on purpose, put there by somebody who has pictured a stranger
 * downloading it.
 */
describe('GIVEN the folder a release is assembled from', () => {
  const bundled = execFileSync('git', ['ls-files', 'docker/install'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  })
    // Allowing for the carriage return git leaves on Windows: a name still
    // carrying one would match nothing.
    .split(/\r?\n/u)
    .filter((line) => line !== '')
    .map((line) => line.slice('docker/install/'.length));

  describe('WHEN the release step archives it', () => {
    it('THEN it ships the three files an install is, and nothing else', () => {
      expect([...bundled].sort()).toEqual(['.env.example', 'README.md', 'compose.yml']);
    });

    it('THEN nothing that could hold a secret is committed into it', () => {
      // The whole folder ships. A real `.env` committed here would be published
      // with the release, and would be read by everybody who downloaded it.
      expect(bundled.filter((name) => name === '.env')).toEqual([]);
    });

    it('THEN the two the version is stamped into are among them', () => {
      // `sed -i` on a file that is not there ends the release, and it ends it
      // after the image has already been pushed.
      expect(bundled).toContain('compose.yml');
      expect(bundled).toContain('.env.example');
    });
  });
});
