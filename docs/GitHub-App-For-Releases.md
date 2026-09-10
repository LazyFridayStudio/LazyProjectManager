# The GitHub App, and why the webhook is not enough

The Builds page fills itself from the repository's releases, and the board fills
itself from its issues. Both need a GitHub App on the connection — the webhook
cannot do either, and this is the part that surprises people.

---

## Two connections, two jobs

|           | Webhook                                  | GitHub App                       |
| --------- | ---------------------------------------- | -------------------------------- |
| Direction | GitHub tells you                         | You ask GitHub                   |
| Set up in | Repository → Settings → Webhooks         | Project → Settings → Repository  |
| Carries   | Pushes and pull requests, as they happen | The releases and issues it holds |
| Fills     | SCM activity on a card                   | The Builds page, and the board   |

A webhook only ever speaks about something that has just happened, and only about
that one thing. Your releases and your issues already exist — nobody is going to
push them at you — so reading them means asking, and asking needs a credential.

Three things follow from that:

- **Anything from before you connected still arrives.** A sync reads the
  repository's list, not a stream of events, so the history comes in on the first
  one.
- **Issues keep themselves current.** Each project syncs on a clock you set in
  Project → Settings → Repository — **Every minute** unless you change it, up to
  **Every hour**, or **Off**. A delivery from the webhook makes a project due at
  once whatever the clock says, so a change on GitHub usually arrives on the
  worker's next pass. The arrow on the board is for when you want it now.
- **Releases do not.** Nothing listens for them either way: press the sync
  arrow on the Builds page when you want that list current.

Only one sync of a project runs at a time. Pressing the arrow while the clock's
sync is still reading says so rather than starting a second.

Deliveries and releases are independent. A repository can be connected, verifying
deliveries and putting commits on cards, and still have nothing on the Builds
page. Where a repository can be read, the line under the title says which one and
when it was last read; where it cannot, it says nothing at all rather than
explaining a connection you did not ask about.

---

## Before you start

- The repository is already connected, and deliveries are arriving. Project →
  Settings → Repository shows a count against **Deliveries**.
- `APP_SECRET` is set on the server. The private key is encrypted with it, so
  saving fails with a message naming it if it is missing.
- You can administer the GitHub account or organisation that owns the repository.
  Creating an App and installing it both need that.

---

## 1. Create the App

- Personal account: `https://github.com/settings/apps/new`
- Organisation: `https://github.com/organizations/<org>/settings/apps/new`

Fill in only what GitHub insists on:

| Field                                 | What to put                                           |
| ------------------------------------- | ----------------------------------------------------- |
| GitHub App name                       | Anything unique — `LazyProjectManager` if it is free  |
| Homepage URL                          | Your install's address, or the repository's           |
| Webhook → **Active**                  | **Untick it.** The App delivers nothing here          |
| Repository permissions → **Contents** | **Read-only** — releases live under contents          |
| Repository permissions → **Issues**   | **Read and write** — only if you want issues as cards |
| Where can this App be installed       | Only on this account                                  |

Nothing else needs changing. Press **Create GitHub App**.

Contents stays read-only. Issues needs write as well as read, and only for one
thing: the label saying which list a card is on. Nothing else about an issue is
ever changed — not its title, not its body, not whether it is open. The App
cannot see private repositories you have not installed it on.

## 2. Take the App ID

You land on the App's **General** tab. Near the top is **App ID** — a number,
five or six digits. Write it down.

## 3. Generate a private key

Same page, further down: **Private keys** → **Generate a private key**. A `.pem`
file downloads.

Open it in a text editor. You will paste the **whole** file in a moment,
including the `-----BEGIN` and `-----END` lines.

Keep the file somewhere safe until this is finished, then treat it like any other
secret. It is the App's identity: anybody holding it can act as the App.

## 4. Install it on the repository

The App's **Install App** tab → **Install** next to your account or
organisation → **Only select repositories** → choose the repository → **Install**.

You land on the installation's settings page. The number at the end of the
address is the **Installation ID**:

```
https://github.com/settings/installations/12345678
                                          ^^^^^^^^
```

For an organisation the address is
`https://github.com/organizations/<org>/settings/installations/12345678` — the
number is in the same place.

## 5. Paste the three into the project

Project → **Settings** → **Repository** → **Reading releases**.

| Field           | What goes in it               |
| --------------- | ----------------------------- |
| App ID          | The number from step 2        |
| Installation ID | The number from step 4        |
| Private key     | The whole `.pem` file, pasted |

Press **Check and save**.

It is checked against GitHub before anything is stored — a token is requested,
and the repository is fetched with it. A wrong number or a mangled key is a
message on the form rather than a page that quietly stops working a fortnight
from now.

The key is stored encrypted and never sent back. Pasting a new one replaces it,
which is how it is rotated.

## 6. Read the repository in

Press the sync arrow beside the repository's name — on the **Builds** page it is
**Sync releases**, and on the **board** it is **Sync issues**. The issues would
arrive on their own within a minute; the arrow is for not waiting.

Neither arrow appears until credentials are saved, so if one is missing, step 5
did not take.

---

## How to tell it worked

The line under the title — on the board and on the Builds page — says which
state this project is in:

| It says                    | It means                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| Nothing at all             | No repository this project can read: no credentials saved            |
| `owner/repo, never synced` | Credentials saved, nothing pulled yet                                |
| `owner/repo, synced …`     | Working                                                              |
| `… — sync failing since …` | Every attempt since then has been refused. The reason is in Settings |

The timestamp is the last sync that **worked**, so on its own an old one looks
exactly like a quiet repository. That is what the failing marker is for.

Settings → Repository → Reading releases shows the App, the installation, when
the credentials were last known to work, and — while syncs are failing — why:
_Syncing issues has been failing since …: the reason._

---

## What a sync does, and does not, touch

- **A release you typed is never touched.** Not refreshed, not renamed, not
  deleted. Your notes are yours.
- **A release GitHub owns is whatever GitHub now says it is.** Notes edited
  upstream arrive; a tag renamed upstream moves the row rather than doubling it.
- **A release deleted upstream is left alone here.** It is still a build somebody
  has.
- **Drafts come in too**, drawn as drafts.
- **The hundred newest**, which is more than most projects have ever cut.

**Build runs are not held at all.** The App reads releases, not workflow runs,
and the page no longer keeps a hand-typed build history: asking a studio to
copy its CI in by hand in order to look at it is asking for something nobody
does twice, and a history only as current as the last time somebody typed is
read as current when it is not. Should runs come back, they come back synced
from `workflow_run`.

## What a sync does to the board

- **An issue with no card gets one**, on the first list. Closed issues land on
  the last list instead, so a first sync of a long history reads as history.
- **A card you wrote is never touched.** Not moved, not retitled, not closed.
- **Closing an issue moves its card to the last list**, whatever that column is
  called — the board is read left to right, and the far end is where finished
  work lives. Reopening brings it back out.
- **A card you have dragged along stays where you put it** while its issue is
  open. Only closing and reopening move one.
- **Pull requests are not cards.** GitHub answers them from the issues endpoint;
  they are skipped.
- **An issue with a `bug` label becomes a Bug card**, and takes a bug key.
- **A sync reads a hundred issues.** With **Only sync open issues** ticked in
  Settings → Repository, they are a hundred open ones.

## What a sync does to the repository

**A card written after you connected is raised as an issue.** Its title and body
become the issue's. Cards already on the board when you connected are left alone
— connecting a repository does not empty a studio's board onto somebody's issue
tracker.

**An issue is labelled with the list its card is on.**
`Backlog`, `In progress`, whatever your columns are actually called — a board
with a column named `Out for approval` gets a label named `Out for approval`.

- The label is created if the repository has never seen it, in the list's own
  colour.
- The label for the list it was on comes off as the new one goes on, so an issue
  is never wearing two.
- **Labels you put there yourself are never touched.** Only labels whose names
  are the names of lists are this product's to move.
- An issue already wearing the right label costs nothing — no request is made for
  it at all.

**The title, the body and whether it is open** follow whichever side changed
last. Edit a card and the issue is brought into line at the next sync; edit the
issue and the card is. Dragging a card to the last list closes the issue, and
dragging it back out reopens it.

The comparison is real rather than a guess: GitHub says when an issue last
changed, and a card knows when a person last touched it. A sync's own writes do
not count as touching a card, which is what stops the board winning every
argument after the first one.

Nothing else about an issue is ever written.

---

## If it will not take the credentials

The message names which of them is wrong. It is refused before anything is
stored, so nothing is half-saved.

| Message                                                          | Fix                                                                        |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| _The forge would not accept that app id and private key_         | The App ID belongs to a different App, or the key was regenerated. Step 2  |
| _That installation does not exist, or this app is not installed_ | Wrong Installation ID — take it from the address bar again. Step 4         |
| _The app is installed, but not on `owner/repo`_                  | The installation covers other repositories. Add this one to it             |
| _That private key could not be read_                             | Paste the whole PEM, `BEGIN` and `END` lines included                      |
| _APP\_SECRET …_                                                  | The server has no key to encrypt with. `openssl rand -base64 32`           |
| _App credentials are a GitHub thing_                             | This project is connected to Gitea or GitLab. Releases sync is GitHub only |

And from a sync rather than from saving, on either page:

| Message                                   | Fix                                          |
| ----------------------------------------- | -------------------------------------------- |
| _The app cannot see `owner/repo`_         | The installation no longer covers it         |
| _The app is not allowed to read releases_ | Contents permission is not read. Step 1      |
| _The app is not allowed to read issues_   | Issues permission is not read. Step 1        |
| _The app is not allowed to label issues_  | Issues permission is read, not write. Step 1 |

---

## One App, several projects

An installation covers whichever repositories you selected, and it has one id
however many that is. So a second project on a second repository in the same
account takes the **same App ID, the same Installation ID and the same key** —
add its repository to the existing installation rather than making another App.

## Taking it away

**Remove credentials** in Settings → Repository forgets the App and leaves the
webhook exactly as it was. Commits and pull requests keep arriving; the line
under the title goes away, and the Builds page keeps every release already
pulled in.

Uninstalling the App on GitHub's side does the same thing, less tidily: the
credentials stay stored and stop working.
