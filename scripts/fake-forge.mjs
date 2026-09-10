import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';

/**
 * A forge that is not real, for testing the half of this that talks to one.
 *
 * Connecting a repository, reading its issues onto the board and labelling them
 * back could only be tried against GitHub — which meant deploying to try a
 * change, and testing against a studio's real issues, where a bug writes labels
 * onto work somebody is actually doing.
 *
 * So: a few hundred lines that answer the handful of requests this product makes,
 * holding its issues in memory, with a page you can open and press buttons on.
 * Close an issue here, press Sync issues there, and watch the card arrive at the
 * end of the board.
 *
 * Development only. It is in `docker/compose.yml` and deliberately not in
 * `docker/install/compose.yml`, it has no dependencies, and nothing under
 * `app/` knows it exists — a connection points at it the same way it would
 * point at a GitHub Enterprise install, because to this product that is
 * exactly what it is.
 */

/** @typedef {{ name: string }} LabelRef */
/** @typedef {{ id: number, number: number, title: string, body: string, state: string, updated_at: string, html_url: string, labels: LabelRef[] }} Issue */
/** @typedef {{ name: string, color: string }} Label */
/** @typedef {{ status: number, body: unknown }} Answer */
/** @typedef {{ status: number, location: string }} Redirect */

const PORT = Number(process.env.FAKE_FORGE_PORT ?? 3010);

/** The repository this pretends to be. Any owner/name works; this is what the page says. */
const REPO = process.env.FAKE_FORGE_REPO ?? 'northwind/saltmarsh';

/**
 * A key that will sign.
 *
 * The product signs an assertion with it before asking for a token, so a key
 * that cannot sign fails inside the product rather than here — a confusing way
 * to learn that this forge is fake. Generated per start; nothing here checks a
 * signature, and the point is only that the paste-in is a real PEM.
 */
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

/**
 * @param {{ number: number, title: string, body: string, names: string[] }} draft
 * @returns {Issue}
 */
function makeIssue({ number, title, body, names }) {
  return {
    id: 9000 + number,
    number,
    title,
    body,
    state: 'open',
    // The board compares this against the card to decide which side changed
    // last, so it has to move whenever something here does.
    updated_at: new Date().toISOString(),
    html_url: `https://example.invalid/${REPO}/issues/${String(number)}`,
    labels: names.map((name) => ({ name })),
  };
}

/** @type {Issue[]} Held in memory and edited from the page. */
const issues = [
  makeIssue({
    number: 1,
    title: 'Crane winch clips through the deck',
    body: 'Only at the top of its travel.',
    names: ['bug'],
  }),
  makeIssue({
    number: 2,
    title: 'Harbour fog needs a second pass',
    body: 'Too thick at dusk, the lamps disappear.',
    names: [],
  }),
  makeIssue({
    number: 3,
    title: 'Retopologise the deck planks',
    body: 'Nine thousand triangles for a walkway.',
    names: [],
  }),
  makeIssue({
    number: 4,
    title: 'Mooring rope physics jitter',
    body: 'Reproduces on the north quay every time.',
    names: ['bug'],
  }),
];

/** @type {Label[]} What the repository holds. The product adds to these when it labels an issue. */
const labels = [
  { name: 'bug', color: 'd73a4a' },
  { name: 'enhancement', color: 'a2eeef' },
];

/** For the Builds page, so releases can be tried here too. */
const releases = [
  {
    id: 9001,
    tag_name: 'v0.4.0',
    name: 'Vertical slice',
    body: '## Added\n- The harbour\n- Crane rigging',
    published_at: '2026-08-02T09:12:44Z',
    target_commitish: '4f2ac91',
    prerelease: false,
    draft: false,
    html_url: `https://example.invalid/${REPO}/releases/tag/v0.4.0`,
    author: { login: 'build-bot' },
    assets: [
      {
        name: 'win64.zip',
        size: 4_509_715_661,
        download_count: 38,
        // What a real forge sends and what the page now hands to somebody.
        browser_download_url: 'http://127.0.0.1:3010/downloads/win64.zip',
      },
    ],
  },
];

