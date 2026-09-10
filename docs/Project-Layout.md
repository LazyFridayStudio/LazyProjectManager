# Project layout

Where everything lives, and where to put a new thing.

## Everything we build is under `app/`

```
app/
  Client/      Everything a person sees. React, screens, design tokens
  Server/      Everything behind the API. Fastify, business rules, the worker
  Shared/      The contract both sides agree on. Nothing else
  Database/    Tables, migrations, and the harness tests run against
```

Four folders, four packages, one for each thing a person actually thinks about.
If you are changing what the app looks like you are in `Client`; if you are
changing what it does you are in `Server`.

## The rest of the root

```
config/        How the tools are configured: lint, format, test, TypeScript
docker/        The image, the development stack, and the one that ships
docs/          These documents
scripts/       Build and CI helpers
```

**What is left at the root is what cannot move.** `package.json`,
`pnpm-workspace.yaml` and `pnpm-lock.yaml` are found by pnpm; `tsconfig.json` is
the project every editor and `tsc --build` opens; `.npmrc`, `.nvmrc`,
`.gitignore` and `.gitattributes` are read from the root by the tools that own
them; `LICENSE` and `README.md` are read by people and by GitHub.

Two are pinned by something less obvious, and both would fail quietly if moved.
`.dockerignore` is read from the **build context root**, not from beside the
Dockerfile — a missed one does not error, it ships `node_modules` into the
image. `.prettierignore` resolves its patterns relative to **itself**, so
`dist/` inside `config/` would mean `config/dist/` and every real one would stop
being ignored.

Everything under `config/` and `docker/` is named on the command that reads it,
in `package.json`. Nothing is found by magic, which is the trade: a root
somebody can read, for a flag on eight scripts.

### Inside `docker/`

```
Dockerfile      The image, built from the workspace root as its context
compose.yml     What this repository runs: the stack plus a fake forge
install/        What a release ships, verbatim
```

`install/` is the release bundle. Its three files are already named what they
are called on an installed machine, so the release workflow copies the folder
and renames nothing — a file added to it ships without the workflow being
touched.

It sits beside the development stack rather than in a `deploy/` folder of its
own because the two drifted three times while they were apart, and every one of
them was only findable by installing: a missing `APP_SECRET`, a store address
pointing at a port nothing published, and a whole missing `worker`, which meant
released installs never made a thumbnail or delivered anything the outbox
carried. `deploy-bundle.test.ts` compares the two and is the reason a fourth
would be caught in CI.

## Where do I change…

| I want to change…                                       | Go to                                                |
| ------------------------------------------------------- | ---------------------------------------------------- |
| **A screen, or anything else that renders**             | `app/Client/src/components/` — one folder per area   |
| A reusable **control** (button, input, panel)           | `app/Client/src/components/ui/`                      |
| **What a screen fetches, computes or holds**            | `app/Client/src/logic/` — the same folder names      |
| **Colours, fonts, spacing, shadows**                    | `app/Client/src/tokens/`                             |
| How the browser **talks to the server**                 | `app/Client/src/api/`                                |
| An **API endpoint**                                     | `app/Server/src/modules/<module>/`                   |
| A **business rule**                                     | `app/Server/src/domain/`                             |
| **Background work**                                     | `app/Server/src/outbox/`                             |
| The **shape of a request or response**                  | `app/Shared/src/`                                    |
| **Tables or a migration**                               | `app/Database/src/`                                  |
| How it is **built and shipped**                         | `docker/`                                            |
| **CI**                                                  | `.github/workflows/ci.yml` — one job, on PRs         |
| The **version bump**, and the labels a PR or issue gets | `version.yml`, `label.yml`, `label-issue.yml`        |
| Cutting a **release**                                   | `release.yml` — on a pushed tag                      |
| The **on-demand** browser suite or restore drill        | `.github/workflows/e2e.yml`, `restore-rehearsal.yml` |
| The **pictures in the readme**                          | `app/Client/screenshots/`, run by `pnpm screenshots` |

## `app/Client` — everything displayed

React 19, Vite, CSS Modules. Package name `@lpm/client`.

```
index.html
vite.config.ts
e2e/                  Playwright specs: the browser tests
screenshots/          The readme's pictures, taken by Playwright
src/
  main.tsx            Entry point
  router.tsx          The signed-in app's addresses
  global.css          The one stylesheet that is not a component's
  components/         Everything that renders
    AppRoot.tsx       Login screen, or the app?
    ApiClientProvider.tsx
    shell/            The sidebar, the header and the body the content sits in
    ui/               Panel, Button, Field, Select, the message display
    auth/             Connect, sign in, first-run setup, the animated backdrop
    projects/         The launcher, the create form, project settings
    board/            The card board — lists and their cards
    …                 one folder per area, and a `.module.css` beside each
  logic/              What those components fetch, compute and hold
    board/            use-board, use-cards, the drag arithmetic
    projects/         use-projects, formatting money and dates
    …                 the same folder names, minus the ones with no logic
  lib/                The few helpers every area uses: class names, locale
  api/                ApiClient: the only thing that talks to the server
  tokens/             Colours, type, shape, states
```

