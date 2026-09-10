## What this changes

<!-- One paragraph. What now works that did not before? -->

## Why

<!-- The reason, not a restatement of the diff. Link the issue it closes. -->

## Checks

- [ ] `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test:coverage` passes locally
- [ ] `pnpm test:e2e` passes locally, if the change is something a person does in the browser. CI does not run it; `e2e.yml` does, from the Actions tab
- [ ] Version bumped with `pnpm bump patch|minor|major`
- [ ] New tests are GIVEN / WHEN / THEN, per `docs/Testing-Standards.md`
- [ ] Anything touching SQL is tested against a real Postgres, not a mock
- [ ] Follows `docs/CleanCode.md` — intention-revealing names, one job per function, comments say _why_
- [ ] New commands and queries are declared in `app/Shared` and registered in `app/Server/src/modules/index.ts`
- [ ] Nothing in `app/Server/src/domain` imports IO, the database or HTTP
- [ ] No raw colour, font or spacing values — everything comes from `app/Client/src/tokens`
- [ ] Schema changes ship as a new forward-only migration, never an edit to an applied one
