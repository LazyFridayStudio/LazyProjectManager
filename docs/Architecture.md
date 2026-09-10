# Architecture

The stack, and the reasoning behind it. **Ask before deviating from it.**

This describes what is built, not what was planned. Where the two disagree, the
code is right and this document is the bug.

[Flows.md](Flows.md) draws what happens when: a command from a press to the
other tab catching up, an upload, a delivery from a repository, and the two
separate questions behind who may do what.

## What it is being built for

- TypeScript everywhere, so one contract covers the browser and the server.
- Strict command/query separation.
- Self-hosted: a studio runs it on their own box with one command.
- Around a thousand people, tens of thousands of cards, and the assets and files
  a game project accumulates.

## What that scale actually asks for

A thousand people and tens of thousands of rows is small. One Postgres instance
on modest hardware carries it without sharding, a cache layer or event sourcing.
Three things matter at this size, and they are the three to hold the line on:

- **Bounded queries.** The board is one statement, never a loop over lists.
- **Files out of the database.** Binaries live in object storage and rows hold
  references to them.
- **Work off the request path.** Anything slow is a domain event a worker
  drains, not something a person waits for.

Nothing here is built for a load that will not arrive.

## The stack

| Layer      | Choice                                                     | Why                                                           |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Runtime    | Node 22, TypeScript 5.9, strict                            | One language, and contracts shared rather than restated       |
| API        | Fastify 5                                                  | Small, fast, typed, and plugins scope cleanly to modules      |
| Contracts  | Zod 3                                                      | One schema read by the server, the browser and the row parser |
| Database   | PostgreSQL 16                                              | Transactions, JSONB, full-text search                         |
| DB access  | Kysely                                                     | Typed SQL, and no ORM to argue with on the read side          |
| Migrations | Kysely, checked in, forward-only                           | Numbered, and never edited once merged                        |
| Jobs       | The worker, polling Postgres                               | Drains domain events and keeps two clocks. No second queue    |
| Files      | S3-compatible object storage, MinIO in compose             | Never binaries in Postgres                                    |
| Realtime   | WebSocket, the server pushing invalidations                | A board has to feel live                                      |
| Web        | React 19, Vite 6, TanStack Router and Query                |                                                               |
| Styling    | Tokens generated to CSS custom properties, and CSS Modules | The tokens are the contract. No Tailwind                      |
| Auth       | Session cookie, Argon2id, no third-party IdP               | Self-hosted first                                             |
| Deploy     | Docker Compose: app, worker, postgres, redis, minio        | One command                                                   |

Redis carries realtime invalidation between the app and the worker. It is not a
cache, and nothing depends on what it holds surviving a restart.

## Repository layout

```
app/
  Client/     React app: screens, and the logic behind them
  Server/     The Fastify API and the outbox worker, in one image
  Shared/     Zod contracts for every command, query and view
  Database/   Kysely schema types, migrations, and the test harness
config/       How the tools are configured
docker/       The image, the development stack, and the one that ships
docs/         These documents
```

pnpm workspaces. `Project-Layout.md` says what goes where inside each of them,
and `Engineering-Rules.md` says which may import which — the short version is
that `Server/src/domain` imports nothing but itself.

The server and the worker are one package and one image, started differently.
They share the schema, the contracts and the domain rules, and a separate
package for a process running the same code would be a second place to keep them
in step.

## Commands and queries

`POST /api/c/:commandName` and `GET /api/q/:queryName`. Every handler is
registered in `app/Server/src/modules/index.ts`, and a module is a vertical
slice: `board`, `projects`, `assets`, `identity`, `teams`, `permissions`, `scm`,
`releases`, `milestones`, `docs`, `audit`, `recovery`, `notifications`, `files`,
`work` and `system`.

```
app/Server/src/modules/board/
  commands/    input schema · handler · the events it appends
  queries/     one statement, returning a view model
```

**Commands**

- Input is a Zod schema in `app/Shared`. Nothing else may enter a handler.
- A handler enforces its invariants, writes, and appends to `domain_event`, all
  in one transaction.
- It returns identifiers, never a view model. The browser refetches the query.
- Every command carries a client-generated `commandId`, unique-indexed, so a
  retry is safe.

**Queries**

- Read-only. SQL in, view model out, shaped for one screen.
- Straight at the write tables. A materialised read table waits until a
  particular query is measured slow, and none has been.
- The board is the one to watch: one statement with a lateral join.

**Events**

`domain_event(id, account_id, aggregate_type, aggregate_id, name, payload,
actor_id, occurred_at, processed_at)`. The worker claims unprocessed rows with
`for update skip locked`, so running several is safe, and fans each out to its
consumers — realtime invalidation, and thumbnails.

