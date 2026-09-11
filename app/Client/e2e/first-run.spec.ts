import { readFile } from 'node:fs/promises';

import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * The studio this run invents. Fixed rather than random: the database is dropped
 * before every run, so there is nothing for a name to collide with, and a fixed
 * one makes a failure screenshot readable.
 */
const STUDIO = {
  name: 'Northwind Studio',
  owner: 'Jake Winters',
  email: 'jake@northwind.studio',
  password: 'a phrase beats a puzzle',
};

const PROJECT = { name: 'Saltmarsh', code: 'SLTM' };

const CARD = { title: 'Harbour crane retopo', key: 'SLTM-TASK-1' };

const BLOCKER = { title: 'Retopologise the deck', key: 'SLTM-TASK-2' };

/** A card made to be deleted, so the journey's own board is left as it was. */
const MISTAKE = 'Typed into the wrong project';

const DESCRIPTION = ['# Brief', '', 'The crane is **over budget** on triangles.'].join('\n');

const CATEGORY = 'Environment Props';

const ASSET = 'Ruined watchtower';

/**
 * One transparent pixel, as a PNG.
 *
 * Small enough to inline and real enough for the worker to decode, which is what
 * makes this an upload rather than a mock of one.
 */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * One person, one browser, from an install nobody has claimed to a card with
 * something written on it.
 *
 * Serial and sharing a page on purpose. This is the one thing unit tests cannot
 * answer — whether the parts add up to a product somebody can use — and the
 * answer is a sequence, not a set: there is no project to open until one has
 * been made, and no card to write on until the board exists. A fresh context per
 * step would only mean signing in four more times to arrive at the same place.
 */
