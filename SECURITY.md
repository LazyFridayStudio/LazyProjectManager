# Security

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** An issue is public the moment it is
opened, which tells everybody before anybody running an install can do anything about it.

Report it privately instead:
**[Report a vulnerability](https://github.com/LazyFridayStudio/LazyProjectManager/security/advisories/new)**.

Say what you found, how to reproduce it, and which version you saw it on — the release tag, or the
commit if you run from source.

## Supported versions

The latest release. A fix ships as a new version rather than being backported, so the way to take one
is to upgrade.

## What is in scope

LazyProjectManager is self-hosted, so what reaches the internet is whatever an install chooses to
expose.

**The application is in scope** — the API, signing in and sessions, permissions and who reaches
which project, agents and their keys, file uploads and downloads, and the repository integration.

**How a particular install is deployed is not.** A weak `POSTGRES_PASSWORD`, an unset
`TRUST_PROXY` behind a tunnel, or a database port published to the internet are the operator's to
fix, and [How to run it](docs/How-To-Run.md) says how.
