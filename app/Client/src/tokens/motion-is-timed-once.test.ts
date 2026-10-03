import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A stylesheet that times its own motion is how the app ended up with a dozen
 * slightly different fades.
 *
 * What appears, disappears or changes size tweens from `components/ui/motion.ts`,
 * and what is still CSS — a hover revealing a control — reads its timing from
 * the motion tokens. So a duration written into a transition or an animation is
 * a second place for a decision that already has one, and it would also ignore
 * the reduced-motion setting those tokens answer for it.
 *
 * Spinners are the exception the issue allowed: a turning ring is not
 * something arriving anywhere, and it has its own answer for somebody who asked
 * for less movement.
 */
const sourceDirectory = fileURLToPath(new URL('../', import.meta.url));

const SPINNERS = new Set([
  'components/ui/Loading.module.css',
  'components/forge/RepositorySync.module.css',
]);

/** A `transition` or `animation` declaration with a time written into it. */
const TIMED_HERE = /^\s*(?:transition|animation)(?:-duration)?\s*:[^;]*\d(?:ms|s)\b/mu;

function findStylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return findStylesheets(path);

    return entry.name.endsWith('.css') ? [path] : [];
  });
}

function relative(path: string): string {
  return path.slice(sourceDirectory.length).split(sep).join('/');
}

describe('GIVEN the stylesheets of the web client', () => {
  describe('WHEN one of them makes something move', () => {
    it('THEN it takes the timing from the motion tokens rather than writing its own', () => {
      const timedHere = findStylesheets(sourceDirectory)
        .filter((path) => !SPINNERS.has(relative(path)))
        .flatMap((path) =>
          [...readFileSync(path, 'utf8').matchAll(new RegExp(TIMED_HERE.source, 'gmu'))].map(
            ([declaration]) => `${relative(path)}: ${declaration.trim()}`,
          ),
        );

      expect(timedHere).toEqual([]);
    });

    it('THEN a time written into a transition is found, so the sweep is not vacuous', () => {
      expect('  transition: opacity 120ms ease-out;').toMatch(TIMED_HERE);
      expect('  transition: opacity var(--motion-hint) var(--motion-ease);').not.toMatch(
        TIMED_HERE,
      );
    });
  });
});