let lastNumber = issues.length;

/**
 * @param {string | undefined} number
 * @returns {Issue | undefined}
 */
function findIssue(number) {
  return issues.find((each) => each.number === Number(number));
}

/**
 * The requests this product makes, in the order it makes them.
 *
 * A list of patterns rather than a router, because it is a handful of endpoints
 * and a router would be the largest thing in the file.
 *
 * @param {string} method
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @returns {Answer}
 */
function answer(method, path, body) {
  // A GitHub Enterprise install serves its API under this, and the product adds
  // it to whatever endpoint it is given.
  const route = path.replace(/^\/api\/v3/u, '');

  if (method === 'POST' && /^\/app\/installations\/[^/]+\/access_tokens$/u.test(route)) {
    return { status: 201, body: { token: 'fake-installation-token', expires_at: inAnHour() } };
  }

  const repo = /^\/repos\/[^/]+\/[^/]+(?<rest>\/.*)?$/u.exec(route);

  if (repo === null) {
    return { status: 404, body: { message: 'Not Found' } };
  }

  return aboutTheRepository({
    method,
    rest: (repo.groups?.rest ?? '').split('?')[0] ?? '',
    body,
  });
}

/**
 * Everything under `/repos/owner/name`.
 *
 * @param {{ method: string, rest: string, body: Record<string, unknown> }} asked
 * @returns {Answer}
 */
function aboutTheRepository({ method, rest, body }) {
  // The access check, made when credentials are saved.
  if (rest === '') {
    return { status: 200, body: { full_name: REPO } };
  }

  if (rest === '/issues') {
    return method === 'POST' ? raiseIssue(body) : { status: 200, body: issues };
  }

  if (rest === '/releases') {
    return { status: 200, body: releases };
  }

  if (rest === '/labels') {
    return method === 'POST' ? createLabel(body) : { status: 200, body: labels };
  }

  return aboutOneIssue({ method, rest, body });
}

/**
 * Everything under `/repos/owner/name/issues/41`.
 *
 * @param {{ method: string, rest: string, body: Record<string, unknown> }} asked
 * @returns {Answer}
 */
function aboutOneIssue({ method, rest, body }) {
  const oneIssue = /^\/issues\/(?<number>\d+)$/u.exec(rest);

  if (oneIssue !== null && method === 'PATCH') {
    return changeIssue(oneIssue.groups?.number, body);
  }

  const onIssue = /^\/issues\/(?<number>\d+)\/labels(?:\/(?<label>.+))?$/u.exec(rest);

  if (onIssue !== null) {
    return labelIssue({
      method,
      number: onIssue.groups?.number,
      label: onIssue.groups?.label,
      body,
    });
  }

  return { status: 404, body: { message: `Nothing here answers ${method} ${rest}` } };
}

/**
 * A card here, raised as an issue.
 *
 * @param {Record<string, unknown>} body
 * @returns {Answer}
 */
function raiseIssue(body) {
  const title = typeof body.title === 'string' ? body.title : null;

  if (title === null) {
    return { status: 422, body: { message: 'An issue needs a title' } };
  }

  lastNumber += 1;

  const raised = makeIssue({
    number: lastNumber,
    title,
    body: typeof body.body === 'string' ? body.body : '',
    names: [],
  });

  issues.unshift(raised);

  return { status: 201, body: raised };
}

/**
 * An issue brought into line with its card: the title, the body, or whether it
 * is open. Nothing else about it is ever written.
 *
 * @param {string | undefined} number
 * @param {Record<string, unknown>} body
 * @returns {Answer}
 */
function changeIssue(number, body) {
  const found = findIssue(number);

  if (found === undefined) {
    return { status: 404, body: { message: 'No such issue' } };
  }

  if (typeof body.title === 'string') {
    found.title = body.title;
  }

  if (typeof body.body === 'string') {
    found.body = body.body;
  }

  if (body.state === 'open' || body.state === 'closed') {
    found.state = body.state;
  }

  found.updated_at = new Date().toISOString();

  return { status: 200, body: found };
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Answer}
 */
