# Asking Claude to work the board

An agent reaches this install the way the app does: two endpoints, a key, and
the same permissions a person has. There is nothing to install and no bridge to
run — this page is the whole of what an assistant needs to be told.

Give it to Claude by pasting the link, or keep a copy beside your work.

---

## Before anything

Make an agent and give it a key: **Users → Agents → New agent**, then **New
key**. The secret is shown once.

**Put it on the project**, on that project's Settings — under _Put somebody, or
a team, on this project_. This is the step that is easy to miss: a permission
group says what it may do, and being on the project says where. An agent with
every permission and no project sees an empty list and no error.

**Give it a permission group** on Users → Agents → Permissions. A new agent can
read and take no action at all. Sorting a board needs `card.link` — that is what
gathering a card under a legend asks for, and it is not `card.update` as you
might expect. **Board and cards** holds it.

A group can **deny** as well as allow, and a deny wins. A group that allows
`card.link` and denies `board.viewList` leaves an agent able to file cards it
cannot read, which reads as broken and is the group doing exactly what it says.
If something is refused after you granted a group, look at that group's rules
before looking anywhere else.

Then check the key works:

```bash
curl -s -H "Authorization: Bearer lpm_…" http://your-install/api/q/identity.me
```

That should come back as the agent's name, not yours.

---

## The two endpoints

Everything the app can do goes through these, and so does the agent.

```bash
# Ask something. Read-only.
curl -s -H "Authorization: Bearer $LPM_KEY" \
  "$LPM_URL/api/q/board.view?slug=saltmarsh"

# Do something. Changes things.
curl -s -X POST -H "Authorization: Bearer $LPM_KEY" \
  -H 'content-type: application/json' \
  -d '{"commandId":"<a fresh uuid>","cardId":"…","isLegend":true}' \
  "$LPM_URL/api/c/board.setLegend"
```

**A query answers `{ ok, etag, data }`.** What you want is `data`.

**A command answers `{ ok, id }`,** and takes a `commandId` — a uuid you
generate, one per attempt. It is what makes a retry safe: send the same one
twice and the second is a no-op rather than a second card. **Generate a new one
for every distinct action.** Reusing one is the mistake that looks like success
and does nothing.

A refusal is an answer. `403` means the agent has not been given that
permission — the reply names it, as `Not permitted to card.link.` — and `404`
means it cannot reach that project at all. Neither is a bug to work around:
somebody has to grant it, and the message says which of the two to fix.

---

## When the answer is not JSON

This install is often reached through a Cloudflare tunnel, and Cloudflare can
answer a request before it ever arrives. When that happens the reply is a **web
page rather than JSON**, and no amount of retrying or rephrasing will change it.

**Tell whoever asked, and stop.** This is not something to work around.

How to tell them apart:

| What came back                                                            | What it means                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------ |
| `{"ok":false,"code":"FORBIDDEN","message":"Not permitted to card.link."}` | The app. The agent needs that permission         |
| `{"ok":false,"code":"NOT_FOUND",...}`                                     | The app. The agent is not on that project        |
| HTML, or a `302` to a login page                                          | Cloudflare Access is in front of the API         |
| A `403` with a Cloudflare page and no permission named                    | Bot protection challenged the request            |
| `524`                                                                     | Cloudflare gave up waiting, at about 100 seconds |

The app's own refusals are always JSON and always name what was refused. If the
message does not name a permission, it did not come from the app, and the fix is
in a Cloudflare setting rather than in the request.

`429` is the app, and is different: it means too many calls too quickly. Wait,
then carry on. Commands are limited to 300 a minute and queries to 1200.

---

## What a legend is

A **legend** is a card that gathers other cards. It is a container: it says what
a clump of work is called, and the work itself is the cards under it. Nobody
finishes a legend, and it is deliberately never raised as an issue on a
connected repository.

Any card can become one. A card can sit under one legend at a time.

---

## Sorting a board into legends

This is the errand. Read every card, decide the groupings, make a legend for
each, and put the cards under it.

### 1. Read the board

```bash
curl -s -H "Authorization: Bearer $LPM_KEY" "$LPM_URL/api/q/board.view?slug=saltmarsh" | jq '.data'
```

Each list holds `cards`, and each card carries what you need to decide:

| Field      | What it tells you                                                         |
| ---------- | ------------------------------------------------------------------------- |
| `id`       | What commands take                                                        |
| `cardKey`  | `SLTM-TASK-12`. What `putUnderLegend` takes, and what people say out loud |
| `title`    | What the work is                                                          |
| `type`     | `art`, `task`, `bug`, `build`                                             |
| `isLegend` | Whether it is already a container                                         |
| `gathers`  | What is already under it, empty for anything that is not a legend         |

Cards already inside a legend appear in that legend's `gathers`. **Leave them
where they are** unless the grouping is plainly wrong — somebody put them there.

Use `projects.list` first if you do not know the slug.

### 2. Decide the groupings

This is the part that is judgement, not API calls. Group by the thing the work
is _about_ — a set, a character, a system, a milestone — not by which list a
card is in. A list is where a card is up to; a legend is what it belongs to.

Say the grouping in words before making anything, and let somebody agree with it.
Undoing a mis-sorted board is a card at a time.

### 3. Make a legend

Either promote a card that is already the obvious umbrella:

```bash
-d '{"commandId":"<uuid>","cardId":"<id>","isLegend":true}'  → /api/c/board.setLegend
```

Or make a new card and promote it:

```bash
-d '{"commandId":"<uuid>","projectId":"<id>","listId":"<id>","title":"Harbour set","type":"task"}'
  → /api/c/board.createCard        # answers { ok, id }

-d '{"commandId":"<uuid>","cardId":"<the id it answered>","isLegend":true}'
  → /api/c/board.setLegend
```

`projectId` and the lists come from `board.view`. A legend usually belongs in
the first list, because it is not itself work in progress.

### 4. Put the cards under it

One card at a time, **by the legend's key rather than its id**:

```bash
-d '{"commandId":"<uuid>","cardId":"<the card>","legendKey":"SLTM-TASK-4"}'
  → /api/c/board.putUnderLegend
```

`"legendKey": null` takes a card back out of whatever legend it is in. There is
no second command for releasing one.

### 5. Read it back

```bash
curl -s -H "Authorization: Bearer $LPM_KEY" "$LPM_URL/api/q/board.view?slug=saltmarsh" \
  | jq '.data.lists[].cards[] | select(.isLegend) | {key: .cardKey, title, under: [.gathers[].cardKey]}'
```

Check the shape before saying it is done. A command that answered `{ ok: true }`
did what it was asked; whether what it was asked was right is a different
question, and this is how you find out.

Every step on this page was run against a real install before it was written
down, which is how two of them got corrected.

---

## Putting a file somewhere

A file is the one thing that is not a single command, because the bytes have to
go somewhere the envelope cannot carry them. It is three requests, and the middle
one is a third address — `/api/f/{id}`, which is neither `/api/c/` nor `/api/q/`
and takes the same key.

```bash
# 1. Ask for somewhere to put it. Needs `file.upload`, and being on the project.
curl -s -X POST -H "Authorization: Bearer $LPM_KEY" -H 'content-type: application/json' \
  -d '{"commandId":"<a fresh uuid>","target":{"kind":"cardAttachment","cardId":"<a card>"},
       "filename":"crane.png","mime":"image/png","bytes":40321}' \
  "$LPM_URL/api/c/files.requestUpload"
# {"ok":true,"id":"<fileId>","uploadUrl":"/api/f/<fileId>"}

# 2. Send the bytes to the address it answered with.
curl -s -X PUT -T crane.png -H "Authorization: Bearer $LPM_KEY" \
  "$LPM_URL/api/f/<fileId>"

# 3. Say it arrived. The server reads the real size and type back out of the
#    store, because what turned up is a better authority than what claimed to be
#    sending.
curl -s -X POST -H "Authorization: Bearer $LPM_KEY" -H 'content-type: application/json' \
  -d '{"commandId":"<a fresh uuid>","fileId":"<fileId>"}' \
  "$LPM_URL/api/c/files.confirmUpload"
```

Two things to know, both of which look like something else when they happen:

- **Step 2 has to say how large it is.** The store is written to without
  buffering the file, so a request with no `content-length` is refused with
  _"That upload did not say how large it is."_ `curl -T` sets it; a chunked body
  or a piped `--data-binary @-` does not.
- **Skipping step 3 leaves the file pending**, which shows as nothing at all on
  the card. The upload did not fail; it was never finished.

---

## Moving a card

The other errand a board gets asked for, and the one command whose body is
easiest to guess wrong.

```bash
curl -s -X POST -H "Authorization: Bearer $LPM_KEY" -H 'content-type: application/json' \
  -d '{"commandId":"<a fresh uuid>","cardId":"<the card>","toListId":"<the list>"}' \
  "$LPM_URL/api/c/board.moveCard"
```

**`toListId`, not `listId`.** `board.createCard` above takes `listId`, and it is
the nearest example on this page — copying it here sends a body that is refused.

**A position is a neighbour, not a number.** `beforeCardId` and `afterCardId`
say which card to land above or below, and both absent means the end of the
list. An index would mean something different by the time it arrived, because
somebody else may have dropped a card above it.

```bash
-d '{"commandId":"<uuid>","cardId":"<id>","toListId":"<id>","afterCardId":"<the card to sit under>"}'
```

The lists and their ids come from `board.view`. A move respects the
work-in-progress limit, so a full list refuses one — that refusal is the app's
and names what it hit.

## Finding anything else

Every screen in the app is these two endpoints, so an agent can do anything a
person with the same permissions can. The names follow the area:
`board.moveCard`, `board.comment`, `work.log`, `projects.addMember`,
`assets.createAsset`.

**These are names, not shapes.** Nothing on this page says what body any of them
takes, and guessing one from the nearest example is how `board.moveCard` gets
sent `listId`. The authority is the schema:
`app/Shared/src/<area>/commands/`, where every command is a `defineCommand` with
its Zod object beside it. Read the one you want before sending it.

`docs/Flows.md` draws what happens when one is called, and why a refusal is a
refusal. Which permission a command needs is what its refusal names; the whole
list is `app/Server/src/domain/authorization/permission-rules.ts`.
`docs/Agents.md` is for whoever set the agent up, and covers the Cloudflare
settings above from the other side.

---

## Rules for an assistant working a real board

- **Read before writing.** Ask `board.view` and say what you found before
  changing anything.
- **Say the plan first.** "Twelve cards, four groupings, here they are" — and
  wait. Sorting is easy to do and slow to undo.
- **A fresh `commandId` per action.** Reusing one silently does nothing.
- **One card at a time.** If the tenth fails, the first nine stand, and the board
  says exactly where it got to.
- **Leave existing legends alone** unless asked. Somebody made them on purpose.
- **A refusal is not a puzzle.** `403` means ask for the permission; do not look
  for another route to the same change.
- **Everything is on the record.** Every action is in the audit trail under the
  agent's own name, which is the point of it having one.
