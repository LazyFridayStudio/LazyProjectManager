import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads, bumps and checks versions.
 *
 *   node scripts/version.mjs current           print the project version
 *   node scripts/version.mjs changed [base]    list the packages a branch touched
 *   node scripts/version.mjs bump patch [base] bump the project, and what it touched
 *   node scripts/version.mjs bump patch --all  bump everything, whatever changed
 *   node scripts/version.mjs check <previous>  fail unless the project version moved
 *
 * The root `package.json` is the project version: it is what the release tag and
 * the published image carry, and it moves on every change.
 *
 * Each package under `app/` keeps its own version and only moves when something
 * inside it changed. Bumping them all in lockstep, which this used to do, made a
 * package version meaningless — every package claimed a new one on every release
 * whether or not a line of it had moved.
 */

const ROOT_MANIFEST = 'package.json';
const WORKSPACE_ROOT = 'app';
const DEFAULT_BASE_REF = 'origin/main';
const RELEASES = ['major', 'minor', 'patch'];

/** @typedef {[major: number, minor: number, patch: number]} Semver */

/**
 * @param {string} version
 * @returns {Semver}
 */
function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());

  if (match === null) {
    throw new Error(`"${version}" is not a major.minor.patch version.`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param {Semver} left
 * @param {Semver} right
 * @returns {number} negative when left is older, positive when newer.
 */
function compareVersions(left, right) {
  for (let index = 0; index < left.length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

/**
 * @param {string} version
 * @param {string} release
 * @returns {string}
 */
function applyRelease(version, release) {
  const [major, minor, patch] = parseVersion(version);

  if (release === 'major') {
    return `${String(major + 1)}.0.0`;
  }

  if (release === 'minor') {
    return `${String(major)}.${String(minor + 1)}.0`;
  }

  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
}

/** @returns {string[]} every package directory name under app/ */
function workspaceNames() {
  return readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** @param {string} name */
const manifestFor = (name) => join(WORKSPACE_ROOT, name, 'package.json');

/**
 * The packages a branch touched, compared against its base.
 *
 * Three dots so the question is "what did this branch change", not "how do these
 * two commits differ" — otherwise anything that landed on the base since
 * branching would look like this branch's work.
 *
 * @param {string} baseRef
 * @returns {string[]}
 */
function changedWorkspacePackages(baseRef) {
  const known = new Set(workspaceNames());
  /** @type {Set<string>} */
  const touched = new Set();

  for (const path of changedPaths(baseRef)) {
    const name = /^app\/([^/]+)\//.exec(path.trim())?.[1];

    if (name !== undefined && known.has(name)) {
      touched.add(name);
    }
  }

  return [...touched].sort();
}

/**
 * Every path this branch has touched, committed or not.
 *
 * The working tree counts because bumping happens before committing — asking
 * only what is committed would report nothing for the change you are in the
 * middle of making. In CI the head is already committed and the first source
 * covers it.
 *
 * @param {string} baseRef
 * @returns {string[]}
 */
function changedPaths(baseRef) {
  /**
   * @param {string[]} args
   * @returns {string}
   */
  const run = (args) => {
    try {
      const output = execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return output;
    } catch {
      // No such ref — a fresh clone with no origin, or a first commit.
      return '';
    }
  };

  return [
    run(['diff', '--name-only', `${baseRef}...HEAD`]),
    run(['diff', '--name-only', 'HEAD']),
    run(['ls-files', '--others', '--exclude-standard']),
  ]
    .join('\n')
    .split('\n')
    .filter((path) => path.trim() !== '');
}

/** @param {string} path */
function readVersion(path) {
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return /** @type {{ version?: string }} */ (parsed).version ?? '0.0.0';
}

/**
 * Rewrites only the version line.
 *
 * A parse-and-restringify would reformat the whole manifest and lose key order,
 * turning a one-line version bump into a diff nobody can review.
 *
 * @param {string} path
 * @param {string} version
 */
function writeVersion(path, version) {
  const manifest = readFileSync(path, 'utf8');
  const versionField = /^(\s*"version":\s*")[^"]*(")/m;

  // Checked by presence rather than by whether the content changed: a manifest
  // already carrying the target version is a no-op, not a missing field.
  if (!versionField.test(manifest)) {
    throw new Error(`${path} has no "version" field to update.`);
  }

  writeFileSync(path, manifest.replace(versionField, `$1${version}$2`));
}

/**
 * @param {string | undefined} release
 * @param {string | undefined} baseOrFlag
 */
function bump(release, baseOrFlag) {
  if (release === undefined || !RELEASES.includes(release)) {
    throw new Error(`Expected one of ${RELEASES.join(', ')}, got "${release ?? ''}".`);
  }

  const bumpEverything = baseOrFlag === '--all';
  const baseRef = bumpEverything || baseOrFlag === undefined ? DEFAULT_BASE_REF : baseOrFlag;
  const targets = bumpEverything ? workspaceNames() : changedWorkspacePackages(baseRef);

  // The project version always moves: it is what the release is called, and
  // every change ships inside it whichever package it came from.
  const projectBefore = readVersion(ROOT_MANIFEST);
  const projectAfter = applyRelease(projectBefore, release);
  writeVersion(ROOT_MANIFEST, projectAfter);
  process.stdout.write(`project   ${projectBefore} -> ${projectAfter}\n`);

  for (const name of targets) {
    const path = manifestFor(name);
    const before = readVersion(path);
    const after = applyRelease(before, release);
    writeVersion(path, after);
    process.stdout.write(`${name.padEnd(10)}${before} -> ${after}\n`);
  }

  if (targets.length === 0) {
    process.stdout.write('Nothing under app/ changed, so only the project version moved.\n');
  }
}

/**
 * Fails unless the project version moved forward.
 *
 * Run against the base branch's version on every pull request, so a change
 * cannot reach main without saying what kind of release it is.
 *
 * @param {string | undefined} previous
 */
function check(previous) {
  const current = readVersion(ROOT_MANIFEST);

  if (previous === undefined) {
    throw new Error('Expected the previous version to compare against.');
  }

  if (compareVersions(parseVersion(current), parseVersion(previous)) > 0) {
    process.stdout.write(`Version bumped: ${previous} -> ${current}\n`);
    return;
  }

  throw new Error(
    `The version is still ${current}.\n` +
      'Every pull request bumps it, because the release tag is taken from it.\n' +
      '  pnpm bump patch    a fix\n' +
      '  pnpm bump minor    a feature\n' +
      '  pnpm bump major    a breaking change',
  );
}

const [command, first, second] = process.argv.slice(2);

try {
  if (command === 'current') {
    process.stdout.write(`${readVersion(ROOT_MANIFEST)}\n`);
  } else if (command === 'changed') {
    process.stdout.write(`${changedWorkspacePackages(first ?? DEFAULT_BASE_REF).join('\n')}\n`);
  } else if (command === 'bump') {
    bump(first, second);
  } else if (command === 'check') {
    check(first);
  } else {
    throw new Error('Expected one of: current, changed, bump <release>, check <previous>.');
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unknown error'}\n`);
  process.exitCode = 1;
}
