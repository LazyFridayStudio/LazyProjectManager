# LazyProjectManager — self-hosted install

Everything in this folder is what you need to run it. No source, no build.

## Install

The image is public on GitHub's container registry, so there is nothing to sign
in to. From this folder:

```bash
cp .env.example .env
```

Open `.env` and change `POSTGRES_PASSWORD` and `MINIO_PASSWORD`. If you are going
to connect a repository, set `APP_SECRET` too — `openssl rand -base64 32` — because
a repository's secrets are encrypted with it and there is no default. Then:

```bash
docker compose up -d
```

Open <http://localhost:24571>. The first screen sets up the server and creates
the owner account — whoever reaches an un-set-up install first claims it, so do
this before putting it on a network.

## Upgrade

```bash
docker compose pull && docker compose up -d
```

Migrations run when the app container starts, so there is no separate step. Pin
a specific version by setting `LPM_VERSION` in `.env`.

## Behind a Cloudflare tunnel

Point the tunnel at port `24571` and set two values in `.env`:

```bash
APP_BASE_URL=https://pm.example.com
TRUST_PROXY=true
```

`TRUST_PROXY` is not optional there. Without it the API reads the client address
and protocol from the connection rather than the forwarded headers, so every
request looks like it came from the tunnel connector and secure-cookie detection
breaks.

**One hostname is enough.** Files are fetched and uploaded through the app, so
there is no second route to point at the object store and nothing else to
configure.

## What is running

| Service    | What it does                                                     | Reachable from              |
| ---------- | ---------------------------------------------------------------- | --------------------------- |
| `app`      | The API and the web UI, together                                 | your network, on `APP_PORT` |
| `worker`   | Live updates, thumbnails, and syncing a connected repository     | inside the stack only       |
| `postgres` | Everything except files                                          | inside the stack only       |
| `redis`    | Carries live updates from the worker to the app, and rate limits | inside the stack only       |
| `minio`    | File and asset storage                                           | inside the stack only       |

Only the app is published to your network. Everything else is reachable only from
inside the compose network.

## Your data

Postgres and MinIO write to named Docker volumes, which survive
`docker compose down`.

```bash
docker compose down          # stop, keep everything
docker compose down -v       # stop and DELETE all data
```

A backup is both halves: the database, and the files in the `minio-data` volume.
Either on its own restores to something broken — a board whose attachments are
missing, or files nothing refers to.

```bash
docker compose exec postgres pg_dump -U lpm lpm > lazyprojectmanager-backup.sql
```

That is the database half; copy the `minio-data` volume beside it for the files.
The repository's `scripts/backup.sh` takes both at once, with a rehearsal that
proves the copy comes back — see
[Backup and restore](https://github.com/LazyFridayStudio/LazyProjectManager/blob/main/docs/Backup-And-Restore.md).

## Ports

| Port    | What                              |
| ------- | --------------------------------- |
| `24571` | The app. This is the one you open |
| `9001`  | MinIO console, on loopback only   |

Change `APP_PORT` in `.env` if something already uses 24571.

## Trouble

**Nothing at `localhost:24571`.** Check the app started:
`docker compose ps` — it should say `healthy`. If it is restarting,
`docker compose logs app` will say why. A wrong `POSTGRES_PASSWORD` between
`.env` and an existing volume is the usual cause.

**"This server has not been set up yet" after you already set it up.** The
database volume was removed. `docker compose down -v` deletes it.

**`manifest unknown` when pulling.** `LPM_VERSION` in `.env` names a version that
was never released. Pick one from the
[Releases page](https://github.com/LazyFridayStudio/LazyProjectManager/releases).
