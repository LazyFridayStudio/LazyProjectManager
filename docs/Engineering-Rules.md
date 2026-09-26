# Engineering rules

Ordered by rule. [Flows.md](Flows.md) draws the same material ordered by
journey — a command end to end, who reaches a project against who may do what —
which is the better place to start if the question is "what happens when".

The rules every change in this repository follows. [`CleanCode.md`](CleanCode.md)
covers naming, functions and comments; this covers structure.

Where a rule can be checked by a machine it is, in `config/eslint.config.js`
or `config/tsconfig.base.json`. Everything here that is not enforced is a review
item.

## Layers, and what may import what

```
        Shared
       /      \
  Client       Server ── Database
```

- **`app/Shared`** imports nothing else in the workspace. It is the vocabulary:
  Zod schemas and the types inferred from them.
- **`app/Server/src/domain`** holds pure business rules. No `pg`, no `kysely`, no
  `fastify`, no `node:fs`, and nothing from the layers above it. A rule you
  cannot test without a running database is in the wrong folder.
- **`app/Database`** owns Kysely types and migrations. It knows nothing about HTTP.
- **`app/Client`** imports `@lpm/shared` only. The browser talks to the server
  through the command/query contract and nothing else.

ESLint enforces all four with `no-restricted-imports`. Adding an exception means
the layering is wrong, not the rule.

## Commands and queries

Two routes serve the entire API: `POST /api/c/:commandName` and
`GET /api/q/:queryName`. Adding a feature means registering a handler in
`app/Server/src/modules/index.ts`, never editing the router.

**Commands**

- Input is a Zod schema in `app/Shared`. Nothing else may enter a handler.
- One transaction: load the aggregate, enforce invariants from `app/Server/src/domain`,
  write, append to `domain_event`.
- Return identifiers and nothing else. Never a view model — the client refetches
  the query it cares about after the invalidation frame.
- Every command carries a client-generated `commandId`, unique-indexed in
  `command_log`. Retries are safe by construction.

**Queries**

- Read-only. No transaction, no domain objects. SQL in, view model out.
- Shaped for exactly one screen. `BoardView` returns what the board renders, not
  a generic card list the component then reshapes.
- `board.view` must stay **one** SQL statement — lists joined laterally to their
  cards, filters compiled into the same statement. Never a loop over lists. If it
  ever exceeds ~50ms at 10k cards, that is when to add a materialised read table.

**Authorisation**

`can({ actor, action, resource })` from `app/Server/src/domain` runs at the top of every
command handler and every query. Handlers are authenticated unless they set
`requiresAuthentication: false`, so one that says nothing is closed.

The `outsourcer` role sees only cards explicitly shared with it. Write every query
against that boundary now — retrofitting it later touches all of them.

## Errors

- Throw, never return an error code. `DomainError` subclasses carry a
  `FailureCode` that the API's error hook maps straight onto the wire.
- `FailureCode` is a closed union in `app/Shared`. A new failure mode is
  added there first, which makes the client's switch fail to compile until it is
  handled.
- An unrecognised error becomes `INTERNAL_ERROR` with a generic message. The real
  message is logged, never returned — it can carry connection strings and SQL.

## The audit trail

- It reads `domain_event`, which every command appends to inside the same
  transaction as its write. There is no second log to keep in step, and no way
  for a change to succeed without appearing in it.
- A new event needs a phrase in `app/Shared/src/audit/audit-vocabulary.ts`. An
  unmapped one shows as its own name rather than as nothing, which is how it gets
  noticed.
- Paged by cursor, never by offset: the trail grows at the head while somebody
  reads down it.
- Its own tab, holding the history and the bin — what happened and what can
  still be undone are the same question a day apart.
- Reading it is `audit.view`. Owner by role, and a permission group can hand it
  to somebody who is not one. It names every project, including the ones a given
  member was never added to.

## Permission groups an install starts with

- `identity.completeSetup` seeds one group per catalogue heading plus
  **Administrator**, from `defaultPermissionGroups()`. Derived from `CATALOGUES`,
  so a new heading brings a new default and there is no second list.
- **Every default rule is an allow.** A group of allows can only widen somebody,
  so one handed out by mistake gave away too much rather than locking somebody
  out. Nothing in the seed can take anything away.
- They are ordinary groups once made — renamed, edited and deleted like any
  other. Nothing reads them back, and the install does not know it made them.
