import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { permittedActions } from '../domain/index.js';

/**
 * Every action the web client hides a tab or a button behind is a real one.
 *
 * `useMay('audit.veiw')` compiles, runs, and silently hides the Audit tab from
 * everybody for ever. Nothing else notices: the query behind the screen still
 * refuses the right people, so the only symptom is a door that is never drawn —
 * and the person it was drawn for is not the person who would report it.
 *
 * Beside the guard that every handler answers to a permission, for the same
 * reason: what is being checked is that whoever writes the next one cannot get
 * it silently wrong. Not in the client, because the list is here and the client
 * is not allowed to depend on this package; not in `domain`, which is kept free
 * of IO. Read off the source as text, which is a dependency in no direction.
 */
const clientSource = fileURLToPath(new URL('../../../Client/src/', import.meta.url));

/** Everything inside `may('…')`, wherever the client asks. */
const ASKED = /\bmay\(\s*'([^']+)'\s*\)/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);

    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

function actionsTheClientAsksAbout(): { file: string; action: string }[] {
  return sourceFiles(clientSource).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(ASKED)].map((match) => ({
      file: path.slice(clientSource.length),
      action: match[1] ?? '',
    })),
  );
}

describe('GIVEN the web client asking what somebody may do', () => {
  describe('WHEN it names an action', () => {
    it('THEN the authorisation policy has heard of it', () => {
      const known = new Set<string>(permittedActions);

      expect(actionsTheClientAsksAbout().filter((each) => !known.has(each.action))).toEqual([]);
    });

    it('THEN there are some to check, so a sweep that found nothing fails', () => {
      expect(actionsTheClientAsksAbout().length).toBeGreaterThan(0);
    });
  });
});