**The split is one sentence: if it renders, it is in `components/`; if it
fetches, computes or holds state, it is in `logic/`.** Before this they were
mixed together, and a folder of twenty files gave no clue which of them drew
anything. The folder names are the same on both sides, so a feature is two
folders and each half reads on its own.

A component keeps its stylesheet beside it, because a `.module.css` belongs to
exactly one component and moving one without the other is how a class name
outlives its use.

**The design tokens live here** because the UI is their only consumer. They are
served to the app as `virtual:lpm-tokens.css`, generated from the TypeScript
constants by a plugin in `vite.config.ts` — so the CSS and the constants cannot
drift, and there is no generated file to edit by mistake.

**In production the Client is served by the Server**, not by its own container,
which is why one port reaches the whole product.

**Screens are addressed, not switched.** A project's dashboard lives at
`/p/<slug>`, its board at `/p/<slug>/tasks` and its settings at
`/p/<slug>/settings`, so a link to any of them can be pasted into a chat and
opened. That is the whole reason a project carries a slug, and it is why
`router.tsx` exists rather than a piece of component state.

## `app/Server` — everything backend

Fastify. Serves the API _and_ the built Client. Package name `@lpm/server`.

```
src/
  index.ts            API entry point
  worker.ts           Worker entry point — same package, different process
  worker/             One pass: deliveries, the issue sync, the bin, the outbox
  domain/             Pure business rules. No database, no HTTP, no files
  server/             Fastify setup, environment, errors, rate limits, static files
  security/           Encrypting the few secrets the server must read back
  cqrs/               The command/query machinery every feature runs on
  realtime/           The WebSocket, and the invalidations it carries
  storage/            The object store
  ordering/           Placing a thing between two neighbours
  modules/            The features themselves, one folder each
    index.ts          Every handler is registered here, and nowhere else
    identity/         Sign in, sign out, first-run setup
    projects/         Create, list, open, settings, archive, who is on one
    board/            Cards and lists, and `sync/`: the GitHub issue sync
    assets/           The library: assets and their categories
    files/            Uploads, attachments, and a stable file address
    scm/              A project's repository, and the deliveries it sends
                      `forge/` asks it things, `webhook/` is asked by it,
                      `ingest/` reads what arrived
    …                 teams, permissions, milestones, releases, docs, work,
                      notifications, audit, recovery, system
  outbox/             Draining domain events to their consumers
  seed-demo/          The demo studio, as data. Run by hand, never on boot
  testing/            Stand-ins the server's own tests use
```

`domain/` is a folder rather than its own package, but the boundary is still
real: ESLint stops anything in it importing the database, HTTP, or the layers
above it. **If a rule cannot be tested without a database, it does not belong in
`domain`.**

A module holds `commands/` (writes) and `queries/` (reads). Adding a feature
means adding a module and registering it — never editing `cqrs/`.

## `app/Shared` — the contract

Zod schemas for every command, query and view. Package name `@lpm/shared`.

This is the only thing both sides import, and it is how the browser and the
server agree on what a request looks like without either importing the other.
**It depends on nothing else in the workspace**, and ESLint enforces that.

## `app/Database` — tables and migrations

Kysely types, forward-only migrations, and the test harness. Package name
`@lpm/database`.

```
src/
  schema/             Table types — what TypeScript believes the database is
  connection/         Opening a pool, health probing
  migrations/         Forward-only. Never edit one that has been applied
  migrate-cli.ts      `pnpm db:migrate`
  testing/            Per-worker schema isolation, exported as @lpm/database/testing
```

## How they depend on each other

```
        Shared
       /      \
  Client       Server ── Database
```

Arrows only point **inwards toward Shared**, and ESLint fails the build if one
points the wrong way. `Client` cannot import `Database` or `Server`.

## Where a new feature goes

Adding "archive a project" touches four places, in this order:

1. **`app/Shared/src`** — declare `projects.archive` and its input schema
2. **`app/Server/src/domain`** — the rule for whether it is allowed
3. **`app/Server/src/modules/projects/commands/archive-project.ts`** — the handler
4. **`app/Server/src/modules/index.ts`** — register it

Then the screen in `app/Client`, and a migration in `app/Database` if the schema
changed.

## Tests

Tests live **next to the code they test**, as `*.test.ts`. There is no separate
`tests/` tree.

The exceptions are `app/Client/e2e/`, which drives a real browser, and
`app/Client/screenshots/`, which drives one to take the readme's pictures.

See [`Testing-Standards.md`](Testing-Standards.md).

## Generated, never edited by hand

| Path                     | Made by                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `app/*/dist/`            | `pnpm build`                                               |
| `app/Client/dist-types/` | `tsc`                                                      |
| `.output/`               | Coverage, Playwright's traces, anything else a tool leaves |
| `docs/images/*.png`      | `pnpm screenshots`                                         |
| `pnpm-lock.yaml`         | pnpm                                                       |

All gitignored except the lockfile and the pictures.