function createLabel(body) {
  const name = typeof body.name === 'string' ? body.name : null;

  if (name === null) {
    return { status: 422, body: { message: 'A label needs a name' } };
  }

  if (labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
    // What GitHub says, and what the product is written to expect.
    return { status: 422, body: { message: 'already_exists' } };
  }

  labels.push({ name, color: typeof body.color === 'string' ? body.color : 'ededed' });

  return { status: 201, body: { name } };
}

/**
 * @param {{ method: string, number: string | undefined, label: string | undefined, body: Record<string, unknown> }} asked
 * @returns {Answer}
 */
function labelIssue({ method, number, label, body }) {
  const found = findIssue(number);

  if (found === undefined) {
    return { status: 404, body: { message: 'No such issue' } };
  }

  if (method === 'POST') {
    const adding = Array.isArray(body.labels) ? body.labels.map((each) => String(each)) : [];

    for (const name of adding) {
      if (!found.labels.some((each) => each.name.toLowerCase() === name.toLowerCase())) {
        found.labels.push({ name });
      }
    }

    return { status: 200, body: found.labels };
  }

  if (method === 'DELETE') {
    const name = decodeURIComponent(label ?? '');
    const before = found.labels.length;

    found.labels = found.labels.filter((each) => each.name.toLowerCase() !== name.toLowerCase());

    return before === found.labels.length
      ? { status: 404, body: { message: 'Label does not exist' } }
      : { status: 200, body: found.labels };
  }

  return { status: 405, body: { message: 'Not something this answers' } };
}

/**
 * The buttons: what a person does to this forge to see the product react.
 *
 * @param {string} method
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @returns {Redirect | null}
 */
