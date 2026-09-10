import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderCssCustomProperties } from './render-css-custom-properties.js';

/**
 * A custom property that does not exist fails silently.
 *
 * `background: var(--color-warning)` where the tokens only ever declared
 * `--color-warn` paints nothing at all, and nothing anywhere says so: no build
 * error, no console warning, just an invisible dot on a screen somebody has to
 * catch by eye. Four stylesheets carried that mistake before this test existed,
 * which is four more than a name check costs to run.
 */
const sourceDirectory = fileURLToPath(new URL('../', import.meta.url));

/** Anywhere a name is given a value: a stylesheet rule or a React style object. */
const DECLARATION = /(--[\w-]+)'?\s*:/g;

const USE = /var\(\s*(--[\w-]+)/g;

function findSource(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return findSource(path, extension);

    return entry.name.endsWith(extension) ? [path] : [];
  });
}

function namesIn(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map(([, name]) => name ?? '');
}

describe('GIVEN the stylesheets of the web client', () => {
  const stylesheets = findSource(sourceDirectory, '.css');

  /*
   * The tokens, plus every property a component declares for itself — a card
   * takes its colour from `--list-color`, which the board sets on the element
   * from TypeScript rather than in any stylesheet.
   */
  const declared = new Set([
    ...namesIn(renderCssCustomProperties(), DECLARATION),
    ...[...stylesheets, ...findSource(sourceDirectory, '.tsx')].flatMap((path) =>
      namesIn(readFileSync(path, 'utf8'), DECLARATION),
    ),
  ]);

  describe('WHEN one of them reads a custom property', () => {
    it('THEN something declares it', () => {
      const unknown = stylesheets.flatMap((path) =>
        namesIn(readFileSync(path, 'utf8'), USE)
          .filter((name) => !declared.has(name))
          .map((name) => `${path.slice(sourceDirectory.length)}: ${name}`),
      );

      expect(unknown).toEqual([]);
    });

    it('THEN there are stylesheets to check, so a sweep that found nothing fails', () => {
      expect(stylesheets.length).toBeGreaterThan(10);
    });
  });
});

/**
 * The same class given a rule of its own twice is not an override.
 *
 * A module is shared by every section of a screen, and a second rule for a name
 * already in use is both rules landing on both controls. The card panel had two
 * `.picker` blocks — one for choosing what to link, one for what `@` offers —
 * and the link picker quietly lost the dashed border that says it is a choice
 * made in place rather than a dialog. Nothing failed: no build error, no
 * warning, and the two rules were five hundred lines apart in the file.
 *
 * What counts is a class standing on its own at the top level, twice. The three
 * things that look like that and are not:
 *
 * - `.factLabel, .factValue { padding }` and then a rule for each. Sharing what
 *   two things have in common and refining each is how CSS is meant to be
 *   written, and it is what the first version of this test got wrong: it read
 *   line-first, so the last name of a selector list looked like a rule of its
 *   own. It reported twelve, ten of which were that.
 * - `.tile` and `.tile:has(...)`, which is one rule and a refinement of it.
 * - `.empty` again inside `@media`, which is the whole point of a media query.
 */
describe('GIVEN a stylesheet of the web client', () => {
  const stylesheets = findSource(sourceDirectory, '.css');

  describe('WHEN a class is given a rule of its own', () => {
    it('THEN nothing else in the same file gives it another', () => {
      const twice = stylesheets.flatMap((path) => {
        const seen = new Set<string>();
        const repeated = new Set<string>();

        for (const name of soleClassRules(readFileSync(path, 'utf8'))) {
          if (seen.has(name)) repeated.add(name);
          seen.add(name);
        }

        return [...repeated].map((name) => `${path.slice(sourceDirectory.length)}: .${name}`);
      });

      expect(twice).toEqual([]);
    });

    it('THEN a selector list and a refinement of it are read as one rule', () => {
      // The mistake the first version of this made, kept as a case so it cannot
      // come back: three rules here, and not one of them is a second `.b`.
      const css = '.a,\n.b { color: red }\n.b { margin: 0 }\n.b:hover { margin: 1px }';

      expect(soleClassRules(css)).toEqual(['b']);
    });

    it('THEN two plain rules for one class are found wherever they sit', () => {
      // Including across a comment with a comma in it, which is what hid one of
      // these while this test was being written.
      const css = '.a { color: red }\n/* an offer, not a label */\n.a { margin: 0 }';

      expect(soleClassRules(css)).toEqual(['a', 'a']);
    });
  });
});

