import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Tags the current commit with the version in package.json and pushes it, which
 * is what triggers the release workflow.
 *
 * Reading the version rather than taking it as an argument is the point: the
 * version was decided in the pull request that bumped it, and typing it a second
 * time is how a tag ends up disagreeing with the code it points at.
 */

/** @type {unknown} */
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const version = /** @type {{ version: string }} */ (manifest).version;

/** @param {string[]} args */
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);

if (branch !== 'main') {
  process.stderr.write(
    `On ${branch}. Releases are cut from main, after the version bump has merged.\n`,
  );
  process.exit(1);
}

if (git(['status', '--porcelain']) !== '') {
  process.stderr.write('The working tree has uncommitted changes.\n');
  process.exit(1);
}

const existing = git(['tag', '--list', version]);

if (existing !== '') {
  process.stderr.write(
    `Tag ${version} already exists. Bump the version in a pull request first.\n`,
  );
  process.exit(1);
}

git(['tag', version]);
git(['push', 'origin', version]);

process.stdout.write(`Pushed ${version}. The release workflow takes it from here.\n`);