- Only at setup. An install that already exists does not grow them later.

## What colour a control is

- **Red takes something away.** Delete, Remove, Disconnect, Suspend, Take out,
  Cancel — anything that removes, refuses, or abandons what somebody was doing.
- **Green makes or keeps something.** Add, Create, Make, New, Save, Record,
  Connect, Upload, Put it back, Let back in.
- **The accent is for the ones that do neither.** Close, Done, Edit, Load more,
  Copy, Sign out, Choose a file. If everything were coloured, nothing would be.
- `--color-danger` and `--color-ok`, the light pair — the red a Delete is
  written in on a document, and its green counterpart. Both sit at the accent's
  weight, so the three read as one set rather than as two dark buttons and an
  orange one. The `-500` pair is what they darken to on hover, which is the move
  `.button:hover` already makes.
- `<Button tone="stop" | "go">`, and `.actionStop` beside `.action` for the quiet
  row-action links. `a-button-that-removes-is-red.test.ts` reads the source and
  fails on a Delete that is not red, or a red button that removes nothing.
- **One exception, and it is in the list in that test.** `askToConfirm` exists
  only to guard a destruction, so _its_ Cancel is the safe way out and the
  confirm is the destructive one. Red goes on the confirm. Two reds would be no
  signal, and red on the way out would point at the wrong button.
- **`color-scheme` and `accent-color` are set on `:root`.** A checkbox, a radio,
  the clear cross inside a search box and the whole date picker are the
  browser's. Without those it paints them for a white page, so a dark app gets a
  blue tick belonging to no theme here.

## What mark a control carries

The sibling of the rule above, and forgotten the same way. Colour says a control
is dangerous; the **mark** says what kind of dangerous, and it is the half
somebody reads first — a row of three buttons is recognised before it is read,
or it is read every time.

- **A bin removes.** Delete, Remove — anything that takes something away.
- **A pencil edits** a thing in place.
- **A plus adds** one — including putting one back, which is what the bin's
  whole promise is, and uploading one, which is adding a file to something.
- All three come from `app/Client/src/components/ui/icons.tsx`, drawn on one
  box, one stroke weight and one set of caps, so a row of them reads as one set.
  A second copy of any of them is how two bins become different bins.
- Each is drawn centred on its own box, and sits in a `ButtonIcon`, whose `1lh`
  is what keeps an icon button exactly as tall as one with a word in it.

**The verb alone, not the sentence.** A button whose whole label is the verb —
`Add`, `Edit`, `Delete`, `Remove` — is a row action repeated wherever its row
is, and the word on it is chrome: eight categories carrying the same three words
is twenty-four words of it down one screen. A button labelled with a verb and
its object — `Delete card`, `Create project`, `Remove team` — keeps its words.
Those are nearly always the primary in a dialog footer beside Cancel, and there
the words are the sentence saying what is about to happen, which is the one
thing a confirmation is for.

**A mark, once carried, has to be the right one.** The requirement stops at the
bare verb; the correctness of a mark does not. `Delete card` sits beside the
card's Edit and opens a confirmation rather than being one, so it takes the bin
even though it keeps a name with an object in it — and `Upload` takes the plus,
because putting a picture on a sheet is adding one. Neither is obliged to carry
a mark; both are obliged to carry the right one if they do. A plus on a Delete
is worse than no mark at all: it is a mark that lies.

**The exclusion is confirmation, not length.** What keeps its words is the
button that _is_ the confirmation — the one beside Cancel, whose label is the
sentence saying what is about to happen. A button that merely opens one is an
ordinary control and takes its mark.

**A `+ Add` written as text is a button.** `Add tag` and `Add stage` were quiet
dashed controls that looked like links and did what a green button does. They
are `<Button tone="go" size="compact">` now — `compact` is the padding and the
radius of a chip, because a full-sized button in a row of chips turns the row
into buttons with chips between them. Size is where a control sits, not how
loud it is; it is not the `variant` scale that was here once and went.

**The word does not go anywhere.** It becomes `aria-label` and `title`, which is
what a screen reader says and what a hover shows. That is also what makes an
icon button legible to both rules at once: they read `aria-label` in preference
to the markup, so a bin named Delete is a Delete however little text it
contains, and a mark cannot be used to slip a red-less Delete past the colour
rule.