/**
 * Every class given a rule to itself at the top level of a stylesheet.
 *
 * Written as a walk rather than a regex because the thing being counted is a
 * rule's prelude, and a prelude is not a line: it can carry several selectors
 * across several lines, and a regex reading line by line cannot tell the last
 * name of a list from a rule of its own.
 *
 * Only at the top level. A class redefined inside `@media` is a responsive
 * override, which is the feature rather than the fault.
 */
function soleClassRules(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const names: string[] = [];
  let prelude = '';
  let depth = 0;

  for (const character of text) {
    if (character === '{') {
      if (depth === 0) names.push(...soleClassIn(prelude));

      depth += 1;
      prelude = '';
    } else if (character === '}') {
      depth = Math.max(0, depth - 1);
      prelude = '';
    } else if (depth === 0) {
      prelude += character;
    }
  }

  return names;
}

/** The class a prelude names, if it names exactly one and nothing else. */
function soleClassIn(prelude: string): string[] {
  if (prelude.includes(',')) return [];

  const sole = /^\s*\.([A-Za-z0-9_-]+)\s*$/u.exec(prelude);

  return sole?.[1] === undefined ? [] : [sole[1]];
}
/**
 * A list used as a layout keeps the browser's own indent until it is told not
 * to.
 *
 * `list-style: none` takes the bullets and leaves the 40 pixels, so a grid of
 * tiles in a `ul` sits a thumb's width right of everything above it and nothing
 * in the stylesheet says why. The teams grid shipped that way.
 */
describe('GIVEN a stylesheet for a list the app lays out itself', () => {
  const sources = findSource(sourceDirectory, '.tsx');
  const LIST = /<(?:ul|ol) className=\{styles\.([A-Za-z0-9_]+)\}/g;

  describe('WHEN the rule for it is read', () => {
    it('THEN it says what its own margin and padding are', () => {
      const indented = sources.flatMap((path) => {
        const classes = namesIn(readFileSync(path, 'utf8'), LIST);
        const stylesheet = stylesheetBeside(path);

        if (stylesheet === undefined) return [];

        const css = readFileSync(stylesheet, 'utf8');

        return classes.flatMap((name) => {
          const rule = new RegExp(String.raw`^\.${name}\s*\{([^}]*)\}`, 'm').exec(css);

          if (rule === null) return [];

          const body = rule[1] ?? '';

          return body.includes('padding') && body.includes('margin')
            ? []
            : [`${stylesheet.slice(sourceDirectory.length)}: .${name}`];
        });
      });

      expect(indented).toEqual([]);
    });
  });
});

/** The one stylesheet a component imports, which is the one beside it. */
function stylesheetBeside(componentPath: string): string | undefined {
  const folder = componentPath.slice(0, componentPath.lastIndexOf(sep) + 1);
  const own = componentPath.replace(/\.tsx$/, '.module.css');

  if (existsSync(own)) return own;

  const beside = findSource(folder, '.module.css');

  return beside[0];
}

/**
 * A tone of the text colour is a token, not a formula.
 *
 * There were 187 of these written by hand, at sixteen different percentages —
 * 42 on one screen and 45 on the next, 55 here and 60 there, none of the
 * differences chosen by anybody. They also stood between the app and a light
 * theme: a formula in a stylesheet is a decision that cannot be re-made by
 * changing the palette.
 */
