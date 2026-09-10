# Testing standards

How this repository is tested, and why in that shape.
[`Engineering-Rules.md`](Engineering-Rules.md) covers structure;
[`CleanCode.md`](CleanCode.md) covers naming.

## Every test is GIVEN / WHEN / THEN

Nested `describe` blocks, spelled out:

```ts
describe('GIVEN an install that has never been set up', () => {
  describe('WHEN completeSetup is called with a valid owner', () => {
    it('THEN the account, owner and install settings all exist', () => {});
    it('THEN the caller is signed in', () => {});
  });

  describe('WHEN the password is shorter than the minimum', () => {
    it('THEN it fails naming admin.password, and creates nothing', () => {});
  });
});
```

One GIVEN may hold several WHENs, and one WHEN several THENs. Shared setup goes
in the GIVEN block's `beforeEach`; the action being tested goes in the WHEN
block; each THEN asserts one outcome.

The shape is not decoration. It forces the setup, the action and the expectation
apart, so a test that has quietly grown to assert two unrelated behaviours
becomes obvious — it will have two THENs that do not belong to the same WHEN.

**Write the sentence, not the function name.** `THEN a wrong password and an
unknown email are indistinguishable` says what the system guarantees.
`THEN signIn returns 401` says what the code currently does, and stops being
true the moment the code is refactored for a good reason.

## Coverage floors

**90% lines, functions and statements, 85% branches, per package, enforced by
CI.** Aim for 100% on anything that is not the web UI; the floor is where the
build breaks, not the target.

The thresholds live in `config/vitest.config.ts` and are set **per package**, not once
for the repository. A single repository-wide average lets a well-tested package
hide a poorly-tested one, which is the exact situation a coverage gate exists to
reveal.

`pnpm test:coverage` runs the gate. `pnpm coverage:summary` prints the
per-package table CI attaches to the run.

### What is excluded, and why

| Excluded                                                   | Reason                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `**/index.ts`                                              | Barrels re-export and hold no logic                                              |
| `*-tables.ts`, `database-schema.ts`, `*.d.ts`              | Type declarations, no runtime code                                               |
| `app/Server/src/index.ts`, `worker.ts`, `main.tsx`         | Process entrypoints: wiring, covered by the container healthcheck and end-to-end |
| `migrate-cli.ts`, `seed-demo-cli.ts`                       | Command-line entrypoints over tested functions                                   |
| `app/Database/src/testing/**`, `app/Server/src/testing/**` | The harness the tests run on                                                     |

`app/Client` is measured but has no floor of its own — see below.

An exclusion is a claim that something is covered another way. If it is not,
delete the exclusion instead of the test.

## The three kinds of test

**Unit — Vitest, no IO.** Everything in `app/Server/src/domain`, and any pure function
elsewhere. These run in milliseconds and need nothing started. If a rule cannot
be tested without a database, it is in the wrong package.

**Integration — Vitest against a real Postgres.** Anything that writes SQL:
command handlers, queries, migrations, the outbox drain. Use
`createTestDatabase()` from `@lpm/database/testing`, which gives each Vitest worker
its own schema, migrated with the real migration files.

_Not mocked, deliberately._ A mocked database happily passes while the
`command_log` conflict detection is wrong, the partial index is missing, or a
migration does not reverse. Those are the failures this layer exists to catch.

**End to end — Playwright against the production build.** The web UI, and any
behaviour that only exists once the browser, the bundle and the server are all
real.

## Testing the web UI

`app/Client` has **no line-coverage floor**, and that is a decision rather than an
omission.

A coverage number on a React component is satisfied by rendering it and
asserting it did not throw. That passes while the button is wired to the wrong
mutation, the error message never appears, and the form submits an empty
password. Playwright driving a real screen catches all three, and a shallow
render test catches none of them.

So: no jsdom component tests. Every screen gets Playwright coverage as it is
built, testing what a person does — fill this in, press that, see this happen.

The exception is logic that happens to live under `app/Client` but is not a
component: `api-client.ts`, `recent-servers.ts`, the design tokens. Those are
ordinary functions and may be unit tested directly.

## Rules that keep the suite worth having

- **Test the rule, not the implementation.** The authorisation tests describe
  what an outsourcer may do. They would survive a rewrite of how the check works,
  which is the point.
- **A test that needs a comment to explain why it is right is telling you
  something.** Add the comment — the reasoning is usually the most valuable part
  — but check the production code is not the thing that is unclear.
- **Never assert on a message a human wrote unless the wording is the
  behaviour.** "Wrong password and unknown email return the same message" is a
  security property worth asserting. "The button says Sign in" is not.
- **No test may depend on another test having run.** Each GIVEN block truncates
  and seeds what it needs. Tests run in parallel across workers.
- **A flaky test is a broken test.** Fix it or delete it; a suite people re-run
  until it passes is a suite nobody reads.

## A drag is finished when a click works again

`dropAndSettle` in the journey lets go of a drag and then waits, and the wait is
not padding.

`@dnd-kit/core` adds a **capture-phase** `click` listener on the document the
moment a drag activates, which calls `stopPropagation`. It is what stops the
click at the end of a drop from also pressing whatever the card landed on.
`AbstractPointerSensor.detach` removes it on a timer —
`setTimeout(removeAll, 50)` — and until that fires, **every** click is stopped
before React sees it.

So a click made too soon after a drop fires natively, on the right element,
which is still there and has not moved, and does nothing at all. It showed up as
a timeout waiting for a dialog that was never going to open, on a different test
each time. A click 46ms after a drop was swallowed; the same click 64ms after
was not.

Nobody crosses a board and clicks inside fifty milliseconds, so there is nothing
here for the product to fix — the suppression is doing its job. **End a drag
with `dropAndSettle`, never with a bare `page.mouse.up()`.**

This is the one place a fixed wait is right, because what is being waited for is
a fixed timer. Waiting for something else that merely takes longer would pass
for the wrong reason and go on passing until it did not.

## Running them

```bash
pnpm test              # unit and integration, needs pnpm stack:up
pnpm test:watch        # the same, in watch mode
pnpm test:coverage     # with the per-package gate
pnpm coverage:summary  # the per-package table
pnpm test:e2e          # Playwright, needs `pnpm exec playwright install chromium` once
```

Database-backed tests need the local stack running. They fail loudly when
`DATABASE_URL` is unset rather than skipping, because a suite that quietly passes
with half of itself disabled is worse than one that refuses to start.

## Where they run

**A pull request runs one job of checks**: `format:check`, `typecheck`, `lint`,
`build`, the unit and integration suite with its coverage gate, and a migration
up and down against a real Postgres. Cheapest first, so a stray space costs
twelve seconds rather than a full test run. Beside it, `version bump` makes sure
the version moved and `label` files the pull request.

**Playwright is not in it.** It is `e2e.yml`, run from the Actions tab against
whatever branch or tag you name. Run it locally before you open a pull request —
`pnpm test:e2e` — and from the tab before a release. It was on every push and
was the most expensive thing in the repository: an image to pull, a second
Postgres, a second build and an object store fetched over the network, for a
suite that finishes in under thirty seconds.

That does not soften the rule above. Every screen still gets Playwright coverage
as it is built; what changed is who presses the button.
