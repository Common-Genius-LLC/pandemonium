# Pandemonium server

Initial backend for Pandemonium: accounts plus remote project persistence. Built
on Bun, Hono, and PostgreSQL, written in TypeScript. This implements Phase A
(document sync) from [docs/BACKEND_ARCHITECTURE.md](../docs/BACKEND_ARCHITECTURE.md):
a whole project JSON tree is stored per row as `jsonb`, matching the client's
existing shape so the seam in `src/data/db.js` gains a remote adapter without
restructuring anything.

TypeScript here is a backend-only choice; the frontend stays plain JS per
CLAUDE.md. Bun runs the `.ts` sources directly, so there is no build step.

## Why Bun changes a few choices from the RFC

- Passwords: `Bun.password` (argon2id) replaces the `argon2` dependency.
- Access tokens: `hono/jwt` replaces the `jsonwebtoken` dependency.
- Database driver: `Bun.SQL` (native Postgres) replaces `pg` and the query
  builder. Connections are lazy, so importing the app without a database is fine.

Net third-party runtime dependency: one (`hono`).

## Run

```bash
cd server
bun install
cp .env.example .env          # then set a real JWT_SECRET
docker compose up -d db       # Postgres matching the default DATABASE_URL
bun run migrate               # apply schema.sql
bun run dev                   # http://localhost:8787, auto-reload
```

Alternatively run the API in a container alongside Postgres:

```bash
docker compose --profile full up -d
```

## Verify

```bash
bun run typecheck             # tsc --noEmit
bun test                      # health check only (no database needed)
RUN_DB_TESTS=1 bun test       # full auth + project-sync flow (needs Postgres up)
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

## Not yet implemented (next phases)

- Asset upload to object storage (replaces base64 data URLs).
- Granular per-entity routes and normalized tables (Phase B).
- Client wiring: `src/data/remote-api-adapter.js` and the `db.js` mode dispatch.
- OCI deployment (Docker, Caddy TLS); see the RFC.
