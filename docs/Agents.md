# Agents

Installing, setting up and using an agent — something that reaches this install
with a key instead of a password and does what it is told.

An agent is **somebody**. It holds permission groups, goes on projects, can be a
card's assignee, and every line it writes in the audit trail carries its own
name. That last part is the point: you can look back and see what you did and
what it did, and turn one off without turning the other off with it.

For the page to hand the assistant itself, see
[Asking Claude](Asking-Claude.md).

---

## Install

Nothing. Agents are part of the app.

Check by opening **Users → Agents**.

---

## Set one up

Four steps, and the third is the one people miss.

### 1. Make it

**Users → Agents → New agent.** A name, and nothing else. It has no password and
no address because it never signs in.

It arrives able to **read and take no action at all**. That is deliberate: a
thing that could do everything the moment it existed would be a thing somebody
had to remember to narrow.

### 2. Give it a key

**New key**, and name it after where it will live — _the laptop_, _the build
box_. A list of keys nobody can tell apart is a list nobody dares revoke
anything from.

**The secret is shown once.** Nothing stores it — only a hash — so there is
nowhere to read it back from. Copy it now; if you lose it, revoke it and make
another.

### 3. Put it on the projects it works on

On each project's **Settings → Put somebody, or a team, on this project**.

This is the step that is easy to miss, because missing it does not look like an
error. A permission group says _what_ an agent may do; being on a project says
_where_. An agent with every permission and no project asks for the list of
projects and gets an empty one — no refusal, no message, just nothing.

### 4. Give it permission groups

**Users → Agents → Permissions**, the same groups a person holds.

Match the group to the errand. Sorting a board into legends needs `card.link`;
writing comments needs `card.comment`; logging hours needs `card.update`. **Board
and cards** covers the common ones.

Two things worth knowing before you pick:

- **A deny beats an allow.** A group that allows `card.link` and denies
  `board.viewList` leaves an agent able to file cards it cannot read. That looks
  like a broken key and is the group doing exactly what it says.
- **An agent can never be an owner.** An owner cannot be narrowed by a deny —
  that rule exists so a studio cannot lock itself out of its own permissions
  screen — and the one principal nobody can rein in should not be the one nobody
  is watching.

### Check it

```bash
curl -s -H "Authorization: Bearer lpm_…" https://your-install/api/q/identity.me
```

That should come back with the **agent's** name. If it comes back as yours, the
key was not sent.

---

## Use it

Everything the app can do goes through two endpoints, and an agent reaches both:

```bash
GET  /api/q/<query>      # ask something
POST /api/c/<command>    # do something
```

[Asking Claude](Asking-Claude.md) is the page to give an assistant. It has the
envelopes, the rules, and a worked example of sorting a board into legends.

The **How to use** button on the agent's panel prints the same thing with this
install's own address filled in, ready to paste.

---

## Behind Cloudflare

A tunnel is the usual way this is reached from outside, and most of it just
works — but three things will stop an agent while a browser carries on fine, and
they all look like the key being wrong.

### Cloudflare Access will block it outright

This is the one that bites. If the hostname sits behind **Zero Trust → Access**,
every request is intercepted and bounced to a login page. A browser follows that
and signs in; `curl` gets HTML back where it expected JSON, or a `302`.

The symptom is unmistakable once you know it: the response is a web page, not
`{"ok":false,...}`.

Two ways out:

- **A bypass policy for the API paths.** Add an Access policy for
  `/api/*` with the _Bypass_ action. The app's own key is the authentication for
  those paths, so Access in front of them is a second lock on one door.
- **A service token.** Keep Access on and give the agent
  `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers alongside its
  bearer token. More to keep in step, and the right answer if the whole hostname
  must stay behind Access.

Prefer the bypass. Two authentications on one request means a refusal never says
which one refused.

### Bot protection may challenge it

**Bot Fight Mode** and some managed WAF rules challenge anything that does not
look like a browser. An agent does not. The symptom is a `403` with a Cloudflare
page in the body rather than the app's own `{"ok":false,"code":"FORBIDDEN"}` —
the app's refusals always name the permission, so if the message does not, it
did not come from here.

Add a WAF skip rule for `/api/*` on that hostname.

### `TRUST_PROXY` has to be on

```bash
TRUST_PROXY=true
```

Without it every request looks like it came from the tunnel connector. Two
things break: secure-cookie detection, which makes sign-in fail like a password
problem; and rate limiting, which is keyed per address — so one busy agent
spends the whole install's budget and everybody else starts getting turned away.

### Timeouts and volume

Cloudflare gives a proxied request about **100 seconds**. Nothing here takes
that long, but a very large query behind a slow link can, and it will read as a
`524` rather than as anything the app said.

The limits an agent will actually meet are the app's own, per address per
minute:

|          | Per minute |
| -------- | ---------- |
| Queries  | 1200       |
| Commands | 300        |

Sorting a board of two hundred cards is two hundred commands. That is well
inside it, and a script that fires them without pause is not — leave a moment
between calls, or expect `429`.

---

## Turning one off

**Revoke** a key on the agent's panel and it stops immediately. The row stays,
struck through, so the list still says what was there and when it stopped.

To stop an agent entirely rather than one of its keys, take its permission
groups away, or suspend it — a suspended agent's keys stop with it.

Nothing it did is undone by any of that. Its comments, its cards and its lines
in the audit trail stay, under its own name, which is why it has one.
