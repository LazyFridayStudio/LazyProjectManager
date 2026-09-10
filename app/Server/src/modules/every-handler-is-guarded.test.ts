import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Every command and query answers to a permission.
 *
 * A handler with no permission on it is one that cannot be denied, and a rule
 * saying `Deny — view asset` has to mean something everywhere or it means
 * nothing anywhere. `assetDetailQuery` was that handler: scoped by account and
 * by what the actor reached, so never a way into another studio's library, and
 * still impossible to refuse anybody.
 *
 * Read off the source rather than off a registry, because the thing being
 * checked is that somebody writing the next handler cannot forget. A test that
 * asked the handlers themselves would only know about the ones that answered.
 */
const modules = fileURLToPath(new URL('.', import.meta.url));

/**
 * The handlers that answer to nobody, and why each is allowed to.
 *
 * Every one of them either runs before there is an actor, or is about the
 * caller themselves. Adding to this list is a decision; forgetting to gate a
 * handler is not, which is the difference this test exists to keep.
 */
const ANSWERS_TO_NOBODY: Readonly<Record<string, string>> = {
  healthQuery: 'Asked by the container before anybody has signed in.',
  signInCommand: 'The act of becoming somebody. There is no actor yet.',
  signOutCommand: 'Ending your own session, which needs no permission beyond having one.',
  completeSetupCommand: 'Runs once, on an install with no owner to ask.',
  meQuery: 'Who am I. Refusing somebody their own name is not a permission worth having.',
  changePasswordCommand:
    'Your own password, and it asks for the current one — which is a better guard than a permission, and the only one that stops a borrowed unlocked laptop.',
  waitingMentionsQuery:
    'What is waiting for you. There is no user id on it, so the only rows it can reach are the ones the session names — and a mention exists at all only because the server decided, when it was posted, that you could reach that project.',
  seeMentionCommand:
    'Taking your own mention off your own mark. The update names the session’s user, so a row belonging to somebody else is one it cannot reach.',
  updateProfileCommand:
    'Your own name and the letters drawn in place of it. It can reach no row but the caller’s, for the reason meQuery gives.',
  removeWorkCommand:
    'Taking your own hours back off. The delete names the session’s user, so an entry belonging to somebody else is a row it cannot reach — and not even a lead may remove somebody’s, because it is that person’s account of their own week.',
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);

    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** The functions in a file that assert a permission, so a caller of one is guarded. */
function guardingFunctions(source: string): string[] {
  return [...source.matchAll(/(?:async )?function (\w+)\(/g)]
    .filter((match) => {
      const body = source.slice(match.index, source.indexOf('\n}\n', match.index));

      return /assertProjectPermission|assertCan\(/.test(body);
    })
    .map((match) => match[1] ?? '');
}

interface Handler {
  readonly name: string;
  readonly file: string;
  readonly isGuarded: boolean;
}

function handlersIn(path: string): Handler[] {
  const source = readFileSync(path, 'utf8');
  const guards = guardingFunctions(source);
  const spots = [...source.matchAll(/define(?:Command|Query)Handler\(\{/g)].map(
    (match) => match.index,
  );

  return spots.map((start, index) => {
    const body = source.slice(start, spots[index + 1] ?? source.length);
    const named = /definition:\s*(\w+)/.exec(body);

    return {
      name: named?.[1] ?? '(unnamed)',
      file: path.slice(modules.length).split(sep).join('/'),
      // Either it names an action itself, or it calls something in the same
      // file that does. Both are the handler answering to a permission.
      isGuarded:
        /action:\s*'[\w.]+'/.test(body) ||
        /action:\s*action\b/.test(body) ||
        guards.some((guard) => new RegExp(`\\b${guard}\\(`).test(body)),
    };
  });
}

describe('GIVEN every command and query the server registers', () => {
  const handlers = sourceFiles(modules).flatMap(handlersIn);

  describe('WHEN one of them is read', () => {
    it('THEN it answers to a permission, or is on the list of those that do not', () => {
      const ungated = handlers
        .filter((handler) => !handler.isGuarded)
        .filter((handler) => !(handler.name in ANSWERS_TO_NOBODY))
        .map((handler) => `${handler.file}: ${handler.name}`);

      expect(ungated).toEqual([]);
    });

    it('THEN there are handlers to check, so a sweep that found none fails', () => {
      // A hundred and two when this was written. The floor is deliberately low:
      // it exists to catch the glob breaking, not to be edited on every change.
      expect(handlers.length).toBeGreaterThan(80);
    });
  });

  describe('WHEN the list of handlers that answer to nobody is read', () => {
    it('THEN every name on it is a handler that still exists', () => {
      // A stale exemption is a permission hole nobody can see: the handler it
      // named could come back tomorrow, gated by nothing, and this test would
      // wave it through.
      const known = new Set(handlers.map((handler) => handler.name));

      expect(Object.keys(ANSWERS_TO_NOBODY).filter((name) => !known.has(name))).toEqual([]);
    });
  });
});