A consumer that throws does not stop the batch: the event is still marked
processed and the failure is reported, because blocking the outbox on one bad
consumer is how a tracker stops updating. Consumers must be idempotent. A crash
between handling an event and marking it processed means it arrives again, and
that is the normal case rather than an edge one.

## Who may do what

Two questions, answered separately, and keeping them apart is the point.

**What somebody may do** is `can(actor, action, resource)` in
`Server/src/domain/authorization`, called at the top of every handler. The
actions come from `CATALOGUES`, and permission groups carry allow and deny
rules. A deny narrows anybody except an owner — the screen that edits a rule
sits behind that rule, and there is no support line to ring on a self-hosted
install.

**Where they may do it** is project reach. A role of owner or lead reaches every
project; everybody else reaches the ones they are named on, or are in a team
that is named on. `reachedLevel` is the single expression for that, written to
drop into any statement that has the project in scope — the launcher cannot
fetch a thousand projects to find out which six it may draw.

Roles are owner, lead, member, outsourcer and viewer. Outsourcer is scoped to
what is explicitly shared with them, and that boundary lives in the queries
rather than being bolted on later, because retrofitting it would touch every one
of them.

`Engineering-Rules.md` holds the detail, including what an owner cannot be
stopped from doing.

## Files

Uploaded through the app, stored in object storage, and served back through
`GET /api/f/:fileId` — one hostname, and the browser never addresses the store
itself. It did once, and a released install pointed at a port nothing published,
which nothing could catch short of installing it.

Thumbnails are made by the worker off the back of a domain event, never in the
request.

## Git integration

Two channels, and only one of them writes.

**Deliveries** — GitHub, Gitea or GitLab, by webhook. Read-only.

- The receiver verifies the signature, writes the raw delivery and returns 200.
  A worker parses it. Nothing is processed inside the request.
- A commit message naming `SLTM-TASK-12` — the project's code, the kind of card,
  a number — links that commit to that card. Everything a delivery says becomes
  an `scm_link` row, and no delivery moves a card.
- A delivery also makes the project's issue sync due, so a change on the
  repository does not wait for the clock.

**The issue sync** — GitHub, through a GitHub App on the connection. Two-way.

- Issues become cards on the first list, and closing one moves its card to the
  last. A card written after the repository was connected is raised as an issue,
  labelled with the list it is on, and its title, body and open state follow
  whichever side changed last. `GitHub-App-For-Releases.md` has the rules.
- It runs on a per-project clock — every minute unless a project says otherwise —
  and only one sync of a project runs at a time: a claim on the connection with a
  ten-minute lease, so a worker killed mid-sync does not hold it for ever.
- A sync that fails is recorded on the connection and shown on the screen. The
  timestamp is the last sync that worked, and on its own a stale one looks like a
  quiet repository.

Releases are read the same way, when somebody asks for them.

## Decisions taken, and what would reopen them

Three things this deliberately does not do. Two of them were settled by building
the thing and taking it out again, which is the part worth writing down: the
argument for putting it back is the same argument that put it there the first
time.

**Not event sourcing.** CQRS does not require it. Replay tooling, event
versioning and the debugging cost are real, and a tracker holding tens of
thousands of rows never repays them. The transactional outbox does the useful
half — the audit trail, the realtime invalidation, and anything that wants to
react later — with none of the rebuild machinery.

**Not a job queue.** The plan called for BullMQ on Redis. The outbox worker does
the work instead: it batches, retries, records `processed_at` and reports what
failed, and every job so far begins as a domain event that goes through the
outbox anyway. A queue beside it is a second set of failure modes for a
capability nothing needs yet.

Two jobs now run on a schedule rather than off an event — the issue sync and
emptying the bin — and neither needed a queue. Each is a step in the worker's
pass that asks the database whether anything is due rather than being told: the
sync compares `sync_every_seconds` with when a project last synced, and the bin
looks for what is past its date. A job whose "is it due?" is a `where` clause
needs nothing else to remember it.

_Reopen it_ when a job needs a delay, a priority, or a retry schedule that has to
survive the worker restarting. The pass has none of those: the issue sync's
backoff after a failure is held in memory, and forgotten when the worker starts
again.

**Not LFS pointers.** The plan called for the pointers in a push to become file
versions on the linked asset, and for a while they did: the ingest fetched every
path a commit touched and turned the ones that were pointers into links on the
card.

It came out again. What a card got was a filename and a size — the bytes sit on
an LFS server this application never talks to, so there was nothing to open at
the end of it — and it cost a repository read per path, capped at 25 a delivery,
plus a GitHub App on every connection that wanted it. The webhook by itself
already carries the commits, branches and pull requests people open the card to
read.

_Reopen it_ when assets are pulled from the repository rather than uploaded.
Storing an object id earns its keep once something can fetch the object behind
it.