`the-mark-on-a-button-says-what-it-does.test.ts` reads the source and fails on a
bare verb drawn as a word, and on a mark used for the wrong verb — a plus on a
Delete is worse than no mark at all. It shares one reader with the colour rule,
so the two cannot come to disagree about what a button is or what it is called.

## Who reaches a project

- **A permission group says _what_ somebody may do. Being on a project says
  _where_.** Two different questions, and every attempt to answer both with one
  mechanism has been unpicked again — `team_grant`, portfolios, the team default
  level. Do not reintroduce one.
- **Being on a project is on or off, and carries no level of its own.** No seat,
  no per-project role, nothing to choose when somebody is added. What they may
  do once they are there is what their team's groups and their own say, set on
  the screens those live on. A third place to change one person's access is a
  third place somebody has to read to find out why they cannot open a board.
- `reachedLevel` in `project-access.ts` is the only place reach is decided, and
  it compiles into whatever statement is asking, because the launcher cannot
  fetch a thousand projects to find out which six it may draw. Three sources,
  and the most generous wins: **the role** (owner and lead see the slate),
  **being on the project** (`project_member`), and **being in a team that is on
  the project** (`project_team`).
- `project_member.role` predates the permission groups and is still read by that
  expression — a `viewer` row reaches a project at a lower level than any other.
  `projects.addMember` is the one place in the product that writes it, always at
  `member`. The rest of the role ladder moved into permission groups; this column
  outlived it.
- The team grant is standing, not a bulk add. Joining the team joins its
  projects; leaving takes them away. Expanding a team into one membership row
  per person at the moment somebody picks it looks the same on the day and is
  wrong by the following month — and wrong invisibly, as somebody who cannot
  open a board nobody can explain.
- A person's own row is the narrower, stronger statement: it names them, and it
  survives them leaving every team. Both can be true at once; the tile's team
  count unions them so nobody is counted twice.
- **Reach is not a permission, and the two are asked together.**
  `assertProjectPermission` answers only the first half. Anything inside a
  project asks `authoriseWithinProject`, which loads the level and passes it —
  otherwise a group allowing `member.invite` would let somebody add themselves
  to every project on the install.
- A project somebody cannot reach is **not found**, never forbidden. Being
  refused about a project is how somebody learns it exists.
- `member.invite` and `member.remove` cover a person and a team alike. Whether
  somebody may staff a project is one question, and a studio wanting to allow
  one and refuse the other has not come up.

## A team's permissions

- **The panel shows what the team holds, not a tick-list of what it does not.**
  A studio nearly always gives a team one group, and an install starts with
  eight — so a checkbox per group made a panel about one team mostly about the
  fifteen it has not got.
- Adding is a button and a picker. Picking closes the picker: optimising for the
  second group would cost a click in the common case to save one in the rare
  one.
- What a team already holds is never offered by the picker.
- **A hundred groups is the number these screens are built for.** The picker
  draws eight and says how many it is not showing; `PickList` grows a search
  above eight and scrolls its own column rather than the page. Neither is found
  by scrolling, so both narrow where somebody is looking.
- Eight is what a stock install has, so the threshold is _above_ it: a search
  box on a fresh install would be a control with nothing to narrow.

## The owner

- **A deny never reaches an owner.** They are the person who decides what the
  groups say, so a group cannot narrow them. Without it, one deny on
  `team.manage` given to a team the owners are in takes away the only way to
  undo it — the screen that edits the rule is behind the rule, and the fix on a
  self-hosted box is a hand on a psql prompt.
- It costs nothing that was worth having: every action's minimum role is at most
  `owner`, so an owner passes all of them on rank anyway. A deny was the only
  thing that could ever have refused one.
- **`install_settings.owner_user_id` is whoever set the install up.** Their role
  cannot be changed and they cannot be suspended, by anybody including
  themselves. Every other owner stays as changeable as they were.
- Nullable, for an install restored from a backup older than that step. Nobody
  is named, nobody is protected, and `assertAnAdminRemains` is the cover
  underneath — which is why it is still tested.

## What the shell draws

- **The session says what somebody may do.** `identity.me` returns `may`: every
  install-wide action, decided from their role and the permission groups they
  hold. `useMay()` reads it.
- A tab or a button is drawn only for somebody who may use it, asked with the
  **same action its own screen or command asserts** — so the two cannot disagree
  about who belongs there. `role === 'owner'` was right until permission groups
  existed and could hand `recovery.restore` to somebody who is not an owner.