test.describe.serial('a studio setting up for the first time', () => {
  let context: BrowserContext;
  let page: Page;

  // A context rather than a bare page, so the journey can open a second tab
  // signed in as the same person — which is the only way to ask whether two
  // tabs stay in step.
  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('claims the install and lands inside it', async () => {
    /*
     * As a browser on a plain-HTTP address that is not localhost.
     *
     * `crypto.randomUUID` is available only in a secure context, so a studio
     * opening this on `http://192.168.1.10:24571` does not have it — and every
     * command used to default its `commandId` from it, throwing before the
     * fetch. Nothing reached the network and the screen said "could not reach
     * the server", which was the one explanation that was not true.
     *
     * Taken away here rather than served from a second address, because what
     * broke was the missing function and not the address itself.
     */
    await page.addInitScript(() => {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Set up this server' })).toBeVisible();

    await page.getByLabel('Studio name').fill(STUDIO.name);
    await page.getByLabel('Your name').fill(STUDIO.owner);
    await page.getByLabel('Work email').fill(STUDIO.email);
    await page.getByLabel('Password').fill(STUDIO.password);
    await page.getByRole('button', { name: 'Create owner account' }).click();

    // Landing on Projects is the proof the install was made: the app only draws
    // at all once identity.me answers with an account behind it.
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeAttached();
    await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
  });

  test('draws its backdrop across the whole window', async () => {
    /*
     * A canvas is a replaced element: `inset: 0` does not stretch it the way it
     * stretches a div, so without an explicit width and height it sits in the
     * corner at its intrinsic 300 by 150. It shipped that way once, and from
     * the outside it read as "the background is broken" rather than as a
     * missing declaration.
     */
    const viewport = page.viewportSize();

    if (viewport === null) {
      throw new Error('Expected the browser to have a window size.');
    }

    const backdrop = await page.locator('canvas').first().boundingBox();

    expect(backdrop?.width).toBeCloseTo(viewport.width, 0);
    expect(backdrop?.height).toBeCloseTo(viewport.height, 0);
  });

  test('starts with no projects at all', async () => {
    // Nothing is seeded. An install that arrived with demo data in it would be
    // an install somebody has to clean out before using.
    await expect(page.getByRole('link', { name: new RegExp(PROJECT.name) })).toHaveCount(0);
  });

  test('makes a project', async () => {
    const offer = page.getByRole('button', { name: 'New project', exact: true });

    // A mark rather than the words: this button opens the dialog rather than
    // being it, and `Create project` inside is the one whose label is the
    // sentence. Its own name is still on it, for anything not looking at it.
    await expect(offer).toHaveText('');
    await expect(offer).toHaveAttribute('title', 'New project');

    await offer.click();

    await page.getByLabel('Project name').fill(PROJECT.name);
    await expect(page.getByLabel('Code')).toHaveValue(PROJECT.code);

    await page.getByRole('button', { name: 'Create project' }).click();

    await expect(page.getByRole('dialog', { name: 'New project' })).toBeHidden();
    await expect(page.getByRole('link', { name: new RegExp(PROJECT.name) })).toBeVisible();
  });

  test('draws a project as its art, big enough to pick out at a glance', async () => {
    /*
     * The launcher is a rack of doors. Somebody arrives knowing which project
     * they want and finds it by the picture, so the picture gets the room and
     * the three numbers that used to sit under it are gone.
     *
     * Measured rather than eyeballed, because what this guards against is
     * invisible until somebody opens the app at the wrong window size: a
     * minimum wide enough to be worth doubling to is a minimum that can drop a
     * 1280-wide window to one tile per row, which is a slate somebody scrolls
     * through one project at a time.
     */
    const tile = page.getByRole('link', { name: PROJECT.name, exact: true });
    const wasSized = page.viewportSize();

    // The whole tile is the link, and it is named by the project alone.
    await expect(tile).toBeVisible();

    /*
     * No strip of numbers under it. Asked as "no digit anywhere on the tile"
     * rather than by naming the three labels, because a strip could come back
     * drawn any number of ways and what was wrong with it was the numbers:
     * `12 Assets  8 Open tas…  3 Team`, at micro size, in the faintest colour
     * on the screen, across a third of the tile.
     */
    await expect(tile).not.toHaveText(/\d/);

    for (const width of [1280, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });

      const painted = await tile.evaluate((link) => {
        // The grid lays the tile out directly: the launcher puts nothing
        // between the two, and the art is the first thing inside it.
        const grid = link.parentElement!;
        const art = link.firstElementChild as HTMLElement;
        const style = getComputedStyle(link);
        const artBox = art.getBoundingClientRect();

        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          width: Math.round(link.getBoundingClientRect().width),
          // What the tile has room for inside its own border and padding, read
          // off the tile rather than written down here a second time.
          room:
            link.clientWidth -
            Number.parseFloat(style.paddingLeft) -
            Number.parseFloat(style.paddingRight),
          artWidth: artBox.width,
          artHeight: artBox.height,
        };
      });

      const atWidth = `at ${String(width)} wide`;

      // Two doors across at the very least. One per row is the failure that
      // doubling the minimum without looking would have shipped.
      expect(painted.columns, `columns ${atWidth}`).toBeGreaterThanOrEqual(2);

      // And each about twice the 310 the grid used to ask for. The painted
      // width is the one somebody sees rather than the minimum: `auto-fill`
      // shares whatever is left over between the columns it managed to fit.
      expect(painted.width, `tile width ${atWidth}`).toBeGreaterThan(560);

      // The art still fills the slot it is given, and still at 16:9.
      expect(painted.artWidth, `art width ${atWidth}`).toBeCloseTo(painted.room, 0);
      expect(painted.artHeight, `art height ${atWidth}`).toBeCloseTo(
        (painted.artWidth * 9) / 16,
        0,
      );
    }

    /*
     * And `New project` is still an offer beside all that rather than a second
     * project. It is `align-self: start` and says two short things, which is
     * exactly what had to keep holding once everything around it doubled.
     */
    const offer = await page
      .getByRole('button', { name: /Start with an empty board/ })
      .boundingBox();
    const project = await tile.boundingBox();

    expect(offer?.height ?? 0).toBeLessThan((project?.height ?? 0) / 2);

    if (wasSized !== null) await page.setViewportSize(wasSized);
  });

  test('opens on the dashboard, which counts what is there rather than storing it', async () => {
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();

    await expect(page.getByRole('heading', { name: 'Production overview' })).toBeVisible();

    // A brand new project: every number is a real zero rather than a blank.
    await expect(page.getByRole('region', { name: 'Asset pipeline' })).toContainText(
      'Nothing in the library yet',
    );
    await expect(page.getByRole('region', { name: 'Milestone burndown' })).toContainText(
      'Nothing is estimated yet',
    );
  });

  test('opens the board, which came with somewhere to put work', async () => {
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();

    // Every project is given these, because a board with no lists is a board
    // nothing can be put on.
    for (const list of ['Backlog', 'In progress', 'Ready for review', 'Done']) {
      await expect(page.getByRole('region', { name: list })).toBeVisible();
    }
  });

  test('adds a card, which is given a key of its own', async () => {
    await page.getByRole('button', { name: 'New card' }).click();

    // Scoped to the dialog: every list offers its own "+ Add card" behind it.
    const form = page.getByRole('dialog', { name: 'New card' });
    await form.getByLabel('Title').fill(CARD.title);
    await form.getByRole('button', { name: 'Add card' }).click();

    await expect(form).toBeHidden();

    const card = page.getByRole('button', { name: new RegExp(CARD.title) });
    await expect(card).toBeVisible();
    // Built from the project code, the type and a number that counts from one —
    // not from a database id, which is what makes it something to say out loud.
    await expect(card).toContainText(CARD.key);
  });

  test('opens the card to be read, not to be edited', async () => {
    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const card = page.getByRole('dialog', { name: 'Card' });
    await expect(card).toBeVisible();
    await expect(card.getByText('No description provided.')).toBeVisible();

    // Nothing on a card somebody opened to look at is live until they say so.
    await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(card.getByRole('textbox', { name: 'Description' })).toHaveCount(0);

    /*
     * Except the conversation, which is live from the moment it opens.
     *
     * A comment appends rather than changes, and having something to say is
     * what reading a card leads to — so it does not wait on Edit, which would
     * arm every field on the panel to type one sentence. The section is here on
     * a card nobody has said anything on, and says that is what it is.
     */
    await expect(card.getByText('Nothing said yet.', { exact: false })).toBeVisible();

    const saying = card.getByRole('textbox', { name: 'Add a comment' });

    await expect(saying).toBeVisible();
    await saying.fill('The deck needs retopologising before this can start.');
    await card.getByRole('button', { name: 'Comment' }).click();

    await expect(
      card.getByText('The deck needs retopologising before this can start.'),
    ).toBeVisible({ timeout: 20_000 });

    // And still read-only otherwise: saying something did not arm the card.
    await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(card.getByRole('textbox', { name: 'Description' })).toHaveCount(0);
  });

  test('writes a description, and reads it back as markdown', async () => {
    const card = page.getByRole('dialog', { name: 'Card' });

    await card.getByRole('button', { name: 'Edit' }).click();
    // By role, not by label: the Raw/Preview tabs are labelled for the same
    // field and would match a plain label lookup too.
    await card.getByRole('textbox', { name: 'Description' }).fill(DESCRIPTION);
    await card.getByRole('button', { name: 'Save changes' }).click();

    await expect(card).toBeHidden();

    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const reopened = page.getByRole('dialog', { name: 'Card' });
    // A heading rather than a line beginning with a hash: this is the whole
    // round trip — typed as markdown, stored as markdown, rendered as HTML.
    await expect(reopened.getByRole('heading', { name: 'Brief' })).toBeVisible();
    await expect(reopened.getByText('over budget')).toBeVisible();
  });

  test('links one card to another, and follows the link', async () => {
    // The point of a link is that it takes you there. A row that names another
    // card and does nothing when pressed is a row people stop reading.
    await page.getByRole('dialog', { name: 'Card' }).getByRole('button', { name: 'Close' }).click();

    const form = page.getByRole('dialog', { name: 'New card' });
    await page.getByRole('button', { name: 'New card' }).click();
    await form.getByLabel('Title').fill(BLOCKER.title);
    await form.getByRole('button', { name: 'Add card' }).click();
    await expect(form).toBeHidden();

    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const card = page.getByRole('dialog', { name: 'Card' });
    await card.getByRole('button', { name: 'Edit' }).click();
    await card.getByLabel('Search for a card or asset').fill(BLOCKER.key);
    await card.getByRole('button', { name: new RegExp(BLOCKER.title) }).click();

    // The link now names the other card. Pressing it opens that card, in the
    // panel that is already open.
    await card.getByRole('button', { name: new RegExp(BLOCKER.key) }).click();

    await expect(card.getByRole('textbox', { name: 'Title' })).toHaveValue(BLOCKER.title);
  });

  test('gathers cards under a legend, and opens one from it', async () => {
    /*
     * Work arrives in clumps and there was nowhere to put the clump. The nearest
     * thing was a naming convention typed into every title, which nothing could
     * count and nothing could close.
     */
    await page.getByRole('dialog', { name: 'Card' }).getByRole('button', { name: 'Close' }).click();

    // BLOCKER becomes the legend; CARD goes under it.
    await page.getByRole('button', { name: new RegExp(BLOCKER.title) }).click();

    const legend = page.getByRole('dialog', { name: 'Card' });
    await legend.getByRole('button', { name: 'Edit' }).click();
    await legend.getByRole('button', { name: 'Make this a legend' }).click();

    /*
     * Everything below is scoped to the clump.
     *
     * The card is also in this card's Linked issues from the test before, and
     * that section has a search field of its own, so an unscoped lookup finds
     * two of everything and reads the wrong one.
     */
    const clump = legend.getByRole('region', { name: 'Gathered under this' });

    // A legend says it is one before anything is under it: a producer makes the
    // clump and fills it afterwards.
    await expect(clump).toBeVisible();
    await expect(clump.getByText('Nothing under it yet.', { exact: false })).toBeVisible();

    await clump.getByLabel('Search for a card').fill(CARD.key);
    await clump.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const gathered = clump.getByRole('button', { name: new RegExp(CARD.key) });
    await expect(gathered).toBeVisible();
    await expect(gathered).toContainText('Backlog');

    // Pressing it opens that card, in the panel that is already open.
    await gathered.click();
    await expect(legend.getByRole('textbox', { name: 'Title' })).toHaveValue(CARD.title);

    // And from the child, the legend names itself and takes you back.
    const under = legend.getByRole('region', { name: 'Legend' });
    await expect(under).toBeVisible();
    await under.getByRole('button', { name: new RegExp(BLOCKER.key) }).click();
    await expect(legend.getByRole('textbox', { name: 'Title' })).toHaveValue(BLOCKER.title);

    /*
     * On the board it is a different card, not a card with a badge.
     *
     * Checked while it is still a legend: unmaking one turns it back into an
     * ordinary chip, which is the assertion at the end of this test.
     */
    await legend.getByRole('button', { name: 'Close' }).click();

    const onTheBoard = page.getByRole('region', { name: 'Backlog' });

    await expect(onTheBoard.getByText('Legend', { exact: true })).toBeVisible();

    // The count is the answer most of the time, so it is on the shut card.
    const onTheCard = onTheBoard.getByRole('button', { name: /under this/ });

    await expect(onTheCard).toContainText('1 under this');
    await expect(onTheCard).toContainText('0 of 1 done');
    await expect(onTheCard).toHaveAttribute('aria-expanded', 'false');

    // And opening it lists what is in the clump, on the card itself.
    await onTheCard.click();
    await expect(
      onTheCard.locator('..').getByRole('button', { name: new RegExp(CARD.key) }),
    ).toBeVisible();

    /*
     * The whole card drags, not only its title.
     *
     * Dragged from the expander — a control, and the furthest thing on the card
     * from the title. The pointer sensor waits five pixels, so a press there
     * still opens the clump and a pull still picks the card up. This is the
     * regression: the drag listeners used to live on the title alone.
     */
    const before = await onTheBoard.boundingBox();
    const grip = await onTheCard.boundingBox();
    const inProgress = await page
      .getByRole('heading', { level: 2, name: 'In progress', exact: true })
      .boundingBox();

    if (before === null || grip === null || inProgress === null) {
      throw new Error('Expected the board, the legend and the target list to be on screen.');
    }

    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 12, grip.y + grip.height / 2, { steps: 4 });
    await page.mouse.move(inProgress.x + 40, inProgress.y + 80, { steps: 20 });
    // Once more where it already is: the last move is what dnd-kit measures
    // against, and a drop on the same coordinate as the previous step is one it
    // never saw arrive.
    await page.mouse.move(inProgress.x + 40, inProgress.y + 80);
    await dropAndSettle();

    await expect(
      page.getByRole('region', { name: 'In progress' }).getByText('Legend', { exact: true }),
    ).toBeVisible();

    await expect(onTheBoard.getByText('Legend', { exact: true })).toHaveCount(0);

    /*
     * A moment before pressing anything.
     *
     * `dnd-kit` suppresses the click that ends a drag, so that letting go on top
     * of a card does not also open it. Playwright's next click lands on the same
     * tick and is caught by that. Twenty-five milliseconds is enough to clear
     * it, which is why nobody using a mouse has ever seen this — moving from a
     * drop to a card takes a person the better part of a second.
     */
    await page.waitForTimeout(25);

    /*
     * Unmaking a legend lets its cards go rather than refusing. They were
     * always the real work; the grouping was the disposable half.
     *
     * Opened by its title rather than its key: the key is now on the clump row
     * too, and the board would not know which of the two was meant.
     */
    await page
      .getByRole('region', { name: 'In progress' })
      .getByRole('button', { name: new RegExp(BLOCKER.title) })
      .click();
    await legend.getByRole('button', { name: 'Edit' }).click();
    await legend.getByRole('button', { name: 'Stop being a legend' }).click();
    await expect(legend.getByRole('button', { name: 'Make this a legend' })).toBeVisible();

    // Cancel leaves edit mode. The panel stays open, because these run in order
    // and the next one opens by closing it.
    await legend.getByRole('button', { name: 'Cancel' }).click();

    // The card it gathered is still on the board behind the panel, and the
    // legend is an ordinary chip again. Only the grouping went; the cards were
    // always the real work.
    await expect(
      page.getByRole('region', { name: 'Backlog' }).getByRole('button', { name: CARD.key }),
    ).toBeVisible();
    await expect(page.getByText('Legend', { exact: true })).toHaveCount(0);
  });

  test('moves around the project from the sidebar', async () => {
    // Every screen used to carry its own set of links to the others, which is
    // how a product ends up with a different way of getting to the same place
    // from every page.
    await page.getByRole('dialog', { name: 'Card' }).getByRole('button', { name: 'Close' }).click();

    const sidebar = page.getByRole('navigation', { name: 'Project' });

    await sidebar.getByRole('link', { name: 'Assets' }).click();
    await expect(page.getByRole('button', { name: 'New category' })).toBeVisible();

    await sidebar.getByRole('link', { name: 'Settings' }).click();
    // Exactly: the panel groups the teams on the project under a heading of
    // their own, and an accessible name matches on a substring.
    await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();

    // A logo is a fact about the project like its name, so it is set on the
    // same form. What the sidebar draws with it waits for the worker to resize
    // it; that the project took it does not.
    await page.getByLabel('Logo').setInputFiles({
      name: 'saltmarsh-logo.png',
      mimeType: 'image/png',
      buffer: PIXEL,
    });
    await expect(page.getByText('Logo set.')).toBeVisible();

    await sidebar.getByRole('link', { name: 'Tasks' }).click();
    await expect(page.getByRole('region', { name: 'Backlog' })).toBeVisible();

    await sidebar.getByRole('link', { name: 'Timeline' }).click();
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();

    await sidebar.getByRole('link', { name: 'Budget' }).click();
    await expect(page.getByRole('heading', { name: 'Budget', level: 1 })).toBeVisible();

    await sidebar.getByRole('link', { name: 'Design doc' }).click();
    await expect(page.getByText('No documents yet.', { exact: false })).toBeVisible();

    await sidebar.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Production overview' })).toBeVisible();

    // And back out to every project, which the sidebar also carries.
    await sidebar.getByRole('link', { name: 'Switch project' }).click();
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible();
  });

  test('deletes a card, and says it can be had back', async () => {
    /*
     * The one thing a board could not do.
     *
     * Closing a card takes it off the board and leaves its key resolving, which
     * is right for work that finished and wrong for work that never was. A
     * duplicate off a sync or a line typed into the wrong project stayed there
     * for good.
     */
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();

    await page.getByRole('button', { name: 'New card' }).click();

    const form = page.getByRole('dialog', { name: 'New card' });
    await form.getByLabel('Title').fill(MISTAKE);
    await form.getByRole('button', { name: 'Add card' }).click();
    await expect(form).toBeHidden();

    await page.getByRole('button', { name: new RegExp(MISTAKE) }).click();

    const card = page.getByRole('dialog', { name: 'Card' });
    await card.getByRole('button', { name: 'Delete card' }).click();

    // Named by its key, because that is what somebody would repeat back — and
    // the consequence says both halves: what goes, and that there is a way out.
    const confirm = page.getByRole('dialog', { name: /^Delete SLTM-TASK-\d+\?$/ });
    await expect(confirm).toContainText('Nothing else is on it.');
    await expect(confirm).toContainText('waits a week in the bin');
    await confirm.getByRole('button', { name: 'Delete' }).click();

    // The panel closes rather than sitting there over a card that has gone.
    await expect(card).toBeHidden();
    await expect(page.getByRole('button', { name: new RegExp(MISTAKE) })).toHaveCount(0, {
      timeout: 20_000,
    });
  });

  test('moves a card along the board from its own panel', async () => {
    // The same move dragging makes, from the panel — and it takes effect without
    // a trip through Edit, because dragging asks nothing first either.
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();
    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const card = page.getByRole('dialog', { name: 'Card' });
    const lists = card.getByRole('group', { name: 'List' });

    await expect(lists.getByRole('button', { name: 'Backlog' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await lists.getByRole('button', { name: 'In progress' }).click();

    await expect(lists.getByRole('button', { name: 'In progress' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await card.getByRole('button', { name: 'Close' }).click();

    // And the board behind it agrees, rather than the panel being the only
    // place that knows.
    await expect(
      page.getByRole('region', { name: 'In progress' }).getByRole('button', {
        name: new RegExp(CARD.title),
      }),
    ).toBeVisible();
  });

  test('narrows the sidebar to its icons, and still gets everywhere', async () => {
    // From the launcher rather than from wherever the step before ended: the
    // sidebar only exists inside a project, and which screen the last step
    // finished on is not this one's business.
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();

    const sidebar = page.getByRole('navigation', { name: 'Project' });
    const toggle = sidebar.getByRole('button', { name: 'Sidebar' });

    const wide = (await sidebar.boundingBox())?.width ?? 0;

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Polled rather than measured once: the width is animated, so the first
    // frame after the click is somewhere between the two.
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? wide).toBeLessThan(wide);

    // The words are clipped rather than removed, so the links keep the names a
    // screen reader announces them by — and the nav is as usable narrow as wide.
    await sidebar.getByRole('link', { name: 'Assets' }).click();
    await expect(page.getByRole('button', { name: 'New category' })).toBeVisible();

    // And it stays narrow across a screen, because somebody who collapsed it
    // wanted it collapsed.
    await expect(sidebar).toHaveAttribute('class', /Collapsed/);

    // Everything in the strip sits on one axis. Measured rather than eyeballed,
    // because the thing that broke it last time was two pixels of border on the
    // nav items that nothing else carried.
    const centres = await sidebar.evaluate((nav) =>
      [
        ...nav.querySelectorAll(
          '[class*="navIcon"], [class*="collapse"], [class*="avatar"], [class*="projectMark"]',
        ),
      ].map((element) => {
        const box = element.getBoundingClientRect();

        return Math.round(box.left + box.width / 2);
      }),
    );

    // Exactly, not nearly. A pixel is precisely what two pixels of border on
    // the nav items and none on anything else came to.
    expect(Math.max(...centres) - Math.min(...centres)).toBe(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('gathers a sheet of reference images on one asset', async () => {
    // The thing the library is for: an asset is not a row with a picture beside
    // it, it is a thing being made, and what accumulates on it is a sheet.
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Assets' })
      .click();

    await page.getByRole('button', { name: 'New category' }).click();

    const category = page.getByRole('dialog', { name: 'New category' });
    await category.getByLabel('Name').fill(CATEGORY);
    await category.getByRole('button', { name: 'Add category' }).click();

    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const newAsset = page.getByRole('dialog', { name: 'New asset' });
    await newAsset.getByLabel('Asset name').fill(ASSET);
    await newAsset.getByRole('button', { name: 'Add asset' }).click();

    await page.getByRole('button', { name: new RegExp(ASSET) }).click();

    const panel = page.getByRole('dialog', { name: 'Asset' });

    await expect(panel.getByText('no reference images yet')).toBeVisible();

    // Three at once, because that is how reference arrives: somebody finishes a
    // pass and has a handful of images, not one.
    await panel.getByLabel('Reference images').setInputFiles(
      ['silhouette.png', 'colour-keys.png', 'scale-ref.png'].map((name) => ({
        name,
        mimeType: 'image/png',
        buffer: PIXEL,
      })),
    );

    // The first is the one the library draws, so which one it is has to be
    // visible from in here.
    const thumbnails = panel.getByRole('button', { name: /silhouette|colour-keys|scale-ref/ });
    await expect(thumbnails).toHaveCount(3);
    await expect(panel.getByText('thumbnail', { exact: true })).toBeVisible();

    // Drawn straight away, without waiting for the worker to make a thumbnail
    // and without closing and reopening the panel.
    await expect(thumbnails.first().getByRole('img')).toBeVisible();

    /**
     * The tile a picture sits in, which holds both the picture and its offer.
     *
     * The `has` locator is rooted at the page rather than at the panel, because
     * Playwright re-queries it inside each candidate and a path that starts at
     * the dialog matches nothing inside a list item.
     */
    const tileFor = (name: RegExp): Locator =>
      panel.getByRole('listitem').filter({ has: page.getByRole('button', { name }) });

    // The offer sits in the corner of the picture it is about, so it says which
    // one it would affect without anybody working out that it means whichever
    // is currently in the frame.
    await tileFor(/colour-keys/).hover();
    await tileFor(/colour-keys/)
      .getByRole('button', { name: 'make thumbnail' })
      .click();

    await expect(thumbnails.first()).toHaveAccessibleName(/colour-keys/);

    // The one it displaced now carries the offer, and the one that took its
    // place no longer does: a picture cannot be promoted to where it already is.
    await expect(tileFor(/silhouette/).getByRole('button', { name: 'make thumbnail' })).toHaveCount(
      1,
    );
    await expect(
      tileFor(/colour-keys/).getByRole('button', { name: 'make thumbnail' }),
    ).toHaveCount(0);

    /*
     * A screenshot, straight onto the sheet.
     *
     * Half of what ends up on a reference sheet was never a file. The listener
     * is on the document rather than on the rectangle, because a paste goes to
     * whatever has focus and nobody clicks a panel before pressing Ctrl+V —
     * which is why this dispatches on the document rather than on the sheet.
     */
    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const data = new DataTransfer();

      data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    }, PIXEL.toString('base64'));

    await expect(panel.getByRole('button', { name: /pasted/ })).toBeVisible();

    // Said once, on the other side of the panel. The sheet used to count itself
    // as well, which was two places for one number to be wrong in.
    await expect(panel.getByText('Reference images')).toBeVisible();

    // A source file dropped here is left out and named, rather than becoming a
    // tile with a filename on it where the asset's thumbnail should be.
    await panel.getByLabel('Reference images').setInputFiles({
      name: 'watchtower_hi.blend',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(512, 1),
    });

    // Said by the display rather than as a line of text under the strip, and
    // reachable from over an open dialog — which is the whole reason it is
    // rendered into the dialog rather than beside it.
    const problem = page.getByRole('alert');

    await expect(problem).toContainText(
      'watchtower_hi.blend was not an image, other file types must be placed in the files tab',
    );
    await expect(thumbnails).toHaveCount(3);

    // And it goes when told to, rather than sitting over the panel.
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(problem).toBeHidden();

    await panel.getByRole('button', { name: 'Close' }).click();

    // And the tile behind it counts them, rather than the panel being the only
    // place that knows. Four: the three uploaded and the one pasted, with the
    // source file left out.
    await expect(page.getByRole('button', { name: new RegExp(ASSET) })).toContainText('4 refs');
  });

  test('keeps the working files of an asset, uploaded or linked', async () => {
    // The other half of the library: reference is what a thing looks like, and
    // this is what it is made of. A studio with a depot keeps the source there,
    // so both have to be first class.
    await page.getByRole('button', { name: new RegExp(ASSET) }).click();

    const panel = page.getByRole('dialog', { name: 'Asset' });
    const files = panel.getByRole('region', { name: 'Files' });

    await expect(files.getByText(/Nothing yet/)).toBeVisible();

    await files.getByLabel('Upload files').setInputFiles({
      name: 'watchtower_hi.blend',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(2048, 7),
    });

    // A file with no picture in it, held whole rather than turned into a
    // thumbnail somebody would then be unable to open.
    await expect(files.getByRole('link', { name: 'watchtower_hi.blend' })).toBeVisible();
    await expect(files.getByText('2 KB')).toBeVisible();

    await files.getByRole('button', { name: 'Add link' }).click();
    await files.getByLabel('What it is').fill('Substance graph');
    await files.getByLabel('Where it lives').fill('https://depot.example.test/watchtower.sbs');
    await files.getByRole('button', { name: 'Add', exact: true }).click();

    const linked = files.getByRole('link', { name: 'Substance graph' });

    await expect(linked).toHaveAttribute('href', 'https://depot.example.test/watchtower.sbs');
    await expect(files.getByText('linked')).toBeVisible();

    // The pictures are a separate list, and adding a source file did not join
    // them — which is the whole reason there are two.
    await expect(
      panel.getByRole('button', { name: /silhouette|colour-keys|scale-ref/ }),
    ).toHaveCount(3);

    await panel.getByRole('button', { name: 'Close' }).click();
  });

  test('files an asset under a word, and shows it on the tile', async () => {
    // What a category cannot say: there is one of those and it says what kind
    // of thing something is, while a tag says anything else worth finding it by.
    await page.getByRole('button', { name: new RegExp(ASSET) }).click();

    const panel = page.getByRole('dialog', { name: 'Asset' });

    // Named the way a ticket is, so it can be said out loud and pasted back
    // into the search.
    await expect(panel.getByText(`${PROJECT.code}-AST-1`)).toBeVisible();

    const tags = panel.getByRole('region', { name: 'Tags' });

    await tags.getByRole('button', { name: 'Add tag' }).click();

    // Typed as somebody would, stored as one tag: `Act 1` and `act-1` are the
    // same word and a library where they are two is a library that hides half
    // of itself.
    await tags.getByLabel('New tag').fill('Act 1');
    await tags.getByLabel('New tag').press('Enter');

    await expect(tags.getByText('act-1')).toBeVisible();

    await tags.getByLabel('New tag').fill('modular');
    await tags.getByLabel('New tag').press('Enter');

    await panel.getByRole('button', { name: 'Close' }).click();

    // On the tile, which is where somebody scanning for everything in act one
    // is looking.
    const tile = page.getByRole('button', { name: new RegExp(ASSET) });

    await expect(tile).toContainText('act-1');
    await expect(tile).toContainText('modular');

    // And off again.
    await tile.click();
    await tags.getByRole('button', { name: 'Remove act-1' }).click();
    await expect(tags.getByText('act-1')).toBeHidden();
    await panel.getByRole('button', { name: 'Close' }).click();
  });

  test('breaks an asset into the stages it is made in, and counts them on the tile', async () => {
    // What the status cannot say: `wip` is one word for the whole thing, and an
    // asset at `wip` might have a finished mesh and no textures, or the reverse.
    await page.getByRole('button', { name: new RegExp(ASSET) }).click();

    const panel = page.getByRole('dialog', { name: 'Asset' });
    const stages = panel.getByRole('region', { name: 'Stages' });

    await stages.getByRole('button', { name: 'Add stage' }).click();

    // The field stays open between stages: somebody adding Mesh is adding UV
    // straight after, and reopening it each time is three extra presses. Each
    // one is waited for before the next is typed, which is what a person does
    // anyway — the field clears itself once the stage is really there.
    await stages.getByLabel('New stage').fill('Mesh');
    await stages.getByLabel('New stage').press('Enter');
    await expect(stages.getByText('Mesh')).toBeVisible();

    await stages.getByLabel('New stage').fill('Texture');
    await stages.getByLabel('New stage').press('Enter');
    await expect(stages.getByText('Texture')).toBeVisible();

    await expect(stages.getByText('0/2')).toBeVisible();

    // Ticked off where somebody is already looking, without a trip through Edit
    // — and it stays ticked rather than snapping back while the server answers.
    //
    // `click` and then assert, rather than `check`, which verifies the box the
    // instant it has pressed it. This one is a controlled input whose state
    // arrives with the answer, so the assertion is the thing that has to wait.
    const mesh = stages.getByRole('checkbox', { name: 'Mesh' });

    await mesh.click();
    await expect(mesh).toBeChecked();
    await expect(stages.getByText('1/2')).toBeVisible();

    await panel.getByRole('button', { name: 'Close' }).click();

    // On the tile, which is the whole reason to write the stages down: which of
    // forty assets are nearly there, without opening any of them.
    const tile = page.getByRole('button', { name: new RegExp(ASSET) });

    await expect(tile).toContainText('1/2');

    // And off again, leaving the library as the rest of these tests found it. A
    // stage is a working note with nowhere to be got back from, so each one is
    // asked about first.
    await tile.click();

    for (const name of ['Mesh', 'Texture']) {
      await stages.getByRole('button', { name: `Remove ${name}` }).click();
      await page
        .getByRole('dialog', { name: `Remove ${name}?` })
        .getByRole('button', { name: 'Remove' })
        .click();
      await expect(stages.getByText(name)).toBeHidden();
    }

    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(tile).not.toContainText('/2');
  });

  test('drags an asset into the order it should be in', async () => {
    /*
     * A library is a running order as much as a list — the hero prop first, the
     * thing nobody has started at the bottom. Until this, the only order was the
     * one things were made in.
     *
     * Driven the way the board's drag is: a few pixels first, because the
     * pointer sensor waits before a drag begins at all and a press without that
     * travel is a click that opens the asset instead.
     */
    await page.getByRole('button', { name: 'New category' }).click();

    const made = page.getByRole('dialog', { name: 'New category' });

    await made.getByLabel('Name').fill('Set dressing');
    await made.getByRole('button', { name: 'Add category' }).click();
    await expect(made).toBeHidden();

    const dressing = page.locator('section', {
      has: page.getByRole('button', { name: /Set dressing/ }),
    });

    // Both of them open, because the library draws categories closed and a drag
    // is measured: the tile being carried and the place it is going both have to
    // be on screen to have a box at all.
    await openCategory(new RegExp(CATEGORY));
    await openCategory(/Set dressing/);

    // Nothing in it yet, which is one of the two drops that has no asset under
    // the pointer to land on.
    await expect(dressing.getByText('Nothing in this category yet.')).toBeVisible();

    const carried = page.getByRole('button', { name: new RegExp(ASSET) });
    /*
     * Where it came from, pinned by id before it is moved.
     *
     * A locator that filters on "the section holding this asset" is live, so
     * the moment the asset lands somewhere else it starts naming the category
     * it went to. The id is the one thing about the category that does not move.
     */
    const homeId = await page.locator('section', { has: carried }).getAttribute('id');
    const home = page.locator(`[id="${homeId ?? ''}"]`);
    const from = await carried.boundingBox();
    const onto = await dressing.getByText('Nothing in this category yet.').boundingBox();

    if (from === null || onto === null) {
      throw new Error('Expected the asset and the category to drag it into to be on screen.');
    }

    await page.mouse.move(from.x + from.width / 2, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + 20, { steps: 4 });
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 20 });
    // Once more where it already is: the last move is what dnd-kit measures
    // against, and a drop on the same coordinate as the previous step is one it
    // never saw arrive.
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2);

    /*
     * Already there, with the mouse still held down.
     *
     * The tile moves as the pointer travels rather than at the moment it is let
     * go, which is what the board does and what the tiles stepping aside are
     * making room for. Waiting for the drop meant the release was drawn in two
     * parts — the overlay gone, and the tile still in the place it came from
     * until the next render moved it. That is the flash of the thumbnail in its
     * old spot, and it cannot happen if there is nothing left to move.
     */
    await expect(dressing.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();
    await expect(home.getByRole('button', { name: new RegExp(ASSET) })).toBeHidden();

    await dropAndSettle();

    await expect(dressing.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();

    /*
     * Reloaded, which is the half that matters.
     *
     * The screen is rewritten as the asset travels, so it showing the new place
     * proves only that the drag was drawn. Asking the server again is what says
     * the position was stored.
     */
    await page.reload();

    // Which draws them closed again: what was open was state on the screen, and
    // reloading is exactly the act of throwing that away.
    await openCategory(new RegExp(CATEGORY));
    await openCategory(/Set dressing/);

    await expect(dressing.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();

    /*
     * And back where it started.
     *
     * Two things at once. Dragging the other way is where an off-by-one hides —
     * a placement that is right in one direction and out by one in the other is
     * the classic way this goes wrong. And the journey is one install carried
     * from test to test, so a test that moves something and leaves it moved is
     * a test that breaks a later one about the category it emptied.
     */
    const back = await dressing.getByRole('button', { name: new RegExp(ASSET) }).boundingBox();
    const empty = await home.getByText('Nothing in this category yet.').boundingBox();

    if (back === null || empty === null) {
      throw new Error('Expected the moved asset and the category it left to be on screen.');
    }

    await page.mouse.move(back.x + back.width / 2, back.y + 20);
    await page.mouse.down();
    await page.mouse.move(back.x + back.width / 2 + 12, back.y + 20, { steps: 4 });
    await page.mouse.move(empty.x + empty.width / 2, empty.y + empty.height / 2, { steps: 20 });
    await page.mouse.move(empty.x + empty.width / 2, empty.y + empty.height / 2);
    await dropAndSettle();

    await expect(home.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();
    await expect(dressing.getByText('Nothing in this category yet.')).toBeVisible();

    // And the category this test made goes with it. The journey is one install
    // carried from test to test, and a later one reaches for a category by
    // position — an extra one left lying about moves what `nth` finds.
    await dressing.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete Set dressing?' })
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByRole('button', { name: /Set dressing/ })).toHaveCount(0);
  });

  test('does not call a category empty when there are categories inside it', async () => {
    /*
     * A category holding only categories said "Nothing filed directly in this
     * one" underneath them, which read as though it held nothing. That line was
     * also the space the first asset was dropped into, so taking it away has to
     * leave somewhere to drop — the heading.
     */
    const made = page.getByRole('dialog', { name: 'New category' });

    await page.getByRole('button', { name: 'New category' }).click();
    await made.getByLabel('Name').fill('Set dressing');
    await made.getByRole('button', { name: 'Add category' }).click();
    await expect(made).toBeHidden();

    await page.getByRole('button', { name: 'New category' }).click();
    await made.getByLabel('Name').fill('Clutter');
    await made.getByLabel('Inside').selectOption({ label: 'Set dressing' });
    await made.getByRole('button', { name: 'Add category' }).click();
    await expect(made).toBeHidden();

    const dressing = page.locator('section', {
      has: page.getByRole('button', { name: /Set dressing/ }),
    });

    await openCategory(/Set dressing/);

    // Open and showing what it holds first, so the missing line means something
    // rather than being what a closed category looks like.
    await expect(categoryHeading(/Clutter/)).toBeVisible();
    // Whatever the wording: any line starting "Nothing" is the one being asked
    // about.
    await expect(dressing.getByText(/^Nothing/)).toHaveCount(0);

    await openCategory(new RegExp(CATEGORY));
    await dragTileOntoHeading(
      page.getByRole('button', { name: new RegExp(ASSET) }),
      categoryHeading(/Set dressing/),
    );

    // Into the heading it was dropped on, not into the category inside it.
    await expect(dressing.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();
    await expect(categoryHeading(/Clutter/)).toContainText('(0 items)');

    /*
     * Reloaded, so the server is what says where it went.
     *
     * Clutter is drawn closed again, so an asset showing under Set dressing is
     * one filed in Set dressing itself.
     */
    await page.reload();
    await openCategory(/Set dressing/);

    await expect(dressing.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();
    await expect(categoryHeading(/Clutter/)).toContainText('(0 items)');

    // And back where it started, because the journey is one install carried
    // from test to test and a later one renames this asset's category.
    await openCategory(new RegExp(CATEGORY));
    await dragTileOntoHeading(
      dressing.getByRole('button', { name: new RegExp(ASSET) }),
      categoryHeading(new RegExp(CATEGORY)),
    );

    await expect(
      page
        .locator('section', { has: page.getByRole('button', { name: new RegExp(CATEGORY) }) })
        .getByRole('button', { name: new RegExp(ASSET) }),
    ).toBeVisible();

    await deleteCategory('Clutter');

    // With nothing in it at all, it does say so.
    await expect(dressing.getByText('Nothing in this category yet.')).toBeVisible();

    await deleteCategory('Set dressing');
  });

  test('narrows the library by a word and by a tag', async () => {
    // A second asset in a second category, so there is something for a filter
    // to leave out.
    await page.getByRole('button', { name: 'New category' }).click();

    const category = page.getByRole('dialog', { name: 'New category' });
    await category.getByLabel('Name').fill('World Bosses');
    await category.getByRole('button', { name: 'Add category' }).click();

    await page.getByRole('button', { name: 'Add', exact: true }).nth(1).click();

    const newAsset = page.getByRole('dialog', { name: 'New asset' });
    await newAsset.getByLabel('Asset name').fill('Tidewrought Leviathan');
    await newAsset.getByRole('button', { name: 'Add asset' }).click();

    await expect(page.getByRole('button', { name: /Tidewrought/ })).toBeVisible();

    // Searching leaves the other one out — and the heading it was under with
    // it, because eight empty headings are what stands between a search and
    // its answer.
    await page.getByLabel('Search assets').fill('watchtower');

    await expect(page.getByRole('button', { name: /Tidewrought/ })).toBeHidden();
    await expect(page.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();
    await expect(page.getByRole('button', { name: /World Bosses/ })).toBeHidden();

    // And the header still knows how big the library really is.
    await expect(page.getByText('1 of 2 assets')).toBeVisible();

    await page.getByLabel('Search assets').fill('');

    // A search opens what it narrowed to, so the answer is not hidden under the
    // heading that matched. Clearing it puts that back the way it was, and the
    // category has to be opened by hand again.
    await openCategory(/World Bosses/);
    await expect(page.getByRole('button', { name: /Tidewrought/ })).toBeVisible();

    // The tag put on the asset earlier narrows the same way, from the panel.
    await page.getByRole('button', { name: /^Filters/ }).click();

    const filters = page.getByRole('region', { name: 'Filters' });
    await filters.getByRole('button', { name: 'modular' }).click();

    await expect(page.getByRole('button', { name: /Tidewrought/ })).toBeHidden();
    await expect(page.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();

    // A filter that matches nothing says so, and offers the way out. Nothing
    // here is Final, and tags are combined with AND.
    await filters.getByRole('button', { name: 'Final' }).click();
    await expect(page.getByText('No assets match these filters')).toBeVisible();

    await page.getByRole('button', { name: 'Clear all filters' }).click();

    await openCategory(/World Bosses/);
    await expect(page.getByRole('button', { name: /Tidewrought/ })).toBeVisible();
  });

  test('edits a category, then deletes it without losing what it held', async () => {
    const heading = categoryHeading(new RegExp(CATEGORY));

    await heading.locator('..').getByRole('button', { name: 'Edit' }).click();

    const edit = page.getByRole('dialog', { name: 'Edit category' });
    await edit.getByLabel('Name').fill('Props');
    await edit.getByRole('button', { name: 'Save changes' }).click();

    // Renaming moves nothing: the asset is still under the same heading.
    const renamed = categoryHeading(/Props/);
    await expect(renamed).toBeVisible();

    await openCategory(/Props/);
    await expect(page.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();

    await renamed.locator('..').getByRole('button', { name: 'Delete' }).click();

    // The dialog is named by the question it asks, which names the thing —
    // one shared confirmation, not a bespoke one per screen.
    const confirm = page.getByRole('dialog', { name: 'Delete Props?' });

    // It says what happens, because a confirmation that only says "are you
    // sure" is one people learn to click through.
    await expect(confirm).toContainText('Unorganised');
    await confirm.getByRole('button', { name: 'Delete' }).click();

    // The heading is gone and the asset is not: a category is how a studio
    // files things, and refiling is not throwing away. Under a heading that did
    // not exist a moment ago, so it is closed like any other.
    await expect(categoryHeading(/Unorganised/)).toBeVisible();

    await openCategory(/Unorganised/);
    await expect(page.getByRole('button', { name: new RegExp(ASSET) })).toBeVisible();
  });

  test('finds a category from the sidebar, and counts what a project holds', async () => {
    const sidebar = page.getByRole('navigation', { name: 'Project' });

    // The badge counts the library, and it is right while somebody is looking
    // at the board — which is the whole reason the sidebar asks for itself.
    await expect(sidebar.getByRole('link', { name: /Assets/ })).toContainText('2');

    await sidebar.getByRole('link', { name: 'Tasks' }).click();
    await expect(page.getByRole('region', { name: 'Backlog' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /Assets/ })).toContainText('2');

    // The badge follows you; the tree does not. A list of the library's
    // headings beside the task board is a list of places that are not on the
    // screen you are looking at.
    await expect(sidebar.getByRole('link', { name: /World Bosses/ })).toBeHidden();

    await sidebar.getByRole('link', { name: /Assets/ }).click();
    await expect(page.getByRole('button', { name: 'New category' })).toBeVisible();

    // Back on the library, the tree is its table of contents: pressing a
    // heading in it goes to that heading.
    await sidebar.getByRole('link', { name: /World Bosses/ }).click();

    await expect(page.getByRole('button', { name: /Tidewrought/ })).toBeVisible();
    expect(page.url()).toContain('category-');

    // And it goes with the words when the sidebar narrows: a tree of headings
    // with no headings on it is a column of anonymous squares.
    const toggle = sidebar.getByRole('button', { name: 'Sidebar' });

    await toggle.click();
    await expect(sidebar.getByRole('link', { name: /World Bosses/ })).toBeHidden();

    await toggle.click();
    await expect(sidebar.getByRole('link', { name: /World Bosses/ })).toBeVisible();
  });

  test('gives a linked asset room for the words the studio actually used', async () => {
    /*
     * The label column was a fixed seventy-six pixels, taken from the short end
     * of what goes in it. `BLOCKED BY` did not fit, and neither does a category
     * a studio named themselves: `World Bosses` broke over two lines and
     * shunted the asset's name off its own baseline.
     *
     * Only a browser can answer this: nothing about the markup is wrong, and
     * the wrap is a fact about the box the text landed in.
     */
    const sidebar = page.getByRole('navigation', { name: 'Project' });

    await sidebar.getByRole('link', { name: 'Tasks' }).click();
    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const card = page.getByRole('dialog', { name: 'Card' });

    await card.getByRole('button', { name: 'Edit' }).click();
    await card.getByLabel('Search for a card or asset').fill('Tidewrought');
    await card.getByRole('button', { name: /Tidewrought/ }).click();

    // Scoped to what is on the card, not to what the search is still offering:
    // both draw a category beside an asset name.
    const row = card
      .getByRole('region', { name: 'Linked assets' })
      .getByRole('button', { name: /Tidewrought/ });
    const label = row.getByText('World Bosses');

    // In full, rather than cut off at an ellipsis: the cap is there to stop a
    // label eating the name beside it, not to trim ordinary words.
    await expect(label).toHaveText('World Bosses');

    /*
     * And it fits the box it is in, which is the whole question.
     *
     * Asked as `scrollWidth` against `clientWidth` because a column that is too
     * narrow fails in two different ways and this is the one thing true of
     * both: two words break over two lines, and a single long word has nowhere
     * to break and overflows sideways instead. A height check would only ever
     * have caught the first.
     */
    const fits = await label.evaluate((node) => ({
      needed: node.scrollWidth,
      given: node.clientWidth,
      lines: Math.round(node.getBoundingClientRect().height),
    }));

    expect(fits.needed).toBeLessThanOrEqual(fits.given);

    // One line of it, which is the other half: a label that wrapped would be
    // taller than the name beside it, and the name is set larger.
    const nameHeight = await row
      .getByText('Tidewrought Leviathan')
      .evaluate((node) => Math.round(node.getBoundingClientRect().height));

    expect(fits.lines).toBeLessThanOrEqual(nameHeight);

    await card.getByRole('button', { name: 'Cancel' }).click();
    await card.getByRole('button', { name: 'Close' }).click();

    // Back where the step before this one was standing. The journey is a
    // sequence and this test borrowed the board from the middle of it.
    await sidebar.getByRole('link', { name: /Assets/ }).click();
    await expect(page.getByRole('button', { name: 'New category' })).toBeVisible();
  });

  test('keeps a second tab in step with the first', async () => {
    // The one thing no unit test can answer: whether the socket, the scope it
    // names and the refetch behind it add up to a library that keeps up.
    const second = await context.newPage();

    await second.goto('/');
    await second.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await second
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Assets' })
      .click();
    await expect(second.getByRole('button', { name: 'New category' })).toBeVisible();

    // Made in the first tab, and never asked for by the second.
    await page.getByRole('button', { name: 'New category' }).click();

    const dialog = page.getByRole('dialog', { name: 'New category' });
    await dialog.getByLabel('Name').fill('Audio — SFX');
    await dialog.getByRole('button', { name: 'Add category' }).click();

    await expect(categoryHeading(/Audio/)).toBeVisible();
    await expect(categoryHeading(/Audio/, second)).toBeVisible();

    await second.close();
  });

  test('plans a fortnight against the day everybody has', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();

    const sidebar = page.getByRole('navigation', { name: 'Project' });
    await sidebar.getByRole('link', { name: 'Timeline' }).click();

    // A whole day each, which is what everybody has until the hours move to a
    // person's own profile. Nothing on the project sets them any more.
    await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByText('8h a day team capacity')).toBeVisible();

    // Everybody has a row, including the people with nothing dated on them: a
    // chart of only the busy half of a team cannot show who is free.
    await expect(page.getByRole('button', { name: new RegExp(STUDIO.owner) })).toBeVisible();

    // The same fortnight, cut by what the work was promised for. This project
    // has no dates yet, and the screen says so rather than drawing nothing.
    await page.getByRole('radio', { name: 'By milestone' }).click();
    await expect(page.getByText('No milestone lands in this fortnight')).toBeVisible();

    // And cut by the teams on it. There are none, so everybody here arrived by
    // name — which is a row of its own rather than an empty chart, because they
    // are on the project and doing the work whatever the staffing says.
    await page.getByRole('radio', { name: 'By team' }).click();
    await expect(page.getByRole('button', { name: /No team/ })).toBeVisible();
  });

  test('records what the project shipped, and reads it back', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Builds' })
      .click();

    /*
     * A project with no repository connected is not told about one: nothing
     * naming a repository in the facts, and no sync button — one that fails on
     * press is worse than one that is not there. The board says nothing in the
     * same state, which is why this page stopped saying `Entered by hand`.
     */
    await expect(page.getByRole('button', { name: 'Sync releases' })).toHaveCount(0);
    await expect(page.getByText(/synced/)).toHaveCount(0);

    // A project that has shipped nothing says so rather than drawing an empty
    // panel with headings over it.
    await expect(page.getByText('Nothing shipped yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Record a release' }).click();

    const form = page.getByRole('dialog', { name: 'Record a release' });

    await form.getByLabel('Tag').fill('v0.9.4');
    await form.getByLabel('Published', { exact: true }).fill('2026-08-14');
    await form.getByLabel('Name').fill('Vertical slice');
    await form.getByLabel('Published by').fill('build-bot');
    await form.getByLabel('Commit').fill('4f2ac91');
    await form.getByLabel('Pre-release').check();
    await form
      .getByLabel('What changed')
      .fill(['## Added', '', '- Tier-3 weapon set'].join(String.fromCharCode(10)));

    /*
     * A size typed the way it is said.
     *
     * Nobody types a byte count for a game build, so the box takes `4.2 GB`
     * and the product does the arithmetic — and says what it understood
     * before anything is saved.
     */
    await form.getByRole('button', { name: '+ Add a download' }).click();
    await form.getByLabel('File').fill('Leviathan-win64.zip');
    await form.getByLabel('Size').fill('4.2 GB');
    await form.getByLabel('Downloads').fill('38');
    // Where the file is, which is the one thing a builds page exists to hand
    // over. Optional, so the row below checks what happens without it too.
    await form.getByLabel('Where it is').fill('https://builds.northwind.test/win64.zip');

    await form.getByRole('button', { name: 'Record it' }).click();

    /*
     * Waited for, rather than assumed.
     *
     * The dialog holds a `Pre-release` checkbox and the panel behind it holds a
     * `pre-release` chip, and `getByText` matches loosely enough to find both.
     * Asserting while the dialog was still closing found two elements and
     * failed on strict mode — on a slower machine than the one it was written
     * on, which is the only reason it passed here at all.
     */
    await expect(form).toBeHidden();

    // Scoped to the panel, so what is being read is the release rather than
    // anything else on the page that happens to share a word with it.
    const latest = page.getByRole('region', { name: 'Latest release v0.9.4' });

    // The tag reads largest: it is what somebody says out loud when they ask
    // which build a bug was found on.
    await expect(latest).toContainText('v0.9.4');
    await expect(latest).toContainText('pre-release');

    // The notes read as markdown rather than as the characters that were typed.
    await expect(latest.getByRole('heading', { name: 'Added' })).toBeVisible();
    await expect(latest).toContainText('Tier-3 weapon set');

    // The size comes back in the unit it was typed in, having been stored as
    // bytes in between.
    await expect(latest).toContainText('Leviathan-win64.zip');
    await expect(latest).toContainText('4.2 GB');

    /*
     * The one thing this page is for.
     *
     * The arrow used to be a unit on the download count and pressed nothing, so
     * a page listing a build could not hand it over. It is a link now, and it
     * points where the release says the file is.
     */
    const getIt = latest.getByRole('link', { name: 'Download Leviathan-win64.zip' });

    await expect(getIt).toHaveAttribute('href', 'https://builds.northwind.test/win64.zip');
    // `download` asks the browser to save rather than navigate away from the app.
    await expect(getIt).toHaveAttribute('download', '');

    // A second one takes the headline, and the first drops into the history.
    await page.getByRole('button', { name: 'Record a release' }).click();

    const second = page.getByRole('dialog', { name: 'Record a release' });

    await second.getByLabel('Tag').fill('v1.0.0');
    await second.getByLabel('Published', { exact: true }).fill('2026-08-20');
    await second.getByLabel('Name').fill('Launch');
    await second.getByLabel('Published by').fill('build-bot');
    await second.getByRole('button', { name: 'Record it' }).click();
    await expect(second).toBeHidden();

    const history = page.getByRole('region', { name: 'Earlier releases' });

    await expect(page.getByRole('region', { name: 'Latest release v1.0.0' })).toBeVisible();
    await expect(history.getByText('v0.9.4')).toBeVisible();

    // A row's controls are marks now rather than words, and still say what they
    // do — which is what a screen reader reads and what a hover shows.
    await expect(history.getByRole('button', { name: 'Edit v0.9.4' })).toBeVisible();
    await expect(history.getByRole('button', { name: 'Delete v0.9.4' })).toBeVisible();

    // Recording the same tag twice is refused in a sentence, because a project
    // with two v1.0.0s is one where nobody can say which build somebody has.
    await page.getByRole('button', { name: 'Record a release' }).click();

    const clash = page.getByRole('dialog', { name: 'Record a release' });

    await clash.getByLabel('Tag').fill('v1.0.0');
    await clash.getByLabel('Published', { exact: true }).fill('2026-08-21');
    await clash.getByLabel('Name').fill('Launch again');
    await clash.getByLabel('Published by').fill('build-bot');
    await clash.getByRole('button', { name: 'Record it' }).click();

    await expect(page.getByText(/already has a release tagged v1\.0\.0/)).toBeVisible();

    // Pressable straight away, with the message still on screen. The message
    // used to sit over this button for the ten seconds it lives, which is
    // exactly when somebody wants to press it.
    await clash.getByRole('button', { name: 'Cancel' }).click({ timeout: 2000 });
  });

  test('keeps several documents, and navigates one by its own headings', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Design doc' })
      .click();

    /*
     * A studio keeps several: a game design, an art direction, an audio bible.
     *
     * One arrives named and open rather than behind a box asking what to call
     * it — what a document is called is the last thing anybody knows about it.
     * `New doc`, then `New doc 2`, the way the outline numbers two headings
     * that read alike.
     */
    const tabs = page.getByRole('tab');

    await page.getByRole('button', { name: '+ Document' }).click();
    await expect(tabs).toHaveCount(1);

    await page.getByRole('button', { name: '+ Document' }).click();
    await expect(tabs).toHaveCount(2);

    // The name, then its word count, which is the whole of what a tab says.
    await expect(tabs.nth(0)).toHaveText(/^New doc\d+$/u);
    await expect(tabs.nth(1)).toHaveText(/^New doc 2\d+$/u);

    /*
     * Renamed into what they are actually for, which is the point of the
     * placeholder: something to type over rather than a question to answer.
     *
     * Through the app's own dialog. A `page.once('dialog')` here would be
     * catching the browser's, which is what this used to open and no longer
     * does — so this assertion is also what says the browser's is gone.
     */
    for (const [index, title] of ['Game design', 'Audio bible'].entries()) {
      await tabs.nth(index).click();
      await page.getByRole('button', { name: 'Rename' }).click();

      const renaming = page.getByRole('dialog', { name: /^Rename / });

      await renaming.getByLabel('Name').fill(title);
      await renaming.getByRole('button', { name: 'Rename' }).click();

      await expect(tabs.nth(index)).toHaveText(new RegExp(`^${title}`, 'u'));
    }

    // The first is the one a link shows, whatever was open when you left.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Game design', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Edit document' }).click();

    const written = [
      '# Pillars',
      '',
      'You are the **last lamplighter**.',
      '',
      '## Tone',
      '',
      'Damp, and quietly hopeful.',
      '',
      '### Never grim',
      '',
      'Not for its own sake. A paragraph long enough to be a blob of text, so that the heading above it has something to stand out from rather than a line and a half of nothing, which is the state this was reported in.',
      '',
      '#### Rain',
      '',
      'Constant, and never miserable.',
      '',
      '##### Reference',
      '',
      'The harbour at dusk.',
    ].join(String.fromCharCode(10));

    await page.getByLabel('Document body').fill(written);
    await page.getByRole('button', { name: 'Save' }).click();

    // It reads as markdown rather than as the characters that were typed.
    await expect(page.getByRole('heading', { name: 'Pillars' })).toBeVisible();
    await expect(page.getByRole('strong')).toHaveText('last lamplighter');

    /*
     * A heading is the size of its own level.
     *
     * These were each set a step down, so `# Pillars` came out the size of a
     * subheading. The ladder is what matters rather than any particular number:
     * whatever the type scale says, `#` has to read as bigger than `##`.
     */
    const sizeOf = async (heading: Locator): Promise<number> =>
      Number.parseFloat(await heading.evaluate((node) => getComputedStyle(node).fontSize));

    const title = await sizeOf(page.getByRole('heading', { name: 'Pillars' }));
    const heading = await sizeOf(page.getByRole('heading', { name: 'Tone' }));
    const subheading = await sizeOf(page.getByRole('heading', { name: 'Never grim' }));

    expect(title).toBeGreaterThan(heading);
    expect(heading).toBeGreaterThan(subheading);
    // And a title in the document is the size a title is anywhere else.
    expect(title).toBe(await sizeOf(page.getByRole('heading', { name: 'Game design', level: 1 })));

    /*
     * And a heading is a colour of its own, which is what the size could not do.
     *
     * A `##` was the same white as the paragraph under it at four pixels'
     * difference, and a `###` was `--color-text-strong` — dimmer than the prose
     * it introduced. A long document read as blobs, which is #210.
     *
     * Four colours from four elements: three levels and the prose. Asked of
     * what the browser actually computed rather than of the stylesheet, because
     * a token that resolves to nothing paints the inherited colour and says
     * nothing about it.
     */
    const colourOf = async (element: Locator): Promise<string> =>
      element.evaluate((node) => getComputedStyle(node).color);

    const colours = [
      await colourOf(page.getByRole('heading', { name: 'Pillars' })),
      await colourOf(page.getByRole('heading', { name: 'Tone' })),
      await colourOf(page.getByRole('heading', { name: 'Never grim' })),
      await colourOf(page.getByText('Not for its own sake', { exact: false })),
    ];

    expect(new Set(colours).size).toBe(4);

    /*
     * The levels below, which had no size and no colour at all.
     *
     * `####` arrived at the browser's default, which is smaller than the body
     * text it is introducing — a heading quieter than its own paragraph.
     */
    const body = await sizeOf(page.getByText('Constant, and never miserable.'));

    await expect(page.getByRole('heading', { name: 'Rain', level: 4 })).toBeVisible();
    expect(await sizeOf(page.getByRole('heading', { name: 'Rain' }))).toBeGreaterThanOrEqual(body);
    await expect(page.getByRole('heading', { name: 'Reference', level: 5 })).toBeVisible();

    /*
     * The headings become the contents list beside it.
     *
     * Read off the same render pass that put the anchors on, so the list
     * cannot offer somewhere the document does not have.
     */
    const sidebar = page.getByRole('navigation', { name: 'Project' });

    for (const heading of ['Pillars', 'Tone', 'Never grim']) {
      await expect(sidebar.getByRole('button', { name: heading })).toBeVisible();
    }

    await sidebar.getByRole('button', { name: 'Never grim' }).click();
    await expect(page.getByRole('heading', { name: 'Never grim' })).toBeInViewport();

    // The header says when it was last written and by whom, which is the
    // question a studio asks of a design document before it reads one.
    await expect(page.getByText(new RegExp(`Last updated .* · ${STUDIO.owner}`))).toBeVisible();

    // The other document is its own: switching tabs does not carry prose.
    await page.getByRole('tab', { name: /Audio bible/ }).click();
    await expect(page.getByText('Nothing written here yet.')).toBeVisible();

    /*
     * Full screen widens the document; safe mode holds it to a reading measure.
     *
     * The prose is what is measured. The nav, the header and the tabs stay put
     * either way — this is a document inside a workspace rather than a document
     * instead of one.
     */
    await page.getByRole('tab', { name: /Game design/ }).click();

    const measure = async (): Promise<number> =>
      (await page.getByRole('article').boundingBox())?.width ?? 0;

    // Where the row of tabs starts, which follows the prose rather than the
    // window: centred over a centred document, hard left over a full-width one.
    const tabsStartAt = async (): Promise<number> =>
      (await page.getByRole('tab').first().boundingBox())?.x ?? 0;

    /*
     * How wide the document runs is an icon, hard against the button people are
     * already pointing at when the column turns out too narrow for the table
     * they are reading. The words are its name rather than its face.
     *
     * Past the rule rather than in front of it. Everything left of that line
     * changes the document — export it, import one, rename it, write in it —
     * and everything right of it does not: how wide the page is set, and the
     * bin. The toggle used to sit in the middle of the four, which is what made
     * the row read as six controls in no order.
     *
     * A document opens at its measure, so the toggle starts as the way to the
     * whole width rather than the way back from it.
     */
    const widthToggle = page.getByRole('button', { name: 'Full screen' });
    const editDocument = page.getByRole('button', { name: 'Edit document' });
    const toggleBox = await widthToggle.boundingBox();
    const editBox = await editDocument.boundingBox();

    expect(toggleBox?.x ?? 0).toBeGreaterThan(editBox?.x ?? 0);
    /*
     * The same height as the button beside it rather than nearly it.
     *
     * This once compared an icon against a worded `Edit document`, which was
     * the interesting comparison: an icon in a box sized for a line of text
     * comes out nearly right and looks wrong. There are no worded buttons left
     * in this header, so what it holds now is that every control in the row is
     * the same height — which is the property somebody would notice breaking.
     */
    expect(toggleBox?.height).toBe(editBox?.height);

    /*
     * The whole header, left to right.
     *
     * Export and Import carry a document across the edge of the app, with a
     * rule between them saying they are one errand in two directions. Rename
     * and Edit are the two ways of changing the one that is open. Then a second
     * rule, and past it the two controls that change no prose at all — how wide
     * the page is set, and the bin.
     *
     * Read off the screen rather than off the markup, because the order
     * somebody sees is the only one that means anything. `Delete` is an icon
     * and still finds itself by that name, which is the point of the name being
     * on the button rather than in it.
     */
    const leftEdgeOf = async (name: string): Promise<number> =>
      (await page.getByRole('button', { name, exact: true }).boundingBox())?.x ?? 0;

    const acrossTheHeader = [
      await leftEdgeOf('Export MD'),
      await leftEdgeOf('Import'),
      await leftEdgeOf('Rename'),
      await leftEdgeOf('Edit document'),
      await leftEdgeOf('Full screen'),
      await leftEdgeOf('Delete'),
    ];

    expect(acrossTheHeader).toEqual([...acrossTheHeader].sort((first, second) => first - second));

    const safe = await measure();
    const safeTabs = await tabsStartAt();

    await widthToggle.click();
    const full = await measure();

    expect(full).toBeGreaterThan(safe);
    expect(await tabsStartAt()).toBeLessThan(safeTabs);
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Documents' })).toBeVisible();

    await page.getByRole('button', { name: 'Safe mode' }).click();
    expect(await measure()).toBe(safe);
    expect(await tabsStartAt()).toBe(safeTabs);
    await expect(sidebar).toBeVisible();

    // Named and nothing else. A row of separate documents is not the chapters
    // of one, and nobody calls the audio bible "02".
    await expect(page.getByRole('tab').first()).toHaveText(/^Game design/);
  });

  test('puts the documents in the order the studio reads them, not the order they were made', async () => {
    /*
     * The row of tabs is an index, and it was in the order somebody typed: a
     * studio writes the brief, then the audio bible, then wants the one-page
     * pitch first and cannot have it.
     *
     * Two ways to move one, because a row of tabs is narrow and the person
     * reordering it is usually the person writing it, with their hands already
     * on the keys.
     */
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Design doc' })
      .click();

    const tabs = page.getByRole('tab');

    await expect(tabs).toHaveCount(2, { timeout: 20_000 });
    await expect(tabs.nth(0)).toHaveText(/^Game design/u);
    await expect(tabs.nth(1)).toHaveText(/^Audio bible/u);

    // A third, so a move has somewhere to go that is neither end.
    await page.getByRole('button', { name: '+ Document' }).click();
    await expect(tabs).toHaveCount(3);
    await page.getByRole('button', { name: 'Rename' }).click();

    const naming = page.getByRole('dialog', { name: /^Rename / });

    await naming.getByLabel('Name').fill('One-page pitch');
    await naming.getByRole('button', { name: 'Rename' }).click();

    await expect(tabs.nth(2)).toHaveText(/^One-page pitch/u);

    // Dragged from the end to the front, which is the errand this exists for.
    await dragTabOnto('One-page pitch', 'Game design');

    await expect(tabs.nth(0)).toHaveText(/^One-page pitch/u);
    await expect(tabs.nth(1)).toHaveText(/^Game design/u);

    /*
     * The row on screen follows the pointer before the server has answered, so
     * what a reload asks is whether the server agreed — and whether the order
     * is the project's rather than this browser's.
     */
    await page.reload();
    await expect(tabs.nth(0)).toHaveText(/^One-page pitch/u, { timeout: 20_000 });

    /*
     * And from the keyboard, because a row only a mouse can order is an order
     * only some people can set.
     *
     * `Ctrl`+`Shift` rather than the bare arrows: a `tablist` spends its arrows
     * moving focus between tabs, and taking them here would break what somebody
     * expects of one.
     */
    await tabs.nth(0).focus();
    await page.keyboard.press('Control+Shift+ArrowRight');

    await expect(tabs.nth(0)).toHaveText(/^Game design/u);
    await expect(tabs.nth(1)).toHaveText(/^One-page pitch/u);

    // At the end of the row it stops rather than wrapping round to the front.
    await tabs.nth(0).focus();
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await expect(tabs.nth(0)).toHaveText(/^Game design/u);

    // Away again, so the rest of this journey finds the two it made.
    await tabs.nth(1).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete One-page pitch?' })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveText(/^Game design/u);
  });

  /** Drags one tab onto another, and waits out dnd-kit's swallowed click. */
  async function dragTabOnto(moved: string, onto: string): Promise<void> {
    const from = await page.getByRole('tab', { name: new RegExp(moved) }).boundingBox();
    const target = await page.getByRole('tab', { name: new RegExp(onto) }).boundingBox();

    if (from === null || target === null) {
      throw new Error('The tab to drag, or the one to drop it on, is not on screen.');
    }

    const middle = { x: target.x + 8, y: target.y + target.height / 2 };

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 - 12, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(middle.x, middle.y, { steps: 20 });
    // Once more where it already is: the last move is what dnd-kit measures
    // against, and a drop on the same coordinate as the previous step is a drop
    // it never saw arrive.
    await page.mouse.move(middle.x, middle.y);
    await dropAndSettle();
  }

  test('takes a document in as markdown and hands it back out again', async () => {
    const written = ['# Combat design', '', 'Lamps, and what swings at them.'].join(
      String.fromCharCode(10),
    );

    /*
     * The file input is the browser's own, behind a button that looks like the
     * others. Playwright sets it directly, which is the same thing the file
     * dialog would have done.
     */
    await page.locator('input[type="file"]').setInputFiles({
      name: 'combat_design-draft.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(written, 'utf8'),
    });

    // Named by its own first heading rather than by the file, because that is
    // the line a person would have typed into the box themselves.
    const tab = page.getByRole('tab', { name: /Combat design/ });

    await expect(tab).toBeVisible();
    // And opened, rather than left for somebody to find in the row of tabs.
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Lamps, and what swings at them.')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export MD' }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('combat-design.md');
    // What comes out is what went in: an export somebody has to repair is a
    // document they keep somewhere else instead.
    expect(await readFile(await download.path(), 'utf8')).toBe(written);
  });
  test('asks before it destroys something, and takes no for an answer', async () => {
    /*
     * One confirmation, everywhere.
     *
     * There were three ways of asking before this and three deletions that
     * never asked at all, which are the ones people actually lose work to.
     * `Combat design` is the document imported a moment ago, still open.
     */
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);

    await page.getByRole('button', { name: 'Delete' }).click();

    const confirm = page.getByRole('dialog', { name: 'Delete Combat design?' });

    // It says what goes rather than only asking whether you are sure, which is
    // the difference between a question and a step to click through.
    await expect(confirm).toContainText('words written in it');

    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(tabs).toHaveCount(3);

    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete Combat design?' })
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(tabs).toHaveCount(2);
  });

  test('says how to connect a repository, before one is connected', async () => {
    /*
     * The steps are on somebody else's website, and the screen only ever showed
     * the fields. Read at the moment it is needed — with nothing connected —
     * because that is the state the question is asked in.
     */
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Settings' })
      .click();

    /*
     * Waited for rather than clicked straight away.
     *
     * The settings screen draws nothing until the project has answered, and on
     * a cold CI runner that takes longer than a click is willing to wait. A
     * click that runs out of time takes the whole context down with it and
     * every test after it reports a closed browser, so the wait is spent here
     * where it says which screen was slow.
     */
    const help = page.getByRole('button', { name: 'How to set this up' });

    await expect(help).toBeVisible({ timeout: 30_000 });
    await help.click();

    const instructions = page.getByRole('dialog', { name: 'Connecting a repository' });

    // Both halves, because which one does what is the thing people get wrong.
    await expect(instructions.getByRole('heading', { name: /The webhook/u })).toBeVisible();
    await expect(instructions.getByRole('heading', { name: /The GitHub App/u })).toBeVisible();

    await instructions.getByRole('button', { name: 'Close' }).click();
    await expect(instructions).toHaveCount(0);
  });

  test('shows the webhook secret when a repository is connected', async () => {
    /*
     * The one moment the secret is visible.
     *
     * It was not visible at all: connecting invalidates the connection query,
     * and the refetch swapped the screen to the connected view before the form
     * that made the secret could render it. It was generated, encrypted,
     * stored, and shown to nobody — which makes a webhook impossible to sign,
     * on every install, with nothing failing anywhere.
     *
     * Nothing here can ask the server for it afterwards, and that is
     * deliberate, so this is the only chance to check it was ever shown.
     */
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Settings' })
      .click();

    await page.getByLabel('Repository', { exact: true }).fill('northwind/saltmarsh');
    await page.getByRole('button', { name: 'Connect' }).click();

    const secret = page.getByLabel('Secret');

    // Shown at all. It used to be rendered by a component the refetch unmounted
    // before it drew anything, so the secret existed and nobody ever saw it.
    await expect(secret).toBeVisible();
    await expect(secret).toHaveValue(/.{32,}/u);

    /*
     * The address arrives with the connection refetch — the very refetch that
     * used to sweep this panel away. That it lands while the secret is still on
     * screen is the whole of the regression, and it is observable without
     * waiting for anything: the arrival is the event that used to break it.
     */
    /*
     * Dismissed by hand, and it takes the panel with it.
     *
     * Nothing further is asserted about the screen behind it. On CI the
     * connection query has not answered by this point — the connected view is
     * not there at all — while locally it always is, and I have not accounted
     * for that difference rather than guessing. It is worth its own look; it is
     * not what this test is for.
     *
     * What this test is for is the line above: the secret was rendered by a
     * component the refetch unmounted, so it existed and nobody ever saw it,
     * and a webhook cannot be signed with a secret nobody has.
     */
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await expect(page.getByLabel('Secret')).toHaveCount(0);
  });

  test('gives a list the height of the board, and scrolls it rather than the page', async () => {
    /*
     * A column used to be as tall as what was in it, so a board with one busy
     * list and three quiet ones was a row of different-sized boxes with the
     * page itself scrolling underneath. Filled through the API rather than the
     * form: this is about what fifteen cards do to the layout, not about how
     * they were made.
     */
    const answer = await page.request.get('/api/q/board.view?slug=saltmarsh');
    const { data: board } = (await answer.json()) as {
      data: { project: { id: string }; lists: { id: string; name: string }[] };
    };
    const backlog = board.lists[0];

    for (let index = 0; index < 14; index++) {
      await page.request.post('/api/c/board.createCard', {
        data: {
          commandId: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
          projectId: board.project.id,
          listId: backlog?.id,
          title: `Filler card number ${String(index + 1)}`,
          type: 'task',
        },
      });
    }

    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();

    const column = page.getByRole('region', { name: backlog?.name ?? 'Backlog' });

    await expect(column.getByText('Filler card number 1', { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    const layout = await column.evaluate((element) => {
      // The part of the column that scrolls, found by the property this is
      // about rather than by its position: it was the last child until the
      // edge that resizes the columns was added after it, and a test that
      // counts children breaks on a change that has nothing to do with it.
      const cards = [...element.children].find(
        (child) => window.getComputedStyle(child).overflowY === 'auto',
      );

      return {
        overflowing: (cards?.scrollHeight ?? 0) > (cards?.clientHeight ?? 0),
        columnHeight: element.clientHeight,
        windowHeight: window.innerHeight,
        pageScrolls: document.body.scrollHeight > window.innerHeight,
      };
    });

    // The cards scroll inside the column …
    expect(layout.overflowing).toBe(true);
    // … the page behind them does not …
    expect(layout.pageScrolls).toBe(false);
    // … and the column is the height of the board rather than of its contents.
    expect(layout.columnHeight).toBeGreaterThan(layout.windowHeight / 2);
  });

  test('a board gains a list, moves it, and gives it back', async () => {
    /*
     * The dialog behind this has been here since step 4 — add, rename, remove,
     * and where the cards go when a list is taken away. Nothing opened it for a
     * new one: the board had four lists and no way to make a fifth.
     *
     * A fifth goes on the end, after Done, which is where a working stage almost
     * never belongs — so the other half of this is dragging it to the front and
     * finding it still there after a reload.
     */
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();

    await expect(page.getByRole('button', { name: 'New list' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'New list' }).click();

    const asking = page.getByRole('dialog', { name: 'New list' });

    await asking.getByLabel('Name').fill('Out for approval');
    await asking.getByRole('button', { name: 'Add list' }).click();

    const made = page.getByRole('region', { name: 'Out for approval' });
    const columns = page.getByRole('heading', { level: 2 });

    await expect(made).toBeVisible();
    await expect(columns).toHaveText([
      'Backlog',
      'In progress',
      'Ready for review',
      'Done',
      'Out for approval',
    ]);

    // Backlog rather than the new one, because the board scrolls sideways once
    // there are five columns and a drag that starts off the edge of the screen
    // is a drag nobody is making.
    await dragColumnOnto('Backlog', 'In progress');

    await expect(columns).toHaveText([
      'In progress',
      'Backlog',
      'Ready for review',
      'Done',
      'Out for approval',
    ]);

    // The board on screen follows the pointer before the server has answered, so
    // what a reload asks is whether the server agreed.
    await page.reload();
    await expect(columns.first()).toHaveText('In progress');

    // And back the other way, which is the same arithmetic read from the other
    // side — and leaves the board as the rest of this journey expects it.
    await dragColumnOnto('Backlog', 'In progress');
    await expect(columns.first()).toHaveText('Backlog');

    // And away again, which is the half a board needs before anybody trusts the
    // first: a column added by mistake has to be removable.
    await page.getByRole('button', { name: 'Out for approval settings' }).click();
    await page
      .getByRole('dialog', { name: 'List settings' })
      .getByRole('button', { name: 'Remove list' })
      .click();

    await expect(made).toHaveCount(0);
  });

  /**
   * Opens an asset category, which the library draws closed.
   *
   * Asked rather than pressed blind: a heading is a toggle, so a second press
   * on one that is already open shuts it. `aria-expanded` is the same fact the
   * chevron is drawn from, and the one a screen reader is told.
   *
   * Named by a pattern because a heading's accessible name carries its count
   * as well — `Environment Props (1 item)` — and the count is not this
   * helper's business.
   */
  async function openCategory(name: RegExp): Promise<void> {
    const heading = categoryHeading(name);

    if ((await heading.getAttribute('aria-expanded')) === 'false') {
      await heading.click();
    }
  }

  /**
   * A category's heading in the library, which is the button that opens it.
   *
   * Narrowed to the button that has an `aria-expanded` to read, because a
   * category's name is on two of them: the heading, and the grip beside it that
   * drags the category into a different order. Only one of them opens anything,
   * and asking by name alone matches both.
   *
   * On the journey's own tab unless another is named, which is what the second
   * tab needs when it is asked whether it kept up.
   */
  function categoryHeading(name: RegExp, tab: Page = page): Locator {
    return tab.getByRole('button', { name }).and(tab.locator('[aria-expanded]'));
  }

  /**
   * How long dnd-kit goes on swallowing clicks after a drag ends.
   *
   * `AbstractPointerSensor.detach` in `@dnd-kit/core` says
   * `setTimeout(this.documentListeners.removeAll, 50)`, and one of the listeners
   * it is removing is a **capture-phase** `click` on the document that calls
   * `stopPropagation`. It is added the moment a drag activates so that the click
   * the browser fires at the end of a drop cannot press whatever it lands on.
   */
  const DND_KIT_SWALLOWS_CLICKS_FOR_MS = 50;

  /**
   * Lets go of a drag, and waits until a click will be heard again.
   *
   * This is #142. Until that timer fires, *any* click is stopped in the capture
   * phase before React sees it — so a click made too soon after a drop fires
   * natively, on the right element, and does nothing at all. The suite timed out
   * waiting for a dialog that was never going to open, on a different test each
   * time and about one run in eight.
   *
   * Measured rather than guessed: a click 46ms after a drop was swallowed and
   * the same click 64ms after was not.
   *
   * **Nothing is wrong with the product.** Nobody crosses a board and clicks
   * inside fifty milliseconds, and the suppression is there so that letting go
   * of a card does not also press the thing underneath it. What was wrong was a
   * test quicker than a person, walking into a window built for people.
   *
   * So this waits out a fixed timer and says so, rather than waiting for
   * something else that merely takes long enough — which is what makes a wait
   * like this honest instead of a sleep somebody added until it went green.
   */
  async function dropAndSettle(): Promise<void> {
    await page.mouse.up();
    await page.waitForTimeout(DND_KIT_SWALLOWS_CLICKS_FOR_MS * 2);
  }

  /**
   * Carries an asset's tile onto a category's heading, and lets go.
   *
   * Aimed twice, because the library is redrawn while the tile travels. The
   * moment it leaves its category, everything below that category moves up by
   * the height of the row it no longer holds — so a heading measured before the
   * drag is somewhere else by the time the pointer arrives, and the pointer is
   * over whatever moved up underneath it. The second aim is at where the
   * heading is now.
   */
  async function dragTileOntoHeading(tile: Locator, heading: Locator): Promise<void> {
    const from = await tile.boundingBox();

    if (from === null) {
      throw new Error('Expected the tile to drag to be on screen.');
    }

    await page.mouse.move(from.x + from.width / 2, from.y + 20);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + 20, { steps: 4 });

    await moveOnto(heading, 20);
    await moveOnto(heading, 5);

    await dropAndSettle();
  }

  /** The pointer, on the middle of whatever the locator names right now. */
  async function moveOnto(target: Locator, steps: number): Promise<void> {
    const box = await target.boundingBox();

    if (box === null) {
      throw new Error('Expected the place to drop onto to be on screen.');
    }

    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    await page.mouse.move(middle.x, middle.y, { steps });
    // Once more where it already is: the last move is what dnd-kit measures
    // against, and a drop on the same coordinate as the previous step is one it
    // never saw arrive.
    await page.mouse.move(middle.x, middle.y);
  }

  /** Deletes a category from its heading, and waits for the heading to go. */
  async function deleteCategory(name: string): Promise<void> {
    await categoryHeading(new RegExp(name))
      .locator('..')
      .getByRole('button', { name: 'Delete' })
      .click();
    await page
      .getByRole('dialog', { name: `Delete ${name}?` })
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(categoryHeading(new RegExp(name))).toHaveCount(0);
  }

  /**
   * Carries one column by its grip and drops it on another.
   *
   * In steps, and a few pixels sideways before aiming: the pointer has to travel
   * before a drag begins at all, and what is under the pointer is decided as it
   * travels rather than from where it is let go.
   */
  async function dragColumnOnto(name: string, target: string): Promise<void> {
    const grip = page.getByRole('button', { name: `Reorder ${name}` });
    const heading = page.getByRole('heading', { level: 2, name: target, exact: true });

    await grip.scrollIntoViewIfNeeded();

    const from = await grip.boundingBox();
    const onto = await heading.boundingBox();

    if (from === null || onto === null) {
      throw new Error('The column to drag, or the one to drop it on, is not on screen.');
    }

    const middle = { x: onto.x + 8, y: onto.y + onto.height / 2 };

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(middle.x, middle.y, { steps: 20 });
    // Once more where it already is: the last move is what dnd-kit measures
    // against, and a drop on the same coordinate as the previous step is a drop
    // it never saw arrive.
    await page.mouse.move(middle.x, middle.y);
    await dropAndSettle();
  }

  test('sets the width of the columns for one person, and keeps it', async () => {
    /*
     * A preference, and the whole of what makes it one: it changes every column
     * on the board, it survives leaving and coming back, and it is on this
     * machine rather than on the board — so nobody else's board moves.
     *
     * 262px was a fine number and nobody's favourite. On a wide screen it shows
     * five columns where twelve would fit; on a laptop the asset names wrap
     * after three words.
     */
    await page.goto('/p/saltmarsh/tasks');

    const first = page.getByRole('region', { name: 'Backlog' });
    const second = page.getByRole('region', { name: 'In progress' });
    const last = page.getByRole('region', { name: 'Done' });

    await expect(first).toBeVisible({ timeout: 20_000 });
    expect(await widthOf(first)).toBe(262);

    /*
     * The second column's edge rather than the first, because the first proves
     * nothing.
     *
     * Every column changes together, so an edge with two columns behind it
     * moves twice as far as they each grow. Dragging it 80 widens them by 40 —
     * and the edge somebody has hold of ends up under the pointer rather than
     * twice as far along, which is the whole of what makes it feel like an edge
     * and not a lever.
     */
    const grip = await second.getByRole('separator', { name: 'Column width' }).boundingBox();

    if (grip === null) throw new Error('The edge of the second column is not on screen.');

    const grabbedAt = grip.x + grip.width / 2;
    const middle = grip.y + grip.height / 2;

    await page.mouse.move(grabbedAt, middle);
    await page.mouse.down();
    await page.mouse.move(grabbedAt + 80, middle, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => widthOf(second)).toBe(302);

    const dragged = await second.boundingBox();

    expect(Math.abs((dragged?.x ?? 0) + (dragged?.width ?? 0) - (grabbedAt + 80))).toBeLessThan(2);

    // Every column, not the one that was dragged. Columns of different widths
    // would read as if they meant something by it.
    expect(await widthOf(first)).toBe(302);
    expect(await widthOf(last)).toBe(302);

    /*
     * Kept on the machine rather than on the board. This is the half that makes
     * it a preference: two people can want different things about the same
     * board and both be right.
     */
    await page.reload();
    await expect(first).toBeVisible({ timeout: 20_000 });
    expect(await widthOf(first)).toBe(302);

    // A width you cannot undo would be worse than one you cannot set.
    await first.getByRole('separator', { name: 'Column width' }).dblclick();
    await expect.poll(async () => widthOf(first)).toBe(262);

    // And from the keyboard, because a size only a mouse can reach is a
    // preference only some people have.
    await first.getByRole('separator', { name: 'Column width' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => widthOf(first)).toBe(294);

    await page.keyboard.press('Home');
    await expect.poll(async () => widthOf(first)).toBe(262);
  });

  /** What a column is actually drawn at, rather than what was asked for. */
  async function widthOf(column: Locator): Promise<number> {
    const box = await column.boundingBox();

    if (box === null) throw new Error('That column is not on screen.');

    return Math.round(box.width);
  }

  test('lists every task, including the ones already finished', async () => {
    /*
     * The other half of the board. It exists because a board answers what is
     * happening and cannot answer what is there: it hides a closed card, and it
     * has no room on a chip for the milestone or the asset a card is about.
     */
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();

    await page
      .getByRole('navigation', { name: 'Tasks' })
      .getByRole('link', { name: 'All tasks' })
      .click();

    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible({
      timeout: 20_000,
    });

    // The card written at the beginning of this journey, on a row rather than a
    // tile, with the list it sits on as its status.
    const row = page.getByRole('row').filter({ hasText: CARD.title });

    await expect(row).toBeVisible();
    await expect(row).toContainText(CARD.key);

    // And the row opens the same panel the board opens.
    await row.getByRole('button', { name: CARD.key }).click();

    const panel = page.getByRole('dialog', { name: 'Card' });

    await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Title')).toHaveValue(CARD.title);
    await panel.getByRole('button', { name: 'Close' }).click();

    // The list can do what the board can: the same controls, on the same row.
    await expect(page.getByRole('button', { name: 'New card' })).toBeVisible();

    /*
     * And the headings put it in their own order.
     *
     * Summary rather than a column of dashes: this project's cards have no
     * milestone, points or priority on them, so those columns would sort into
     * the same order they were already in and prove nothing.
     */
    const summaries = () => page.locator('tbody tr td:nth-child(3)').allTextContents();

    const arrived = await summaries();

    await page.getByRole('button', { name: 'Summary' }).click();
    const up = await summaries();

    // Numeric, because the column is: `Filler 2` before `Filler 10` rather than
    // after it, which is what the table does and what anybody reading expects.
    const words = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    expect(up).toEqual([...arrived].sort((left, right) => words.compare(left, right)));

    await page.getByRole('button', { name: 'Summary' }).click();
    expect(await summaries()).toEqual([...up].reverse());

    // A third press puts them back the way the board has them.
    await page.getByRole('button', { name: 'Summary' }).click();
    expect(await summaries()).toEqual(arrived);

    // Back to the board, so the step after this one starts where it expects to.
    await page
      .getByRole('navigation', { name: 'Tasks' })
      .getByRole('link', { name: 'Card board' })
      .click();
  });

  test('adds somebody to the install, and takes their access away again', async () => {
    /*
     * There is no invitation email on a self-hosted box, so this is the whole
     * way somebody gets an account: an admin types their name, their address
     * and the password they start with.
     */
    await page.goto('/');
    await page.getByRole('link', { name: 'Users' }).click();

    // The tab and the heading say the same word now. They did not: the tab said
    // Admin and the heading said People, so the place you pressed and the place
    // you arrived at had different names.
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole('button', { name: 'New person' }).click();

    const adding = page.getByRole('dialog', { name: 'New person' });

    await adding.getByLabel('Name').fill('Mira Kaur');
    await adding.getByLabel('Email').fill('mira@northwind.studio');
    await adding.getByLabel('First password').fill('a phrase beats a puzzle');
    await adding.getByRole('button', { name: 'Add person' }).click();

    const mira = page.getByRole('row').filter({ hasText: 'Mira Kaur' });

    await expect(mira).toBeVisible();
    await expect(mira).toContainText('mira@northwind.studio');
    // Never signed in, which is a different thing from signed in a long time ago.
    await expect(mira).toContainText('never');

    // And away again. Suspending rather than deleting: she wrote things, and a
    // deleted row would take her name off all of them.
    await mira.getByRole('button', { name: 'Suspend' }).click();

    await expect(mira).toContainText('Suspended');
    await expect(mira.getByRole('button', { name: 'Let back in' })).toBeVisible();
  });

  test('marks the person who set the install up, and offers nothing that would unseat them', async () => {
    /*
     * One account is permanent.
     *
     * "An admin remains" kept somebody in the chair but said nothing about
     * who: a studio could promote a contractor, demote the founder, and the
     * rule would be satisfied the whole way down. The screen says so on the
     * row rather than only in the refusal, so nobody reaches for a control
     * that will turn them down.
     */
    await page.goto('/users');

    const owner = page.getByRole('row').filter({ hasText: 'Install owner' });

    await expect(owner).toBeVisible({ timeout: 20_000 });
    await expect(owner.getByRole('button', { name: 'Suspend' })).toHaveCount(0);

    /*
     * There is no role to protect any more — nobody's is editable, because the
     * screen grants with permission groups now. Their groups are editable like
     * anybody's, and that is not a way to unseat them: a deny cannot reach an
     * owner, and taking every group off them leaves the owner floor deciding.
     */
    await expect(owner.getByRole('combobox')).toHaveCount(0);

    // Their password is still theirs to reset, which is not a way to unseat
    // anybody.
    await expect(owner.getByRole('button', { name: 'Reset password' })).toBeVisible();

    // And nobody else is marked, so the tag means one person rather than
    // "an owner".
    await expect(page.getByText('Install owner')).toHaveCount(1);
  });

  test('narrows the people to the one being looked for', async () => {
    await page.goto('/users');

    const search = page.getByRole('searchbox', { name: 'Search people' });

    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill('mira');

    await expect(page.getByRole('row').filter({ hasText: 'Mira Kaur' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Jake Winters' })).toHaveCount(0);
  });

  test('gathers people into a team, and takes the team away again', async () => {
    /*
     * A team is how a studio says which people work on what. It is a grouping
     * and nothing more yet — what a team can reach is the step after this one.
     */
    await page.goto('/');
    await page.getByRole('link', { name: 'Teams' }).click();

    await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole('button', { name: 'New team' }).click();

    const naming = page.getByRole('dialog', { name: 'New team' });

    await naming.getByLabel('Name').fill('Environment art');
    await naming.getByRole('button', { name: 'Make team' }).click();

    // The row in the list, which says how many people and who leads them —
    // the two things somebody scanning twenty teams is deciding between.
    const row = page.getByRole('button', { name: /Environment art/ });

    await expect(row).toContainText('0 people · no lead');

    // The picker searches everybody who is not in it, which at a thousand
    // people is the only way this box could work.
    await page.getByLabel('Add somebody to Environment art').fill('Mira');
    await page.getByRole('button', { name: /Mira Kaur/ }).click();

    const members = page.getByRole('region', { name: 'Environment art members' });

    await expect(members.getByRole('row').filter({ hasText: 'Mira Kaur' })).toBeVisible();
    await expect(row).toContainText('1 person');

    // And away again. The team goes; the person does not.
    await page.getByRole('button', { name: 'Remove team' }).click();
    await page
      .getByRole('dialog', { name: 'Remove Environment art?' })
      .getByRole('button', { name: 'Remove team' })
      .click();

    await expect(page.getByText('No teams yet.')).toBeVisible();

    await page.goto('/users');
    await expect(page.getByRole('row').filter({ hasText: 'Mira Kaur' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('a team is people and permissions, and reaches no project by itself', async () => {
    await page.goto('/teams');
    await page.getByRole('button', { name: 'New team' }).click();

    const team = page.getByRole('dialog', { name: 'New team' });

    await team.getByLabel('Name').fill('Audio');
    await team.getByRole('button', { name: 'Make team' }).click();

    await page.getByRole('button', { name: /Audio/ }).click();

    // Two panels, and neither is about projects: who is in it, and what they
    // may do. The third used to say which projects it reached.
    await expect(page.getByRole('region', { name: 'Audio members' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Audio permissions' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Audio access' })).toHaveCount(0);
    await expect(page.getByText('No exceptions')).toHaveCount(0);

    // Away again, so the journey leaves the studio as it found it.
    await page.getByRole('button', { name: 'Remove team' }).click();
    await page
      .getByRole('dialog', { name: 'Remove Audio?' })
      .getByRole('button', { name: 'Remove team' })
      .click();

    await expect(page.getByText('No teams yet.')).toBeVisible();
  });

  test('says what a team may do, one action at a time', async () => {
    /*
     * `read` and `write` were one word for a whole project, so anybody who
     * could move a card could also edit it, rename the list and delete it —
     * all four are `write`. What studios actually need to say is about *what*,
     * not how much.
     *
     * Which projects a team reaches is still Teams. This is what they may do
     * when they get there.
     */
    await page.goto('/permissions');

    /*
     * The install did not start empty.
     *
     * The first thing anybody used to do here was build the obvious groups by
     * hand — obvious because the screen already files every action under a
     * heading. Setup makes one per heading, plus the one that holds the lot.
     */
    const list = page.getByRole('navigation', { name: 'Permission groups' });

    await expect(list.getByRole('button', { name: /Administrator/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(list.getByRole('button', { name: /Board and cards/ })).toBeVisible();

    /*
     * One per heading and one that holds the lot, which is enough rows to want
     * narrowing. It was not, until Agents became a heading of its own — the
     * threshold is about when scanning stops being enough, and a stock install
     * now sits the far side of it.
     */
    await expect(list.getByRole('searchbox')).toHaveCount(1);

    await page.getByRole('button', { name: 'New permission group' }).click();

    const form = page.getByRole('dialog', { name: 'New permission group' });
    await form.getByLabel('Name').fill('Outsourcer');
    // Named and set up in one go: a whole heading to begin with, picked apart
    // after. A heading is not a rule, so this writes one rule per action.
    await form.getByLabel('Start it with').selectOption('catalog.board');
    await form.getByRole('button', { name: 'Make group' }).click();

    await expect(form).toBeHidden();

    const group = page.getByRole('region', { name: 'Outsourcer' });
    await expect(group).toBeVisible();

    const board = group.getByRole('region', { name: 'Board and cards' });

    // The heading reads back what is under it, having been set by the dialog.
    await expect(board).toContainText('All allowed');

    /*
     * The sentence the whole feature exists for: everything on the board,
     * except moving cards across it. One child switched, and the heading says
     * so rather than arguing with it.
     */
    await board.getByRole('button', { name: /Board and cards/ }).click();
    await board
      .getByRole('radiogroup', { name: /Move — card/ })
      .getByRole('radio', { name: 'Deny' })
      .click();

    // Three pieces rather than one string: the counts are said in the colours
    // of the answers, so they are their own elements.
    await expect(board.getByText('Custom', { exact: true })).toBeVisible();
    await expect(board.getByText('8 allowed', { exact: true })).toBeVisible();
    await expect(board.getByText('1 denied', { exact: true })).toBeVisible();

    // Nothing is checked on the heading while its children disagree: a heading
    // claiming to be Allow over a denial is the lie this replaced.
    const heading = board.getByRole('radiogroup', { name: /Everything under Board and cards/ });

    await expect(heading.getByRole('radio', { name: 'Allow' })).toHaveAttribute(
      'aria-checked',
      'false',
    );

    // And pressing the heading again puts every child back in step.
    await heading.getByRole('radio', { name: 'Deny' }).click();
    await expect(board).toContainText('All denied');

    /*
     * Hovering one action lights up that action, not the panel behind it.
     *
     * The group kept a hover from when it was a tile in a grid you clicked to
     * open. Once the list moved to the side it became a plain section holding
     * every catalogue, so pointing at a single Deny greyed all of them — which
     * reads as "all of this is about to happen".
     */
    const panelColour = async (): Promise<string> =>
      group.evaluate((element) => getComputedStyle(element).backgroundColor);

    // Away from the panel first: the click above left the pointer inside it, so
    // a baseline taken here would already be the hover colour and match itself.
    await page.mouse.move(0, 0);

    const atRest = await panelColour();

    await board
      .getByRole('radiogroup', { name: /Move — card/ })
      .getByRole('radio', { name: 'Allow' })
      .hover();

    expect(await panelColour()).toBe(atRest);

    // A rule says what it lets somebody do, on the action rather than on hover.
    await expect(board.getByText('statement about the schedule', { exact: false })).toBeVisible();

    // The group holds rules and nothing else: no list of teams, no checkboxes,
    // nothing about who it governs. That is said on the team.
    await expect(group.getByRole('checkbox')).toHaveCount(0);
    await expect(group.getByText('holds this', { exact: false })).toHaveCount(0);

    /*
     * What it is called is not part of reading what it allows.
     *
     * The rename box and the Delete button used to sit on top of the rules.
     * They are one button beside New now, and this is what is behind it.
     */
    await expect(group.getByLabel('Name')).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit permission group' }).click();

    const edit = page.getByRole('dialog', { name: 'Edit permission group' });

    await edit.getByLabel('Name').fill('Outsourcer — Fathom');
    await edit.getByRole('button', { name: 'Save name' }).click();

    await expect(edit).toBeHidden();
    await expect(page.getByRole('region', { name: 'Outsourcer — Fathom' })).toBeVisible();

    /*
     * Nine now, and the column down the side has grown a way to be narrowed.
     *
     * A studio can have a hundred of these and none of them is found by
     * scrolling — so the search appears once a studio has added to the eight
     * the install came with.
     */
    const findingAGroup = list.getByRole('searchbox', { name: 'Find in permission groups' });

    await expect(findingAGroup).toBeVisible();

    await findingAGroup.fill('board');
    await expect(list.getByRole('button')).toHaveCount(1);

    await findingAGroup.fill('nothing by that name');
    await expect(list.getByRole('button')).toHaveCount(0);
    await expect(list.getByText('Nothing matches that.')).toBeVisible();
  });

  test('gives a permission group to a team, from the team', async () => {
    /*
     * The other half of the same idea: a group is a set of rules and nothing
     * else, so the only place it becomes real is on a team.
     */
    await page.goto('/teams');

    await page.getByRole('button', { name: 'New team' }).click();

    const naming = page.getByRole('dialog', { name: 'New team' });
    await naming.getByLabel('Name').fill('Outsourcers');
    await naming.getByRole('button', { name: 'Make team' }).click();

    await page.getByRole('button', { name: /Outsourcers/ }).click();

    const panel = page.getByRole('region', { name: 'Outsourcers permissions' });

    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Permissions' })).toBeVisible();

    /*
     * The panel is what the team has, not a tick-list of everything it has not.
     *
     * A studio nearly always gives a team one group, and an install starts with
     * eight — so a list of all of them with one ticked was a panel about the
     * wrong thing.
     */
    await expect(panel.getByText('None yet.', { exact: false })).toBeVisible();
    await expect(panel.getByRole('checkbox')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Add permission' }).click();

    const picker = page.getByRole('dialog', { name: 'Add permission' });

    await expect(picker).toBeVisible();

    const finding = picker.getByRole('searchbox', { name: 'Find a permission group' });

    /*
     * All of them, in a box that scrolls, with its size said above it.
     *
     * A studio can have a hundred and they are all loaded already, so there is
     * nothing to gain by making somebody type to see the last one. A scrolling
     * list hides its own size, which is what the count is for.
     *
     * The stock groups plus the one made a moment ago: one per heading on the
     * Permissions screen, the one that holds the lot, and Outsourcer.
     */
    await expect(picker.getByRole('button', { name: /rules?$/ })).toHaveCount(10);
    await expect(picker.getByText('10 groups', { exact: true })).toBeVisible();

    await finding.fill('nothing by that name');
    await expect(picker.getByText('No group matches that.')).toBeVisible();

    // Narrowing says so, so nobody wonders whether the box did anything.
    await finding.fill('Outsourcer');
    await expect(picker.getByText('1 of 10', { exact: true })).toBeVisible();
    await picker.getByRole('button', { name: /Outsourcer — Fathom/ }).click();

    // Picking closes it: a team nearly always has one, so staying open would
    // cost a click in the common case to save one in the rare case.
    await expect(picker).toBeHidden();

    const held = panel.getByRole('list', { name: 'Permissions Outsourcers holds' });

    await expect(held.getByText('Outsourcer — Fathom')).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText('1 permission', { exact: true })).toBeVisible();

    // And what it already holds is not offered again.
    await panel.getByRole('button', { name: 'Add permission' }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Add permission' })
        .getByRole('button', { name: /Outsourcer — Fathom/ }),
    ).toHaveCount(0);
    await page
      .getByRole('dialog', { name: 'Add permission' })
      .getByRole('button', { name: 'Done' })
      .click();

    /*
     * And it stayed, which is the half worth checking.
     *
     * Asserted by coming back to the team rather than by reading it off the
     * group: a group holds rules and says nothing about who it governs, so the
     * team is the only place this fact is written down.
     */
    await page.goto('/permissions');
    await page.goto('/teams');
    await page.getByRole('button', { name: /Outsourcers/ }).click();

    const again = page.getByRole('region', { name: 'Outsourcers permissions' });

    await expect(again.getByText('Outsourcer — Fathom')).toBeVisible({ timeout: 20_000 });

    // Taken away again, and the panel goes back to saying so.
    await again.getByRole('button', { name: 'Take away' }).click();

    await expect(again.getByText('None yet.', { exact: false })).toBeVisible({ timeout: 20_000 });
  });

  test('gives a permission group to one person, from Users', async () => {
    /*
     * The other half of the same idea.
     *
     * A team says what a job does; this says what one person does that their
     * job does not. Users used to answer it with a role — one of five rungs,
     * each standing for a bundle nobody could read off the screen — and a group
     * says the same thing by name instead of by rank.
     */
    await page.goto('/users');

    const mira = page.getByRole('row').filter({ hasText: 'Mira Kaur' });

    await expect(mira).toBeVisible({ timeout: 20_000 });

    // The cell says what they hold, and holds nothing yet.
    const permissions = mira.getByRole('button', { name: 'Permissions for Mira Kaur' });

    await expect(permissions).toHaveText('no groups');

    await permissions.click();

    const dialog = page.getByRole('dialog', { name: 'Mira Kaur' });

    await expect(dialog.getByRole('heading', { name: 'What Mira Kaur may do' })).toBeVisible();

    // Every group on one list with a switch each, rather than a dialog to add
    // and a row to remove: the question asked of a cell is "what has this one
    // got", which one list answers and two do not.
    await dialog.getByRole('checkbox', { name: /Outsourcer/ }).check();
    await dialog.getByRole('button', { name: 'Done' }).click();

    await expect(permissions).toHaveText(/Outsourcer/, { timeout: 20_000 });

    // And off again, so the journey leaves the studio as it found it.
    await permissions.click();
    await page
      .getByRole('dialog', { name: 'Mira Kaur' })
      .getByRole('checkbox', { name: /Outsourcer/ })
      .uncheck();
    await page
      .getByRole('dialog', { name: 'Mira Kaur' })
      .getByRole('button', { name: 'Done' })
      .click();

    await expect(permissions).toHaveText('no groups', { timeout: 20_000 });
  });

  test('keeps a deleted team for a week, and puts it back', async () => {
    /*
     * The other half of the trail: what happened, and what can still be undone.
     *
     * Deleting is the one thing on this install with no opposite to do. So it
     * does not really delete — the rows are copied out first and kept whole.
     */
    await page.goto('/teams');
    await page.getByRole('button', { name: 'New team' }).click();

    const naming = page.getByRole('dialog', { name: 'New team' });
    await naming.getByLabel('Name').fill('Cinematics');
    await naming.getByRole('button', { name: 'Make team' }).click();

    await page.getByRole('button', { name: /Cinematics/ }).click();
    await page.getByRole('button', { name: 'Remove team' }).click();
    await page
      .getByRole('dialog', { name: 'Remove Cinematics?' })
      .getByRole('button', { name: 'Remove team' })
      .click();

    await expect(page.getByRole('button', { name: /Cinematics/ })).toHaveCount(0);

    /*
     * From the Audit tab, not from Admin.
     *
     * What happened and what can still be undone are the same question a day
     * apart, so they are two halves of one place rather than two links on the
     * screen about people.
     */
    await page
      .getByRole('navigation', { name: 'Install' })
      .getByRole('link', { name: 'Audit' })
      .click();
    await expect(page).toHaveURL(/\/audit$/);

    await page
      .getByRole('navigation', { name: 'Audit' })
      .getByRole('link', { name: 'Recently deleted' })
      .click();
    await expect(page).toHaveURL(/\/audit\/deleted$/);

    const bin = page.getByRole('list', { name: 'The bin' });
    const row = bin.getByRole('listitem').filter({ hasText: 'Cinematics' });

    await expect(row).toBeVisible({ timeout: 20_000 });

    // How long is left, not when it went: that is the number that decides
    // whether somebody acts now.
    await expect(row).toContainText('7 days left');

    /*
     * The rest of the bin is the journey's own earlier deletions — a category,
     * a document and a card — which is the feature working rather than noise.
     * Only this row is expected to leave.
     */
    await row.getByRole('button', { name: 'Put it back' }).click();

    await expect(row).toHaveCount(0, { timeout: 20_000 });

    // Back with the id it had, which is the whole point of keeping the rows
    // rather than offering to make a new team with the same name.
    await page.goto('/teams');
    await expect(page.getByRole('button', { name: /Cinematics/ })).toBeVisible({ timeout: 20_000 });
  });

  test('draws the places outside a project as a mark each, and names the one you are on', async () => {
    /*
     * Five words at title size were the loudest thing on every screen outside a
     * project, above content set smaller than they were. A mark each now — and
     * the one you are on keeps its word, because `ScreenHeader` reads the `<h1>`
     * out rather than drawing it, so take all five away and no screen out here
     * says its own name on screen any more.
     */
    await page.goto('/');

    const tabs = page.getByRole('navigation', { name: 'Install' });
    const places = ['Projects', 'Teams', 'Permissions', 'Audit', 'Users'];

    for (const place of places) {
      // Named whatever is drawn, which is what lets the rest of this journey go
      // on finding these by the word somebody would say. A hover shows it too,
      // for a mark somebody has not learnt yet.
      await expect(tabs.getByRole('link', { name: place })).toHaveAttribute('title', place);
    }

    // The place you are says its word. The others are the mark alone, which is
    // the whole of what this took back.
    await expect(tabs.getByRole('link', { name: 'Projects' })).toHaveText('Projects');
    await expect(tabs.getByRole('link', { name: 'Teams' })).toHaveText('');

    // And it is the accent, and the page, that says which one that is.
    await expect(tabs.getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      await tabs
        .getByRole('link', { name: 'Projects' })
        .evaluate((tab) => getComputedStyle(tab).color),
    ).toBe(await tokenColour(page, '--color-accent'));

    // The word travels with you rather than belonging to Projects.
    await tabs.getByRole('link', { name: 'Teams' }).click();
    await expect(page.getByRole('heading', { name: 'Teams', level: 1 })).toBeAttached();
    await expect(tabs.getByRole('link', { name: 'Teams' })).toHaveText('Teams');
    await expect(tabs.getByRole('link', { name: 'Projects' })).toHaveText('');

    /*
     * Everything in the bar sits on one axis: the five marks, and the screen's
     * own controls at the far end of it.
     *
     * Measured rather than eyeballed, the way the sidebar's strip is, because
     * one tab is a mark beside a word at title size and the other four are a
     * mark on their own — so the row is only level if the tall tab and the short
     * ones are centred against each other rather than hung off a baseline.
     */
    const centres = await tabs.evaluate((nav) => {
      const bar = nav.closest('[class*="header"]')!;

      return [
        ...nav.querySelectorAll('svg'),
        ...bar.querySelectorAll('[class*="actions"] > *'),
      ].map((element) => {
        const box = element.getBoundingClientRect();

        return Math.round(box.top + box.height / 2);
      });
    });

    // Exactly, not nearly — and there is a row of them to be level, rather than
    // one thing that is trivially level with itself.
    expect(centres.length).toBeGreaterThan(5);
    expect(Math.max(...centres) - Math.min(...centres)).toBe(0);
  });

  test('reaches the trail from its own tab, and narrows it', async () => {
    /*
     * A tab of its own, beside Teams and Permissions.
     *
     * The trail is where somebody goes when something has gone wrong and they
     * need to know who did what, which is not a moment to be hunting for a
     * link on another screen. Drawn for whoever may `audit.view`, which a
     * permission group can hand to somebody who is not an owner.
     */
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Install' })
      .getByRole('link', { name: 'Audit' })
      .click();
    await expect(page).toHaveURL(/\/audit$/);

    const trail = page.getByRole('list', { name: 'The trail' });

    await expect(trail).toBeVisible({ timeout: 20_000 });

    // Everything above this point in the journey is in here, so the team made
    // two steps ago is a thing that definitely happened.
    const search = page.getByLabel('Search the trail');

    await search.fill('Outsourcers');
    await expect(trail.getByText('Outsourcers').first()).toBeVisible({ timeout: 20_000 });

    // And a search is a search: words that are not in it find nothing, and the
    // screen says which kind of nothing that is.
    await search.fill('gwmzqx');
    await expect(page.getByText('Nothing matches that', { exact: false })).toBeVisible({
      timeout: 20_000,
    });

    await search.fill('');

    /*
     * The chips ask a different question from the box: what kind of thing,
     * rather than what was done to it. Projects were made in this journey and
     * no card key or person's name says "project", so this is the filter doing
     * the work rather than the search.
     */
    await page.getByRole('radio', { name: 'Projects' }).click();
    await expect(trail.getByText('Created the project').first()).toBeVisible({ timeout: 20_000 });
    await expect(trail.getByText('Created a card')).toHaveCount(0);
  });

  test('paints what removes something red, and its opposite green', async () => {
    /*
     * Red takes something away, green is the other half of such a pair, and
     * everything else is the accent this product is built in. A Delete that
     * looks exactly like a Save is the mistake this exists to prevent.
     */
    await page.goto('/teams');
    await page.getByRole('button', { name: 'New team' }).click();

    const naming = page.getByRole('dialog', { name: 'New team' });
    const ground = async (button: Locator): Promise<string> =>
      button.evaluate((element) => getComputedStyle(element).backgroundColor);

    /*
     * Against the tokens themselves rather than against a guess at what red
     * looks like. Orange and red are close enough in channel values that any
     * rule of thumb separating them is a rule of thumb about these two
     * particular colours, which is a test that breaks when the palette moves
     * for an unrelated reason.
     */
    const cancel = await ground(naming.getByRole('button', { name: 'Cancel' }));
    const make = await ground(naming.getByRole('button', { name: 'Make team' }));

    // Abandoning what you typed is the red one; making the team is the green.
    expect(cancel).toBe(await tokenColour(page, '--color-danger'));
    expect(make).toBe(await tokenColour(page, '--color-ok'));

    await naming.getByRole('button', { name: 'Cancel' }).click();

    /*
     * And a button that does neither keeps the accent, which is what makes the
     * other two mean anything. Signing out makes nothing and takes nothing
     * away — it ends a session that was going to end anyway.
     *
     * It is inside the account window rather than in the header: what is in the
     * corner now is your picture, and everything you do to your own account is
     * behind it.
     */
    await page.getByRole('button', { name: 'Your account' }).click();

    const account = page.getByRole('dialog', { name: 'Your account' });
    const signOut = account.getByRole('button', { name: 'Sign out' });

    expect(await ground(signOut)).toBe(await tokenColour(page, '--color-accent'));

    await account.getByRole('button', { name: 'Close' }).click();
  });

  test('changes your own name, letters and picture, from your own account', async () => {
    /*
     * There was nowhere to do any of this. The password was on the Users screen,
     * which is behind `user.view` — so on a real install most people could not
     * reach it — and a name typed wrong at setup was typed wrong for ever.
     */
    await page.goto('/');
    await page.getByRole('button', { name: 'Your account' }).click();

    const account = page.getByRole('dialog', { name: 'Your account' });

    // The address you sign in with is said, and not offered: changing it changes
    // what you sign in with, and nothing here can prove a new one is yours.
    await expect(account.getByText(STUDIO.email)).toBeVisible();
    await expect(account.getByLabel('Display name')).toHaveValue(STUDIO.owner);

    await account.getByLabel('Display name').fill('Jacob Winters');
    await account.getByLabel('Initials').fill('JBW');
    await account.getByRole('button', { name: 'Save' }).click();

    // The corner draws from the session rather than from the screen, so it says
    // so without a reload. By its title: outside a project the corner is the
    // picture alone, and there is no room for a name to read.
    await expect(page.getByRole('button', { name: 'Your account' })).toHaveAttribute(
      'title',
      'Jacob Winters',
    );

    // A picture, which replaces the letters wherever there is room for a face.
    await account.getByLabel('Picture').setInputFiles({
      name: 'jake.png',
      mimeType: 'image/png',
      buffer: PIXEL,
    });

    // By the element rather than by role: the preview is decorative — the
    // initials beside it already say whose face this is — so it carries an
    // empty alt and has no role to be found by.
    await expect(account.locator('img')).toBeVisible({ timeout: 20_000 });

    /*
     * And it is drawn wherever a person is drawn, not only here.
     *
     * The Users list is the check: it draws everybody on the install, and it
     * drew initials and nothing else until now — so a picture set in this
     * window that did not reach that table would be a picture only its owner
     * ever saw.
     */
    await account.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('link', { name: 'Users' }).click();

    const theirRow = page.getByRole('row', { name: new RegExp('Jacob Winters') });
    const face = theirRow.locator('img');

    await expect(face).toBeVisible();

    /*
     * And cropped to its box rather than stretched into it.
     *
     * Every one of these marks is a square built for two letters, so an image
     * dropped into one without `object-fit` is squashed to fit. It is set on
     * `Avatar` rather than on the nine stylesheets that own those boxes, and
     * this is what says so.
     */
    expect(await face.evaluate((element) => getComputedStyle(element).objectFit)).toBe('cover');

    await page.getByRole('button', { name: 'Your account' }).click();

    // And back, because the rest of this journey knows who it made.
    await account.getByLabel('Display name').fill(STUDIO.owner);
    await account.getByLabel('Initials').fill('JW');
    await account.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Your account' })).toHaveAttribute(
      'title',
      STUDIO.owner,
    );

    await account.getByRole('button', { name: 'Close' }).click();
  });

  test('names somebody in a comment, and reaches them on their own screen', async () => {
    /*
     * The one thing about `@` that unit tests cannot answer.
     *
     * Both halves of it are covered on their own already — what a mark parses
     * to, who is allowed to be told — and neither says whether a person typing
     * an `@` ends up telling anybody. That runs through a picker, an id written
     * into the text, a second person's session, a red circle, and a board
     * loading a card it was not on. It is a sequence, and this is the only
     * place a sequence is checked.
     */
    await page.goto('/users');

    // Suspended earlier in the journey, and somebody who cannot sign in cannot
    // be told anything.
    await page
      .getByRole('row')
      .filter({ hasText: 'Mira Kaur' })
      .getByRole('button', { name: 'Let back in' })
      .click();

    await expect(
      page
        .getByRole('row')
        .filter({ hasText: 'Mira Kaur' })
        .getByRole('button', { name: 'Suspend' }),
    ).toBeVisible();

    // And onto the project, because a mention of somebody who cannot open the
    // card is a notification leading to a page saying the thing does not exist.
    //
    // Through the launcher and the sidebar rather than by address: the slug is
    // made from the project's name and the journey has never had to know it.
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Settings' })
      .click();

    const adder = page.getByRole('searchbox', { name: 'Put somebody, or a team, on this project' });

    await expect(adder).toBeVisible({ timeout: 20_000 });
    await adder.fill('Mira');
    await page.getByRole('button', { name: /Mira Kaur/ }).click();

    await expect(page.getByRole('region', { name: 'Team' }).getByText('Mira Kaur')).toBeVisible();

    // Now the sentence. The name is chosen from the picker rather than typed,
    // which is what puts her id into the text.
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();
    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const card = page.getByRole('dialog', { name: 'Card' });
    const saying = card.getByRole('textbox', { name: 'Add a comment' });

    await expect(saying).toBeVisible({ timeout: 20_000 });
    await saying.fill('@Mi');

    await card.getByRole('button', { name: /Mira Kaur/ }).click();
    await saying.pressSequentially('can you take the deck?');
    await card.getByRole('button', { name: 'Comment' }).click();

    /*
     * Read back as a sentence, not as the mark that carries the id.
     *
     * The whole point of storing `@[Mira Kaur](user:018f…)` is that the name
     * survives her being renamed — and the whole point of rendering it is that
     * nobody ever sees that.
     */
    const said = card.getByText('@Mira Kaur can you take the deck?');

    await expect(said).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText('user:', { exact: false })).toHaveCount(0);

    // Nothing waiting for the person who wrote it: a red circle for a sentence
    // you have just typed is a notification about your own hands.
    await page.goto('/');
    await expect(page.getByRole('button', { name: /waiting for you/ })).toHaveCount(0);

    await signOut(page);
    await signIn(page, 'mira@northwind.studio', 'a phrase beats a puzzle');

    // Hers, on the launcher, where she lands.
    const mark = page.getByRole('button', { name: '1 waiting for you' });

    await expect(mark).toBeVisible({ timeout: 20_000 });
    await mark.click();

    const waiting = page.getByRole('dialog', { name: 'Waiting for you' });

    await expect(waiting).toContainText('Jake Winters');
    await expect(waiting).toContainText(CARD.key);
    // The words the marks stand for. A panel is read rather than pressed
    // through, and the raw mark is not a sentence.
    await expect(waiting).toContainText('@Mira Kaur can you take the deck?');

    await waiting.getByRole('button', { name: /can you take the deck/ }).click();

    // Onto the board she was not on, with the card it named already open — the
    // right one, and carrying the sentence she was told about.
    const arrived = page.getByRole('dialog', { name: 'Card' });

    await expect(arrived).toBeVisible({ timeout: 20_000 });
    await expect(arrived).toContainText(CARD.key);
    await expect(arrived).toContainText('@Mira Kaur can you take the deck?');

    // And off the mark, because the thing she was told about is on screen.
    await expect(page.getByRole('button', { name: /waiting for you/ })).toHaveCount(0);

    // Back as the owner, because the step after this one is the end of his
    // journey rather than hers.
    await signOut(page);
    await signIn(page, STUDIO.email, STUDIO.password);
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('draws only the screens somebody may open, and the ones they may not are gone', async () => {
    /*
     * Two halves of the same thing, and one signed-in session proves both.
     *
     * A permission group could already deny anything to anybody, and the
     * project sidebar drew all eight screens regardless — so somebody without
     * `board.viewList` got a Tasks icon, pressed it, and was refused. Narrowed
     * to icons it was worse: a row of pictures, some of which are doors.
     *
     * And the dashboard asks two queries behind two permissions, so a group
     * that allowed `dashboard.view` and denied `milestone.view` used to leave
     * the screen showing nothing but a refusal — naming a permission the person
     * was never trying to use.
     *
     * Mira is a member on this project from the step before, which is what
     * makes her the person to ask: an owner cannot be narrowed by a deny.
     */
    await page.goto('/permissions');
    await page.getByRole('button', { name: 'New permission group' }).click();

    const form = page.getByRole('dialog', { name: 'New permission group' });

    await form.getByLabel('Name').fill('Not the board, not the dates');
    await form.getByRole('button', { name: 'Make group' }).click();
    await expect(form).toBeHidden();

    const group = page.getByRole('region', { name: 'Not the board, not the dates' });

    await expect(group).toBeVisible();

    const board = group.getByRole('region', { name: 'Board and cards' });

    await board.getByRole('button', { name: /Board and cards/ }).click();
    await board
      .getByRole('radiogroup', { name: 'What this group says about View list — board' })
      .getByRole('radio', { name: 'Deny' })
      .click();

    const planning = group.getByRole('region', { name: 'Planning' });

    await planning.getByRole('button', { name: /Planning/ }).click();
    // The dashboard is allowed and the dates are not, which is the sentence
    // that used to leave her with neither.
    await planning
      .getByRole('radiogroup', { name: 'What this group says about View — milestone' })
      .getByRole('radio', { name: 'Deny' })
      .click();
    await planning
      .getByRole('radiogroup', { name: 'What this group says about View — dashboard' })
      .getByRole('radio', { name: 'Allow' })
      .click();

    await page.goto('/users');

    const permissions = page
      .getByRole('row')
      .filter({ hasText: 'Mira Kaur' })
      .getByRole('button', { name: 'Permissions for Mira Kaur' });

    await expect(permissions).toBeVisible({ timeout: 20_000 });
    await permissions.click();

    const giving = page.getByRole('dialog', { name: 'Mira Kaur' });

    await giving.getByRole('checkbox', { name: /Not the board, not the dates/ }).check();
    await giving.getByRole('button', { name: 'Done' }).click();

    await expect(permissions).toHaveText(/Not the board/, { timeout: 20_000 });

    // Signed in fresh, because the rules ride on the session.
    await signOut(page);
    await signIn(page, 'mira@northwind.studio', 'a phrase beats a puzzle');

    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();

    const sidebar = page.getByRole('navigation', { name: 'Project' });

    await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

    // The door that is not there. It is not disabled and not greyed: a door
    // somebody cannot open is one they will keep trying.
    await expect(sidebar.getByRole('link', { name: 'Tasks' })).toHaveCount(0);

    // Denying one screen does not take the project away.
    await expect(sidebar.getByRole('link', { name: 'Assets' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Timeline' })).toBeVisible();

    /*
     * Settings goes too, and not because of the group. Every control on that
     * screen is a change, and `project.update` is a lead's — so a member used
     * to arrive at a screen with nothing on it they could press.
     */
    await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveCount(0);

    /*
     * And the dashboard she *was* granted, which is the other issue.
     *
     * The figures, the pipeline and the budget are all `dashboard.view`, and
     * all of them were allowed. Only the release plan is missing, and it says
     * why rather than leaving a gap.
     */
    await expect(page.getByText('Open work')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'Asset pipeline' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Budget burn' })).toBeVisible();
    await expect(page.getByText('Not permitted to milestone.view.')).toBeVisible();

    // And the same door, in the second place it was drawn: the burndown block
    // linked to a board she cannot open.
    await expect(page.getByRole('link', { name: /Open task board/ })).toHaveCount(0);

    // Hiding a door grants nothing: the screen behind it refuses either way.
    const refused = await page.request.get('/api/q/board.view?slug=saltmarsh');

    expect(refused.status()).toBe(403);

    // Back as the owner, and the group away again, so the journey leaves the
    // studio as it found it.
    await signOut(page);
    await signIn(page, STUDIO.email, STUDIO.password);
    await page.goto('/permissions');
    await page.getByRole('button', { name: /Not the board, not the dates/ }).click();
    await page.getByRole('button', { name: 'Edit permission group' }).click();

    const editing = page.getByRole('dialog', { name: 'Edit permission group' });

    await editing.getByRole('button', { name: 'Delete group' }).click();
    await page
      .getByRole('dialog', { name: 'Delete Not the board, not the dates?' })
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await expect(
      page
        .getByRole('navigation', { name: 'Permission groups' })
        .getByRole('button', { name: /Not the board, not the dates/ }),
    ).toHaveCount(0);
  });

  test('gives a card to somebody, and says who raised it', async () => {
    /*
     * Both were text on the panel and neither could be set: the assignee only
     * at creation and by the API, the reporter never at all.
     *
     * The picker offers the people who reach this project, which by now is the
     * owner and Mira — she was put on it by the step before. Anybody else is
     * refused by the server whether or not the picker was what named them, and
     * that half is covered in `cards.test.ts`.
     */
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();
    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const card = page.getByRole('dialog', { name: 'Card' });

    await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 20_000 });
    await card.getByRole('button', { name: 'Edit' }).click();

    // Nobody yet, and offered by name rather than typed: an id typed by hand is
    // how a card ends up assigned to somebody who does not exist.
    const assignee = card.getByLabel('Assignee');

    await expect(assignee).toHaveValue('');
    await assignee.selectOption({ label: 'Mira Kaur' });
    await card.getByLabel('Reporter').selectOption({ label: 'Jake Winters' });

    await card.getByRole('button', { name: 'Save changes' }).click();
    await expect(card).toBeHidden();

    // Read back off a fresh panel, which is the whole question: it went to the
    // server and came back as part of the card.
    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const reopened = page.getByRole('dialog', { name: 'Card' });

    await expect(reopened.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 20_000 });
    await reopened.getByRole('button', { name: 'Edit' }).click();

    await expect(reopened.getByLabel('Assignee')).toHaveValue(/.+/);
    await expect(reopened.getByLabel('Assignee').locator('option:checked')).toHaveText('Mira Kaur');
    await expect(reopened.getByLabel('Reporter').locator('option:checked')).toHaveText(
      'Jake Winters',
    );

    await reopened.getByRole('button', { name: 'Cancel' }).click();
    await reopened.getByRole('button', { name: 'Close' }).click();
  });

  test('logs the hours a card took, in the words people say them', async () => {
    /*
     * The estimate says what a card was expected to take. Until now nothing
     * said what it took, which is the whole reason the budget screen deals in
     * estimates and calls them that.
     *
     * The same vocabulary as the estimate on purpose: a studio that says "half
     * a day" about one should not have to say "240 minutes" about the other.
     */
    await page.goto('/');
    await page.getByRole('link', { name: new RegExp(PROJECT.name) }).click();
    await page
      .getByRole('navigation', { name: 'Project' })
      .getByRole('link', { name: 'Tasks' })
      .click();
    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const card = page.getByRole('dialog', { name: 'Card' });
    const work = card.getByRole('region', { name: 'Work' });

    await expect(work).toBeVisible({ timeout: 20_000 });
    await expect(work.getByText('No hours logged yet.')).toBeVisible();

    // Live, like the conversation: coming to a card to say what you did today
    // is the whole errand, and Edit arms every field on the panel.
    await expect(card.getByRole('button', { name: 'Edit' })).toBeVisible();

    await work.getByLabel('How long').fill('3h 30m');
    await work.getByLabel('Worked on').fill('deck normals');
    await work.getByRole('button', { name: 'Log work' }).click();

    // Read back as the studio says it, not as 210.
    await expect(work.getByText('deck normals')).toBeVisible({ timeout: 20_000 });
    await expect(work).toContainText('3h 30m');
    await expect(work).toContainText(STUDIO.owner);

    // A second entry adds to the first, which is every question anybody asks of
    // these.
    await work.getByLabel('How long').fill('1d');
    await work.getByRole('button', { name: 'Log work' }).click();

    /*
     * `1d` is read as eight hours and shown as eight hours.
     *
     * Days go in and never come out, which is the rule estimates already
     * follow: a card saying `1d 3h 30m` and a card saying `11h 30m` are the
     * same card, and only one of those can be compared with the one next to it
     * at a glance.
     */
    await expect(work.getByRole('heading', { name: /Work/ })).toContainText('11h 30m', {
      timeout: 20_000,
    });

    // And it survives the panel being closed, which is the part that says it
    // reached the server rather than a piece of state.
    await card.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: new RegExp(CARD.title) }).click();

    const reopened = page
      .getByRole('dialog', { name: 'Card' })
      .getByRole('region', { name: 'Work' });

    await expect(reopened).toContainText('11h 30m', { timeout: 20_000 });

    // Your own comes back off, and the total follows it down.
    await reopened
      .getByRole('listitem')
      .filter({ hasText: 'deck normals' })
      .getByRole('button', { name: 'Remove' })
      .click();

    await expect(reopened.getByText('deck normals')).toHaveCount(0, { timeout: 20_000 });
    // The day that is left, said as the eight hours it is.
    await expect(reopened.getByRole('heading', { name: /Work/ })).toContainText('8h');

    await page.getByRole('dialog', { name: 'Card' }).getByRole('button', { name: 'Close' }).click();
  });

  test('reads the app in the theme it was asked for, and keeps it', async () => {
    /*
     * A theme is a fact about the person, so it lives on the server and comes
     * back with `identity.me` — well after the first paint. The last answer is
     * cached in storage and read by an inline script before the bundle, which
     * is the only part of this a browser can prove.
     */
    await page.goto('/');
    await page.getByRole('button', { name: 'Your account' }).click();

    const account = page.getByRole('dialog', { name: 'Your account' });
    const themes = account.getByRole('radiogroup', { name: 'Theme' });

    await expect(themes).toBeVisible();
    await expect(themes.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const groundIn = async (): Promise<string> =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    const dark = await groundIn();

    await themes.getByRole('radio', { name: 'Light' }).click();

    // The app turns, and it turns because the server said so: nothing in the
    // browser writes the attribute except the reply to `identity.me`.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light', {
      timeout: 20_000,
    });
    await expect(themes.getByRole('radio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const light = await groundIn();

    expect(light).not.toBe(dark);

    await account.getByRole('button', { name: 'Close' }).click();

    /*
     * And it survives a reload without a flash of the other one.
     *
     * Asserted on the attribute at the first opportunity rather than by
     * watching for a flicker: the inline script sets it before the bundle
     * parses, so if the cache were not written this would be `dark` here and
     * only become `light` once the query answered.
     */
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const remembered = await page.evaluate(() => localStorage.getItem('lpm.theme'));

    expect(remembered).toBe('light');

    // Back to dark, because the rest of this journey is written about it and a
    // theme is a fact about the person rather than about this test.
    await page.getByRole('button', { name: 'Your account' }).click();
    await page
      .getByRole('dialog', { name: 'Your account' })
      .getByRole('radio', { name: 'Dark' })
      .click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 20_000 });

    await page
      .getByRole('dialog', { name: 'Your account' })
      .getByRole('button', { name: 'Close' })
      .click();
  });

  test('makes an agent, and its key reaches the install', async () => {
    /*
     * The half of this that only a browser can answer: a key made on a screen,
     * copied out of the one place it is ever shown, and then presented by
     * something that is not this browser at all.
     *
     * What the agent may do is a permissions question and is covered in
     * `people.test.ts`. What this proves is that the key works, that the secret
     * is shown once and stored nowhere, and that revoking it stops it.
     */
    await page.goto('/users');

    // Its own tab beside the people, because almost nothing a person's row
    // offers means anything on an agent.
    await page
      .getByRole('navigation', { name: 'Users' })
      .getByRole('link', { name: 'Agents' })
      .click();

    const agents = page.getByRole('region', { name: 'Agents' });

    await expect(agents).toBeVisible({ timeout: 20_000 });
    await expect(agents.getByText('No agents yet.', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'New agent' }).click();

    const adding = page.getByRole('dialog', { name: 'New agent' });

    await adding.getByLabel('Name').fill('Claude');

    // Nothing to choose but the name. What it may do is a permissions question,
    // and a role picker beside it would be a second answer to it.
    await expect(adding.getByLabel('Role')).toHaveCount(0);

    await adding.getByRole('button', { name: 'Add agent' }).click();
    await expect(adding).toBeHidden();

    /*
     * The list down the side and the one picked beside it, which is how Teams
     * and Permissions read. The panels are what an agent is.
     */
    await expect(page.getByRole('navigation', { name: 'Agents' })).toContainText('Claude');

    const settings = page.getByRole('region', { name: 'Agent' });
    const permissions = page.getByRole('region', { name: 'Permissions' });
    const keys = page.getByRole('region', { name: 'Keys' });

    await expect(settings.getByLabel('Name')).toHaveValue('Claude');
    // Nothing at all, which is the state it is made in.
    await expect(permissions.getByRole('listitem')).toHaveCount(0);

    /*
     * A permission group, on and off, with the panel keeping up.
     *
     * The panel did not: the command that sets a user's groups refreshed the
     * people and the groups and never the agents, so adding one changed nothing
     * on screen until the page was reloaded — and taking one away looked
     * equally like nothing had happened.
     */
    await permissions.getByLabel('Add a permission group').selectOption({ label: 'Agents' });

    await expect(permissions.getByText('Agents', { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(permissions).toContainText('1 held');

    await permissions.getByRole('button', { name: 'Take away' }).click();

    // Gone from the panel, which is the half that was not happening.
    await expect(permissions.getByRole('listitem')).toHaveCount(0, { timeout: 20_000 });

    /*
     * The thing to hand an assistant, with this install's own address in it.
     *
     * The address is the part somebody gets wrong: behind a tunnel it is not
     * the host in the browser bar, and the app is the only thing that knows it.
     */
    await settings.getByRole('button', { name: 'How to use' }).click();

    const howTo = page.getByRole('dialog', { name: 'How to use' });

    await expect(howTo).toContainText('You are Claude, an agent');
    await expect(howTo).toContainText('/api/q/board.view');
    // The two things that fail silently if they are skipped.
    await expect(howTo).toContainText('Put Claude on the projects it works on');
    await expect(howTo).toContainText('Cloudflare answered');

    await howTo.getByRole('button', { name: 'Close' }).click();

    // Its picture, chosen by somebody else because it cannot choose one itself.
    // Exact: the face beside it is labelled "Choose a picture for Claude".
    await settings.getByLabel('Picture for Claude', { exact: true }).setInputFiles({
      name: 'claude.png',
      mimeType: 'image/png',
      buffer: PIXEL,
    });

    // And the other half of the errand is on the same screen: where to point
    // something, and how it says who it is.
    await expect(page.getByRole('region', { name: 'Connecting a client' })).toContainText(
      'Authorization: Bearer',
    );

    await keys.getByRole('button', { name: 'New key' }).click();
    await keys.getByLabel('What this key is for').fill('the e2e run');
    await keys.getByRole('button', { name: 'Make key' }).click();

    // The one moment it is readable.
    const secret = await keys.locator('code').first().textContent({ timeout: 20_000 });

    expect(secret).toMatch(/^lpm_/u);

    await keys.getByRole('button', { name: 'Done' }).click();

    /*
     * Now use it as a program would: a bare request with a bearer token and no
     * cookie at all, made outside the browser's session.
     */
    const asAgent = await page.request.get('/api/q/identity.me', {
      headers: { authorization: `Bearer ${secret ?? ''}` },
    });

    expect(asAgent.status()).toBe(200);
    expect(await asAgent.json()).toMatchObject({ data: { user: { displayName: 'Claude' } } });

    // And the secret is nowhere on the screen once it has been dismissed: only
    // a hash is stored, so nothing can put it back.
    await page.reload();
    await expect(keys.getByText('the e2e run')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText(secret ?? 'never-matches');

    await keys.getByRole('button', { name: 'Revoke' }).click();

    /*
     * Waited for by something the revoke changes, rather than by the name of
     * the key — which was already on screen before the press, so the assertion
     * passed instantly and the request below raced the command that was meant
     * to have stopped it. Caught as a `200` where a `401` was expected, about
     * one run in fifteen.
     *
     * The row stays and says when it stopped: one that vanished would leave
     * somebody wondering whether they had revoked it or imagined it.
     */
    await expect(keys.getByText('the e2e run')).toBeVisible();
    await expect(keys.getByText('Stopped', { exact: false })).toBeVisible();
    await expect(keys.getByRole('button', { name: 'Revoke' })).toHaveCount(0);

    const afterRevoke = await page.request.get('/api/q/identity.me', {
      headers: { authorization: `Bearer ${secret ?? ''}` },
    });

    expect(afterRevoke.status()).toBe(401);
  });

  test('lets go of the session when asked', async () => {
    // From the launcher rather than from wherever the step before ended: signing
    // out is not a step in the journey so much as the end of it.
    await page.goto('/');

    await page.getByRole('button', { name: 'Your account' }).click();
    await page
      .getByRole('dialog', { name: 'Your account' })
      .getByRole('button', { name: 'Sign out' })
      .click();

    // Waited on first, because it is the part that travels: the launcher and
    // the sign-in screen swap together, so whichever is asserted first is the
    // one carrying the wait.
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });

    // Then the session is gone, which is what this test is about.
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toHaveCount(0);

    /*
     * And the studio's logo slot is on the panel, drawing the product's mark.
     *
     * A default rather than a decoration: there is nowhere for a studio to put
     * their own yet, and this is the one place in the app a logo belongs. The
     * same file the tab is drawn from, so a mark that changes changes once.
     */
    const mark = page.getByRole('img', { name: 'LazyProjectManager' });

    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('src', '/icon.svg');

    /*
     * Then the sign-in screen, given room to arrive.
     *
     * Signing out refetches the health probe, and until that answers the auth
     * screen cannot know whether to offer sign-in, first-run setup, or a box
     * for a different address — so it shows the last of those. On a cold CI
     * machine the answer takes longer than the default five seconds, which is
     * a slow server rather than a wrong screen.
     */
  });
});

/**
 * Ends the session, from wherever the journey happens to be.
 *
 * From the launcher rather than in place: the account window is on both shells,
 * but only one of them is certain to be there after a card has been opened over
 * a board.
 */
async function signOut(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Your account' }).click();
  await page
    .getByRole('dialog', { name: 'Your account' })
    .getByRole('button', { name: 'Sign out' })
    .click();

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
}

/** Signs somebody in, and waits until the app behind it has drawn. */
async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible({ timeout: 20_000 });
}

/**
 * What a design token resolves to, in the same `rgb(…)` a computed style is in.
 *
 * Read off the running page rather than imported: the tokens are rendered into
 * a stylesheet at build time, so the page is the only place the value and the
 * thing painted with it are guaranteed to agree.
 */
async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');

    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    document.body.append(probe);

    const resolved = getComputedStyle(probe).color;

    probe.remove();

    return resolved;
  }, token);
}
