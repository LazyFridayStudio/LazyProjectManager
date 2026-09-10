# Contributing

**Start with an issue.** It is the fastest route for everyone, and it keeps the discussion attached
to the code rather than scattered.

| I want to…              | Open                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Report something broken | A **Bug report** — say what you expected, what happened, and which screen it was                                      |
| Suggest something       | A **Feature or change** — say what you are trying to achieve, not just the API or the button you have in mind         |
| Ask how something works | A **Bug report** against the documentation — if the answer is not obvious from it, that is a bug in the documentation |

Those are the two forms, and a blank issue is switched off: the forms ask where in
the product a thing lands, which is the first question every issue gets asked.

**Five open issues each.** One person can have five issues open at a time. A sixth is closed with a
note saying so, and closing one of your own frees the slot — the limit is on how much somebody asks
for at once, not on how much they can ever report. Members of the studio are not counted.

**A security problem is not an issue.** An issue is public the moment it is opened, so report a
vulnerability privately instead, as **[Security](SECURITY.md)** describes.

Everybody taking part — in issues, pull requests and review — is expected to follow the
**[Code of Conduct](CODE_OF_CONDUCT.md)**.

## Before you write any code

Read the two documents that govern every line, not just new files:

- **[Clean code](docs/CleanCode.md)** — the naming, function and comment standard.
- **[Engineering rules](docs/Engineering-Rules.md)** — layer boundaries, CQRS, migrations, design
  tokens, and what may import what.

**[Architecture](docs/Architecture.md)** explains the stack and the decisions that are settled. Ask
before deviating from it — in an issue, before the pull request, so nobody spends an evening on
something that was never going to land.

**[Project layout](docs/Project-Layout.md)** says where a new thing goes, and
**[How to run it](docs/How-To-Run.md)** has every command.

## Pull requests

`main` is protected. **Every change arrives as a pull request, and needs a green CI run and an
approving review from a maintainer before it can be merged.** Pull requests are squash-merged, so
write the title and description as the commit message you want on `main`.

1. Open or comment on an issue first, so the approach can be agreed before you write it.
2. Branch off `main`, and make the change.
3. Run the gate locally — CI runs the same one, so a red run is the same red you would see here:

   ```bash
   pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
   ```

4. Open the pull request. Checks on one from outside the studio wait until a maintainer approves
   them to run.

**Every pull request bumps the version**, because the release tag is read from `package.json` and a
change that reaches `main` without moving it leaves no way to release it. `pnpm bump patch` — or
`minor` for a feature, `major` for a breaking change. A workflow bumps a branch of this repository
that forgot — see [How to run it](docs/How-To-Run.md#4-ship-a-version) for what that costs you — but
it cannot push to a fork, so a pull request from one has to bump its own.

## Tests

Tests are [Vitest](https://vitest.dev) suites beside the code they cover, and a
[Playwright](https://playwright.dev) journey under [`app/Client/e2e/`](app/Client/e2e). A new
behaviour wants a new test beside the ones it changes.

Every test is written GIVEN / WHEN / THEN, and there are coverage floors. Both are in
**[Testing standards](docs/Testing-Standards.md)**, along with why the web UI is exempt from them.