- **Hiding is not the security.** Every handler asks again for itself. It is that
  a door somebody cannot open is one they will keep trying.
- A typo in an action name would hide a tab from everybody, silently and for
  ever. `the-shell-names-real-actions.test.ts` reads the client's source and
  fails on a name the policy has never heard of.

## Deleting things

- A delete that loses something somebody would miss calls `binIt` first, inside
  the same transaction. The rows are copied out whole and kept for a week; the
  worker sweeps what is past its date every five minutes.
- A new kind goes in two places, and the compiler holds them together:
  `RECOVERABLE_KINDS` in `app/Shared/src/recovery/queries/deleted-things.ts` and
  a recipe in `app/Server/src/modules/recovery/recycle-bin.ts`. One without the
  other does not build.
- A recipe lists the tables to put back, parents first. Rows under the thing get
  `needs` where their other end could be gone by then — a link with nowhere to
  point is left out rather than failing the whole restore. A column pointing at
  nothing needs nothing: a linked file has no stored file behind it.
- The thing itself gets `requires` for a parent that can go while it waits. An
  asset is always in a category, so restoring one whose category has been
  deleted since is refused in words — put the category back first — rather
  than on a foreign key.
- What the delete changed on rows it did **not** delete goes in `repairs`,
  gathered by the caller. A repair is only applied while the column still holds
  what the delete left there: somebody who refiled the asset afterwards meant it.
- **A restore checks deferrable constraints once its repairs are in.** A thing
  comes back as rows and then repairs, and is only whole after both. The rule
  that a category's name is unique among its siblings is deferrable for this: a
  `Props` deleted out from over a `Props` comes back to a level its own child is
  standing in, until the repair moves the child back inside it.
- **Payloads cross into JavaScript as `text`, never as `jsonb`.**
  `CamelCasePlugin` renames the keys of any object it finds in a result,
  including inside a `jsonb` column — and those keys are column names that have
  to go back exactly as they came out.
- Not everything is binned. A tag, a session, a link between two cards are edits
  to a thing rather than the loss of one. Projects and lists archive instead,
  and already have a way back.

## Rate limits

- How much of anything one caller may have is in
  `app/Server/src/server/rate-limit-policy.ts`, as a pure function of the request
  path. A limit is a decision with a reason, so it lives somewhere it can be read
  and tested rather than spread through plugin options.
- Anything reachable without a session gets its own, tighter allowance. The rate
  that protects a password from being guessed would make the board unusable, and
  the rate the board needs would let somebody try ten thousand passwords an hour.
- Counted in Redis, so the limit is the install's rather than each process's, and
  a restart does not forget it.
- A Redis that is down does not refuse traffic. Failing open lets somebody past a
  limit during an outage; failing closed refuses everybody, including the people
  fixing it.
- The health check and the web client's own files are never limited. A health
  check that gets a 429 is a container that restarts in a loop.

## Database

- Migrations are **forward-only** and append-only. Never edit an applied
  migration; write a new one. `down` exists for local iteration and tests.
- Registered by hand in `app/Database/src/migrations/index.ts`. The key is what
  Kysely records, so renaming one makes an already-migrated database run it again.
- Application code reads camelCase; the database is snake_case. Kysely's
  `CamelCasePlugin` bridges them — but it does **not** touch identifiers inside a
  raw `` sql`…` `` fragment, which must be written snake_case by hand.
- Migrations run without the plugin, so a migration file is snake_case throughout.
- Ordering uses `position numeric` with midpoint insertion. Reindex a list when
  the gap between neighbours drops below 1e-6.

## Design tokens

- Every colour, font, radius, shadow and interaction state comes from
  `app/Client/src/tokens`. No raw hex, no magic pixel values in a component stylesheet.
- The CSS custom properties are **generated** from the TypeScript constants by
  `renderCssCustomProperties`, so the two cannot drift. They reach the app as
  `virtual:lpm-tokens.css`, which is never a file on disk — change the constant,
  and there is nothing else to edit.
- The colours came verbatim from the design this was built from and have not
  moved. The type scale has, twice, and deliberately — see below. A token is
  changed by argument in one place, never by a screen setting its own.

### One name per tone

A component stylesheet never writes a colour down and never works one out. Both
are checked by `stylesheets-use-real-tokens.test.ts`, which reads every
stylesheet the client has and fails on a raw `#rrggbb` or on any `color-mix` of
`--color-text`.

