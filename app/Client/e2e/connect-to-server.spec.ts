import { expect, test } from '@playwright/test';

/** Where the client records the server somebody typed on the connect screen. */
const BASE_URL_KEY = 'lpm.apiBaseUrl';

/** A port nothing is listening on, which is what a typo amounts to. */
const NOTHING_LISTENING = 'http://127.0.0.1:9';

test.describe('the signed-out client', () => {
  test('applies the design tokens rather than the browser default palette', async ({ page }) => {
    await page.goto('/');

    const backgroundColor = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );

    // --color-bg is #242424. If the generated token stylesheet failed to load,
    // this is the transparent-black default instead.
    expect(backgroundColor).toBe('rgb(36, 36, 36)');
  });

  test('names a favicon, and serves the file it names', async ({ page }) => {
    await page.goto('/');

    /*
     * A `<link rel="icon">` that points at nothing fails silently — the browser
     * draws its blank page icon and nobody finds out — so the href is followed
     * rather than merely read.
     *
     * The same file the logo slot on the sign-in panel draws, which is checked
     * where that panel appears: this spec runs before the install exists, and
     * before there is a studio there is no logo of theirs to stand in for.
     */
    const href = await page.locator('link[rel="icon"]').getAttribute('href');
    expect(href).toBe('/icon.svg');

    const served = await page.request.get(href ?? '');
    expect(served.status()).toBe(200);
    expect(served.headers()['content-type']).toContain('image/svg+xml');
    // Drawn rather than exported: an editor's output is a wall of one line.
    expect(await served.text()).toContain('<rect');
  });

  test('draws the animated backdrop behind the panel', async ({ page }) => {
    await page.goto('/');

    const canvas = page.locator('canvas');
    await expect(canvas).toHaveCount(1);

    // A canvas with no backing store is one whose animation never started.
    const backingWidth = await canvas.evaluate((element: HTMLCanvasElement) => element.width);
    expect(backingWidth).toBeGreaterThan(0);
  });

  test('never shows the app to a visitor who has not signed in', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('h1');

    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toHaveCount(0);
  });
});

/**
 * The case a person hits with a typo in the address, and the one most likely to
 * be left as a spinner forever.
 *
 * The bad address is planted in storage rather than typed, because that is where
 * the connect screen puts it — and it means the test does not depend on having
 * reached that screen first.
 */
test.describe('a client pointed at something that is not a server', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key ?? '', value ?? '');
      },
      [BASE_URL_KEY, NOTHING_LISTENING],
    );
  });

  test('falls back to the connect step and names what went wrong', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Connect to a server' })).toBeVisible();
    await expect(page.getByLabel('Server address')).toBeVisible();

    // The status must resolve to an explanation. A permanent "Checking…" is
    // what a swallowed rejection in the API client looks like from the outside.
    const status = page.getByRole('status');
    await expect(status).not.toHaveText('Checking…', { timeout: 15_000 });
    await expect(status).not.toBeEmpty();
  });

  test('connects to a server that does answer', async ({ page, baseURL }) => {
    await page.goto('/');

    await page.getByLabel('Server address').fill(baseURL ?? '');
    await page.getByRole('button', { name: 'Connect' }).click();

    // Whichever signed-out step it lands on, it is past the connect screen —
    // which is only reached when the address does not answer.
    await expect(page.getByRole('heading', { name: 'Connect to a server' })).toHaveCount(0);
  });
});
