import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { readE2eServerEnvironment } from '../e2e/e2e-environment.js';

/**
 * The pictures in the readme, taken from the product rather than drawn.
 *
 * Run by `pnpm screenshots`, never by `pnpm test:e2e`. See
 * `config/playwright.screenshots.config.ts` for why this is its own run: it
 * asserts nothing about the product and produces files, and a suite that mixes
 * the two no longer means one thing when it is green.
 *
 * The expectations in here are waits, not claims. A screenshot taken before the
 * tiles have their pictures is a grid of grey boxes that looks like a bug in the
 * product, so each shot waits for the thing it is a picture of.
 *
 * To add one: seed whatever it needs into `app/Server/src/seed-demo/`, add a
 * `test` below that navigates and calls `shoot`, and reference the file from the
 * readme. To retake all of them after a screen changes, run the command again —
 * the install is thrown away and rebuilt every time, so there is nothing to
 * clean up and no way for one shot to be older than the rest.
 */

/**
 * The studio the install is set up as.
 *
 * Not one of `DEMO_PEOPLE`: the seed hangs its five on the project and leaves
 * the owner account to whoever made it, so an owner named after one of them
 * would appear twice in the same avatar row. The domain matches theirs because
 * a studio whose email is somewhere else entirely reads as a mistake in the
 * screenshot rather than as a detail nobody was meant to look at.
 */
const STUDIO = {
  name: 'Blockfall Studio',
  owner: 'Robin Vale',
  email: 'robin@blockfall.demo',
  password: 'a phrase beats a puzzle',
};

/** What `seed-demo` calls the project it makes. */
const PROJECT = 'Blockfall';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

function imagePath(name: string): string {
  return fileURLToPath(new URL(`../../../docs/images/${name}`, import.meta.url));
}

/**
 * A picture of what is on the screen, at a height chosen for the screen.
 *
 * The viewport rather than the whole page. A full-page capture of the library
 * is four thousand pixels of tiles, which a readme draws two inches wide and
 * nobody can read — a screenshot is meant to show what the thing looks like,
 * not to contain everything in it.
 */
async function shoot(page: Page, name: string, height: number): Promise<void> {
  await page.setViewportSize({ width: 1600, height });

  /*
   * Back to the top, wherever the last click left it.
   *
   * Opening the library's four categories scrolls to each one in turn, so the
   * picture of it began halfway down a tile with the screen's own title off the
   * top. Asking for the heading rather than for coordinates, because which
   * element scrolls is the layout's business.
   */
  await page.getByRole('heading', { level: 1 }).first().scrollIntoViewIfNeeded();

  // The layout settles a frame after a resize, and the backdrop is a canvas
  // that keeps drawing. One animation frame is enough for the first and there
  // is nothing to be done about the second.
  await page.waitForTimeout(400);

  await page.screenshot({ path: imagePath(name) });
}

/**
 * Goes to one of the project's screens and waits for it to be worth a picture.
 *
 * By address rather than by clicking the nav, whose labels carry their badge
 * counts — the link to the board is named "Tasks 14" today and "Tasks 15" as
 * soon as somebody adds a card. Waiting on the heading rather than on a
 * particular one, because what each screen calls itself is the screen's
 * business: the dashboard's says "Production overview".
 */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${projectPath}${path}`);

  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await picturesHaveLoaded(page);
}

/**
 * Opens every category on the library, which arrives with all of them closed.
 *
 * Right for the product — a library of forty categories that opened all of them
 * is a scroll bar and nothing else — and wrong for a picture of it, which came
 * out as four headings over an acre of empty screen. The tiles are the thing
 * being shown.
 *
 * Found by the count in the label rather than by name, so this keeps working on
 * a demo that renames its categories.
 *
 * Always the first one still closed, rather than each of a list taken up front.
 * A locator is a position in whatever currently matches, not a handle on an
 * element, and opening a category takes it out of the set — so the third of
 * four, by the time two had been opened, was a position nothing was at.
 */
async function openEveryCategory(page: Page): Promise<void> {
  const closed = page
    .locator('button[aria-expanded="false"]')
    .filter({ hasText: /\(\d+ items?\)/ });

  for (let left = await closed.count(); left > 0; left -= 1) {
    await closed.first().click();
  }
}

/** Waits for every picture on the screen to have actually decoded. */
async function picturesHaveLoaded(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.images].every((image) => !image.complete || image.naturalWidth > 0),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

test.describe.configure({ mode: 'serial' });

/**
 * Where the project lives, learned rather than assumed.
 *
 * The slug comes off the launcher link instead of being spelled out, because
 * how a name becomes a slug is the server's business and a screenshot run is
 * the wrong place to keep a second copy of that rule.
 */
let projectPath = '';

test.describe('The readme pictures', () => {
  /*
   * One browser for the whole run, as the journey next door keeps one.
   *
   * A fresh context per test is a fresh browser with no cookie in it, so
   * everything after the setup arrived at the sign-in screen and waited there
   * for a project link that a signed-out person is never shown.
   */
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('sets the install up', async () => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Set up this server' })).toBeVisible();

    await page.getByLabel('Studio name').fill(STUDIO.name);
    await page.getByLabel('Your name').fill(STUDIO.owner);
    await page.getByLabel('Work email').fill(STUDIO.email);
    await page.getByLabel('Password').fill(STUDIO.password);
    await page.getByRole('button', { name: 'Create owner account' }).click();

    await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();
  });

  test('fills it with the demo studio', () => {
    /*
     * The CLI rather than the API, because it is the same thing a person runs.
     *
     * Handed this run's environment rather than the repository's `.env`, which
     * is what `pnpm seed:demo` would use — that one points at the database
     * somebody is developing against, and filling it with a demo studio while
     * taking screenshots would be a rude surprise.
     */
    const seeded = spawnSync(process.execPath, ['app/Server/dist/seed-demo-cli.js'], {
      cwd: repositoryRoot,
      env: { ...process.env, ...readE2eServerEnvironment() },
      encoding: 'utf8',
    });

    if (seeded.status !== 0) {
      throw new Error(`The demo could not be seeded: ${seeded.stderr || seeded.stdout}`);
    }
  });

  test('opens the project', async () => {
    await page.goto('/');
    await page
      .getByRole('link', { name: new RegExp(PROJECT) })
      .first()
      .click();

    await expect(page.getByRole('navigation', { name: 'Project' })).toBeVisible();

    projectPath = new URL(page.url()).pathname;
  });

  test('takes the board', async () => {
    await open(page, '/tasks');

    await shoot(page, 'board.png', 1000);
  });

  test('takes the asset library', async () => {
    await open(page, '/assets');
    await openEveryCategory(page);
    await picturesHaveLoaded(page);

    await shoot(page, 'assets.png', 1050);
  });

  test('takes the timeline', async () => {
    await open(page, '/timeline');

    await shoot(page, 'timeline.png', 885);
  });

  test('takes the dashboard', async () => {
    await open(page, '');

    await shoot(page, 'dashboard.png', 665);
  });

  test('takes the budget', async () => {
    await open(page, '/budget');

    await shoot(page, 'budget.png', 425);
  });

  test('takes the design document', async () => {
    await open(page, '/doc');

    await shoot(page, 'doc.png', 900);
  });

  test('takes the builds', async () => {
    await open(page, '/builds');

    await shoot(page, 'builds.png', 700);
  });

  test('takes the task list', async () => {
    await open(page, '/tasks/all');

    await shoot(page, 'tasks.png', 900);
  });
});