- **Stepped-back text is one of four names**: `--color-text-strong` (70%),
  `--color-text-muted` (60%), `--color-text-faint` (45%), `--color-text-dim`
  (32%), plus `--color-hairline` (7%) for the line between rows of a table.
  There were 187 of these written by hand at sixteen different percentages —
  42 on one screen and 45 on the next — and nobody had chosen the differences.
- They are declared once, not per theme, because each is a percentage of
  `var(--color-text)`. A theme that redefines the text colour redefines all of
  them for free. That is the point: **a formula in a stylesheet is a decision
  that cannot be re-made by changing the palette**, which is what stood between
  the app and a light theme.
- A ground that is not the theme's gets its own pair: `--color-text-on-accent`
  for a label on the accent, `--color-text-on-scrim` for one over a dimmed
  screen. Neither follows `--color-text`; the accent inverts between themes and
  the scrim is black in both.
- What you can type in is `--color-control` with `--color-control-border`, not
  a step of the neutral ramp. A field has to read as a hole in the panel it
  sits on, and which grey does that depends on the theme.
- A `color-mix` of something else — `--list-color`, an accent tint, `--tone` on
  a Display — stays. Those are per-context, not one tone written sixteen ways.

### The type scale

Seven steps, and no eighth: `display` 38, `title` 26, `h2` 20, `h3` 18, `base`
16, `small` 14, `micro` 12. Density is expressed through spacing, never by
nudging a font size.

Every step is two larger than it started. This is a tool somebody reads all day,
and the scale it started from was taken from a design drawn to be looked at —
body text at fourteen and a ten-pixel label survive a screenshot and do not
survive an afternoon. The same amount on each step rather than a multiplier lifts
the small end hardest, which is where the reading hurt; the steps sit closer
together for it, so a heading shouts less and a label whispers less.

- **A screen has one title, and it is an `<h1>`.** The element rule gives it
  `--font-size-title` and the bold weight; a screen does not restate them.
- `h2` and `h3` are headings _inside_ a screen — a panel, a section of a form.
- `small` is secondary text; `micro` is uppercase labels and every monospace run.
- No two steps may share a size. There were two at 24 — `title` and `h1` — and
  every screen chose between them by copying whichever screen was written
  before it, which is how the launcher's title ended up lighter than the
  board's. `render-css-custom-properties.test.ts` fails if a duplicate returns.

It was lifted by four first, and brought back by two when four turned out to
cost more room than it bought.

### The three regions of a screen

Three words, and they mean the same thing in a conversation, in a commit message
and in the code.

```
+----------+------------------------------------------+
|          |                 HEADER                   |
|          +------------------------------------------+
|          |                                          |
| SIDEBAR  |                                          |
|          |                 CONTENT                  |
|          |                                          |
|          |                                          |
+----------+------------------------------------------+
```

- **Sidebar** — the full height of the window, down the left. Where you are in a
  project and where else you can go. Drawn by `ProjectShell`.
- **Header** — across the top of everything right of the sidebar. The screen's
  name, its facts and its own controls. Drawn by `ScreenHeader`, and by nothing
  else — see below.
- **Content** — under the header and right of the sidebar. The screen itself.
  It is the shell's `children`, inside the shell's own `.body`.

Not every screen has all three:

|                                                                                                | Sidebar | Header | Content          |
| ---------------------------------------------------------------------------------------------- | ------- | ------ | ---------------- |
| Inside a project — dashboard, board, tasks, assets, timeline, budget, docs, releases, settings | yes     | yes    | yes              |
| Outside one — Projects, Teams, Permissions, Audit, Users                                       | no      | yes    | yes              |
| Sign in                                                                                        | no      | no     | the whole window |

The screens outside a project have no sidebar because Projects, Teams,
Permissions, Audit and Users are views of one thing, and the row of places that names them lives in
the header where a title would be. Audit holds two: the history and the bin, on
their own smaller row inside it. Sign in is content alone: there is nowhere else
to go from it, and a bar naming a place you have not reached is a bar about
nothing.

**Say which region.** "In the middle of the content area" is a location; "in the
middle of the screen" is not, because on a project page the screen includes a
sidebar and a header that the thing is not meant to be centred against.

### One header, everywhere

**Every screen's title bar is `ScreenHeader`.** It is the asset library's bar,
which is the one the others were already being compared to:

- One row, `14px 22px` of padding, a hairline under it, full width — the rule
  reaches both edges, and the 22 matches the indent of the content below so the
  title sits over the first column of it.
- On the left, the title as an `<h1>` at `--font-size-title`, with its **facts**
  tucked underneath: short monospace `micro` strings — `39 assets`,
  `12 lists`, `$48,000 estimated`. Facts, not a sentence. An explanation belongs
  in the body of the screen where there is room to read it.
- On the right, the actions: a search, a New something, a view switcher.
- A ground of its own — `--color-page-title-header-background` — because the
  bar is chrome rather than content. Everything below it is the app's ground with the backdrop drifting
  through it; a header you can see motes moving behind reads as a panel that
  forgot its background.

A screen supplies `title`, `facts` and `actions`, and chooses none of the shape.
Five screens had copied the bar by eye and three had drifted from it —
`align-items: flex-end` on one, a 16-pixel gap on another, no rule at the bottom
on a third — which is what copying by eye does. There is one component now, and
eight stylesheets are shorter for it.

**Facts, not subtext.** A fact is something that changes and that somebody
would otherwise have to count: how many assets are in a library, how many are
over budget. How many teams there are is not one — the teams are on the screen.
Neither is a sentence explaining what a role is when the roles are listed below
it. The screens outside a project carry no facts line at all for that reason.

Two ways out, both narrow: `lead` replaces the title on screen for the install
screens, whose row of places names them better than a word repeating the tab
just pressed (the `<h1>` stays, read out but not drawn); and `beside` puts a
stamp on the title's own line, for a document's last-written time.

### A list down the side, the one you picked beside it

**Two install screens have tens of things, each with more to say than fits on a
tile.** Teams and Permissions both use `PickList` and `PickLayout`: a scannable
column on the left, a rule, and the open one on the right.

- **One component, not two stylesheets that agree today.** Teams was a grid of
  tiles with the panels underneath, so picking a different team moved the thing
  you were reading down the page. At three teams that is a studio at a glance;
  at thirty it is a wall you scroll past.
- **Each row is a name and one line of facts** — `4 people · Mira Kaur`,
  `7 rules · 2 teams`. Not a description: a list of twenty is read by scanning
  the second line, so it says what somebody would otherwise have to open the
  thing to find out.
- The row's own detail goes in `children`; the layout owns the grid, the rule
  and the column the detail sits in.

### One shell per kind of screen

Every screen is **designed on its own merits** and held to the rules in this
folder, not to a drawing. The design the app was first built from is gone, and
one of its flourishes is worth remembering for why it went: numbering the install
tabs `01 02 03` read as a sequence rather than as places somebody moves between.

`InstallShell` frames everything outside a project — Projects, Teams, Users, the
audit trail — and `ProjectShell` everything inside one. A screen supplies a
title and its own actions; it does not choose its own padding, its own header
shape, where the tabs go, or whether there is a sidebar. Three screens each
owning those is why switching tabs used to move the title up the page and back
down.

**The row of places is a mark each, and the one you are on keeps its word.**
Five words at `--font-size-title` were the loudest thing on every screen out
here, above content set smaller than they were, and `Permissions` alone is
eleven characters of chrome repeated on five screens. The current tab keeps its
word because that word is the screen's name — `ScreenHeader` reads the `<h1>`
out rather than drawing it — and the rest are marks, which is the same trade the
sidebar and the library's category controls already made. Every tab carries its
name in `aria-label` and `title` whatever is drawn.

## Tests

[`Testing-Standards.md`](Testing-Standards.md) is the full standard. In short:

- Every test is nested GIVEN / WHEN / THEN `describe` blocks.
- 90% lines, functions and statements and 85% branches, enforced **per
  package** by CI. Aim for 100% outside the web UI.
- Anything that writes SQL is tested against a real Postgres via
  `@lpm/database/testing`, never a mock.
- `app/Client` has no coverage floor: it is covered by Playwright against real
  screens, because a render test that asserts nothing a user would notice
  satisfies a coverage number without catching a bug.

## Git

- Branch off `main`. One concern per branch.
- Commit messages explain _why_ in the body. The subject says what changed.
- No AI-assistant attribution in commits, PR bodies or the repository. `.claude/`,
  `.claude.json`, `.mcp.json` and `CLAUDE.md` are gitignored — they hold
  credentials and machine-local settings.
