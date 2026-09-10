import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * What somebody may do is decided by their permission groups.
 *
 * Not by a role picked from a dropdown. The two are different answers to one
 * question, and a product carrying both ends up with a studio that has set one
 * and not the other and cannot work out why somebody is refused.
 *
 * The Users screen took roles off its rows for exactly this reason. They kept
 * coming back anyway, on every new screen that copied the pattern from the one
 * beside it — which is what this test is for. A rule nobody can see is a rule
 * that gets broken by the next person to write a dialog.
 *
 * The role column still exists and still does one job: it is the floor
 * underneath somebody who has been given nothing, and the identity of the
 * install's owner. That is not something anybody chooses on a screen, and
 * nothing here should offer it.
 *
 * Nothing does, now. `NewPersonDialog` was the last one and had an exception
 * here for as long as it asked — taking the dropdown out changed what happens
 * on an install that is already running, so it waited to be its own decision
 * rather than a tidy-up slipped into a change about something else. It asks for
 * permission groups instead, and this test needs no exceptions.
 */
const components = fileURLToPath(new URL('.', import.meta.url));

/** A control that asks somebody to pick a role. */
const OFFERS_A_ROLE = /label="Role"|ROLE_OPTIONS|ROLE_ORDER/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);

    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('GIVEN a screen that says what somebody may do', () => {
  describe('WHEN it offers a way to set that', () => {
    it('THEN it offers permission groups, not a role', () => {
      const asking = sourceFiles(components)
        .filter((path) => OFFERS_A_ROLE.test(readFileSync(path, 'utf8')))
        .map((path) => path.slice(components.length).split(sep).join('/'));

      expect(asking).toEqual([]);
    });

    it('THEN there are screens to check, so a sweep that found nothing fails', () => {
      // A rule with no exceptions left is one word away from being a rule with
      // no files left, and a sweep of nothing passes for ever in silence.
      expect(sourceFiles(components).length).toBeGreaterThan(10);
    });
  });
});