function control(method, path, body) {
  if (method !== 'POST') {
    return null;
  }

  const changed = /^\/fake\/issues\/(?<number>\d+)\/(?<action>close|reopen)$/u.exec(path);

  if (changed !== null) {
    const found = findIssue(changed.groups?.number);

    if (found !== undefined) {
      found.state = changed.groups?.action === 'close' ? 'closed' : 'open';
      found.updated_at = new Date().toISOString();
    }

    return { status: 303, location: '/' };
  }

  if (path === '/fake/issues') {
    const asked = typeof body.title === 'string' ? body.title.trim() : '';

    lastNumber += 1;
    issues.unshift(
      makeIssue({
        number: lastNumber,
        title: asked === '' ? 'A new issue' : asked,
        body: 'Raised on the fake forge.',
        names: [],
      }),
    );

    return { status: 303, location: '/' };
  }

  return null;
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
function readBody(request, raw) {
  if (raw === '') {
    return {};
  }

  if ((request.headers['content-type'] ?? '').includes('application/json')) {
    try {
      const parsed = /** @type {unknown} */ (JSON.parse(raw));

      return typeof parsed === 'object' && parsed !== null
        ? /** @type {Record<string, unknown>} */ (parsed)
        : {};
    } catch {
      return {};
    }
  }

  return Object.fromEntries(new URLSearchParams(raw));
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {{ status: number, body: string, type: string }} answered
 */
function send(response, { status, body, type }) {
  response.writeHead(status, { 'content-type': type });
  response.end(body);
}

/** @returns {string} */
function inAnHour() {
  return new Date(Date.now() + 3_600_000).toISOString();
}

/**
 * @param {string} text
 * @returns {string}
 */
function escape(text) {
  return text.replace(/[&<>"]/gu, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character;
  });
}

/**
 * The page. Plain HTML and no build step, because this is a workbench.
 *
 * @returns {string}
 */
function page() {
  const rows = issues
    .map((each) => {
      const wearing = each.labels
        .map((label) => `<span class=l>${escape(label.name)}</span>`)
        .join(' ');
      const action = each.state === 'open' ? 'close' : 'reopen';

      return `<tr>
        <td class=n>#${String(each.number)}</td>
        <td><b>${escape(each.title)}</b><div class=lab>${wearing}</div></td>
        <td class="s ${escape(each.state)}">${escape(each.state)}</td>
        <td><form method=post action="/fake/issues/${String(each.number)}/${action}"><button>${action}</button></form></td>
      </tr>`;
    })
    .join('');

  return `<!doctype html><meta charset=utf-8><title>Fake forge — ${escape(REPO)}</title>
<style>
 body{background:#242424;color:#f2f2f2;font:14px/1.5 system-ui,sans-serif;margin:0;padding:32px}
 h1{font-size:20px;margin:0 0 4px}
 p.sub{color:#adadad;margin:0 0 24px}
 table{border-collapse:collapse;width:100%;max-width:860px}
 td{border-bottom:1px solid #4e4e4e;padding:10px 8px;vertical-align:top}
 td.n{color:#8c8c8c;font-family:ui-monospace,monospace;width:52px}
 td.s{width:80px;font-family:ui-monospace,monospace}
 .open{color:#63eba3}.closed{color:#eb7d73}
 .lab{margin-top:6px}
 span.l{display:inline-block;background:#3a3a3a;border:1px solid #4e4e4e;border-radius:3px;padding:1px 6px;margin-right:4px;font-size:12px;color:#eda363}
 button{background:none;border:1px solid #4e4e4e;border-radius:3px;color:#f2f2f2;padding:4px 10px;cursor:pointer;font:inherit}
 button:hover{background:#3a3a3a}
 form.new{margin:24px 0 0;display:flex;gap:8px;max-width:860px}
 input{flex:1;background:#1c1c1c;border:1px solid #4e4e4e;border-radius:3px;color:#f2f2f2;padding:6px 8px;font:inherit}
 details{margin-top:32px;max-width:860px;color:#adadad}
 pre{background:#1c1c1c;border:1px solid #4e4e4e;border-radius:5px;padding:12px;overflow-x:auto;font-size:12px}
 code{color:#eda363;font-family:ui-monospace,monospace}
</style>
<h1>Fake forge</h1>
<p class=sub>Pretending to be <code>${escape(REPO)}</code>. Nothing here is real, and nothing leaves this machine.</p>
<table>${rows}</table>
<form class=new method=post action="/fake/issues">
  <input name=title placeholder="Raise another issue…" aria-label="Issue title">
  <button>Raise it</button>
</form>
<details open>
  <summary>Pointing a project at this</summary>
  <p>Project → Settings → Repository. Provider <code>GitHub</code>, repository
     <code>${escape(REPO)}</code>, server address <code>http://fake-forge:3010</code>
     — the name the app container reaches it by, rather than the one your browser uses.</p>
  <p>Then <b>Reading releases</b>, with any app id and installation id you like, and this key:</p>
  <pre>${escape(privateKey.trim())}</pre>
  <p>Now press the sync button on the board. Close an issue above, sync again, and watch the card
     reach the end of the board — and the label change here.</p>
  <p>It goes the other way too: write a card on the board and sync, and the issue appears in this
     list. Rename the card, or drag it to the last column, and the next sync brings this into line.
     The worker does the same thing every half hour without anybody pressing anything.</p>
</details>`;
}

const server = createServer((request, response) => {
  /** @type {Buffer[]} */
  const chunks = [];

  request.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
  request.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const path = (request.url ?? '/').split('#')[0] ?? '/';
    const method = request.method ?? 'GET';

    console.log(`${method} ${path}`);

    if (path === '/' || path.startsWith('/?')) {
      send(response, { status: 200, body: page(), type: 'text/html; charset=utf-8' });
      return;
    }

    const body = readBody(request, raw);
    const pressed = control(method, path.split('?')[0] ?? '/', body);

    if (pressed !== null) {
      response.writeHead(pressed.status, { location: pressed.location });
      response.end();
      return;
    }

    const given = answer(method, path, body);

    send(response, {
      status: given.status,
      body: JSON.stringify(given.body),
      type: 'application/json',
    });
  });
});

server.listen(PORT, () => {
  console.log(`Fake forge pretending to be ${REPO} on http://localhost:${String(PORT)}`);
});
