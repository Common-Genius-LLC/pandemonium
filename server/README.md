# Pandemonium server

Initial backend for Pandemonium: accounts plus remote project persistence. Built
on Bun and Hono, written in TypeScript. This implements Phase A (document sync)
from [docs/BACKEND_ARCHITECTURE.md](../docs/BACKEND_ARCHITECTURE.md): a whole
project JSON tree is stored per row, matching the client's existing shape so the
seam in `src/data/db.js` gains a remote adapter without restructuring anything.

The database is chosen by the `DATABASE_URL` scheme (see `src/db.ts`): SQLite for
dev (zero infrastructure) and PostgreSQL for production, behind one uniform query
layer, so the same code runs on both.

TypeScript here is a backend-only choice; the frontend stays plain JS per
CLAUDE.md. Bun runs the `.ts` sources directly, so there is no build step.

## Why Bun changes a few choices from the RFC

- Passwords: `Bun.password` (argon2id) replaces the `argon2` dependency.
- Access tokens: `hono/jwt` replaces the `jsonwebtoken` dependency.
- Database: `bun:sqlite` (dev) and `Bun.SQL` (Postgres, prod) are both built into
  Bun, so there is no `pg` driver and no ORM.

Net third-party runtime dependency: one (`hono`).

## Run (dev, SQLite, no Docker)

```bash
cd server
bun install
cp .env.example .env          # then set a real JWT_SECRET
bun run dev                   # http://localhost:8787, migrates on boot
```

The default `DATABASE_URL` is a local SQLite file. `bun run dev` applies the
schema on boot, so there is nothing else to start.

## Run against Postgres (prod-parity)

Set a `postgres://` `DATABASE_URL` in `.env` (or use the compose Postgres), then
run as above. To bring up Postgres locally:

```bash
docker compose up -d db                 # Postgres on localhost:5432
# set DATABASE_URL=postgres://pandemonium:devpassword@localhost:5432/pandemonium
docker compose --profile full up -d     # or run the API in a container too
```

## Verify

```bash
bun run typecheck             # tsc --noEmit
bun test                      # full suite against in-memory SQLite (no infra)
```

## API (v1)

All mutating routes need `Authorization: Bearer <accessToken>`. The refresh token
is an httpOnly cookie set on login/register and rotated on refresh.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | /health | | liveness, no database |
| POST | /v1/auth/register | { email, password, displayName? } | -> { user, accessToken } |
| POST | /v1/auth/login | { email, password } | -> { user, accessToken } |
| POST | /v1/auth/refresh | (refresh cookie) | -> { accessToken }, rotates cookie |
| POST | /v1/auth/logout | (refresh cookie) | 204 |
| GET | /v1/auth/me | | -> { user } |
| GET | /v1/projects | | -> [{ id, name, updatedAt }] |
| POST | /v1/projects | { project } | -> { id, project, updatedAt } |
| GET | /v1/projects/:id | | -> { id, project, updatedAt } |
| PUT | /v1/projects/:id | { project, baseUpdatedAt? } | 409 if baseUpdatedAt is stale |
| DELETE | /v1/projects/:id | | 204 |

## Invariants enforced server-side

The handlers import the client's own pure modules
(`src/data/project-model.js`, `src/fountain/parse.js`) so the rules hold
identically on both sides:

- Exactly one final draft per project (hard rule 4).
- Every script parses as Fountain (hard rule 2).

## Client wiring

The frontend is wired to this backend behind sign-in: `src/data/session.js`
(account session and the single fetch path), `src/data/remote-api-adapter.js`
(project CRUD), and `src/data/db.js` (dispatches autosave/load by mode). Sign in
from the topbar or start screen; projects then sync to the account.

## Not yet implemented (next phases)

- Asset upload to object storage (replaces base64 data URLs).
- Granular per-entity routes and normalized tables (Phase B).
- OCI deployment (Docker, TLS); see the [deployment runbook](../docs/DEPLOYMENT.md) for the current setup using nginx + certbot and Docker Compose on a shared Ubuntu host.