describe('GIVEN a stylesheet of the web client', () => {
  const stylesheets = findSource(sourceDirectory, '.css');

  describe('WHEN it wants text a step back from full strength', () => {
    it('THEN it names a tone rather than mixing one', () => {
      const mixed = stylesheets.flatMap((path) => {
        const lines = readFileSync(path, 'utf8').split(/\r?\n/);

        return lines.flatMap((line, index) =>
          /color-mix\([^)]*var\(--color-text\)/.test(line)
            ? [`${path.slice(sourceDirectory.length)}:${String(index + 1)}`]
            : [],
        );
      });

      expect(mixed).toEqual([]);
    });
  });

  describe('WHEN it wants any colour at all', () => {
    it('THEN it names a token rather than writing the colour down', () => {
      const raw = stylesheets.flatMap((path) => {
        const lines = readFileSync(path, 'utf8').split(/\r?\n/);

        return lines.flatMap((line, index) =>
          /#[0-9a-fA-F]{3,8}\b/.test(line)
            ? [`${path.slice(sourceDirectory.length)}:${String(index + 1)}`]
            : [],
        );
      });

      expect(raw).toEqual([]);
    });
  });
});

/**
 * A class a component names, and no rule anywhere with that name.
 *
 * CSS Modules hand back `undefined` for a name the stylesheet does not carry,
 * and `className={undefined}` renders no attribute at all. Nothing fails: no
 * build error, no console warning, and the element is simply unstyled — which
 * for a `div` is a shrug and for an `img` is the picture at whatever size the
 * file happens to be. `styles.assignee` was missing from two stylesheets, and a
 * card on the board drew whoever it was assigned to at the resolution their
 * camera shoots, across the whole screen.
 *
 * Read from the import rather than from the file beside it, because a component
 * does not always own its stylesheet: the asset panel draws itself with the
 * library's, and the comment composer with the activity feed's.
 */
describe('GIVEN a component of the web client', () => {
  const components = findSource(sourceDirectory, '.tsx');

  describe('WHEN it names a class from a stylesheet it imports', () => {
    it('THEN that stylesheet has a rule for the name', () => {
      const unstyled = components.flatMap((path) => {
        const source = readFileSync(path, 'utf8');

        return [...source.matchAll(STYLESHEET_IMPORT)].flatMap((found) => {
          const binding = found[1] ?? '';
          const specifier = found[2] ?? '';
          const stylesheet = resolve(dirname(path), specifier);

          if (!existsSync(stylesheet)) {
            return [`${path.slice(sourceDirectory.length)}: no such stylesheet ${specifier}`];
          }

          const css = readFileSync(stylesheet, 'utf8');

          return [...new Set(namesIn(source, classesNamedThrough(binding)))]
            .filter((name) => !hasRuleFor(css, name))
            .map((name) => `${path.slice(sourceDirectory.length)}: ${binding}.${name}`);
        });
      });

      expect(unstyled).toEqual([]);
    });

    it('THEN a name with a rule passes and a name without one does not', () => {
      const css = '.head { gap: 7px }\n.due,\n.points { margin-left: auto }';

      expect(hasRuleFor(css, 'head')).toBe(true);
      expect(hasRuleFor(css, 'points')).toBe(true);
      // Not `.head` again: a longer name that merely starts with one already
      // written is the false pass this would otherwise give.
      expect(hasRuleFor(css, 'heading')).toBe(false);
      expect(hasRuleFor(css, 'assignee')).toBe(false);
    });

    it('THEN there are components to check, so a sweep that found nothing fails', () => {
      expect(components.length).toBeGreaterThan(50);
    });
  });
});

/** Every stylesheet a component imports, and the name it gives each one. */
const STYLESHEET_IMPORT = /import\s+(\w+)\s+from\s+'([^']+\.css)'/g;

/** `styles.thing`, under whatever name the import was bound to. */
function classesNamedThrough(binding: string): RegExp {
  return new RegExp(String.raw`\b${binding}\.(\w+)`, 'g');
}

/**
 * Whether the stylesheet gives that class a rule.
 *
 * Anywhere and in any shape — on its own, in a selector list, refined by a
 * pseudo-class, nested under a media query. The question here is only whether
 * the name exists at all, which is the mistake that fails silently; where a
 * rule sits is a matter of taste and not of the class rendering as nothing.
 */
function hasRuleFor(css: string, name: string): boolean {
  return new RegExp(String.raw`\.${name}(?![\w-])`).test(css);
}
