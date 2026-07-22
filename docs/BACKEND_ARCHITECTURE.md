# Pandemonium Backend Architecture (RFC)

Status: proposed. Owner: platform. Scope: turn the client-only app into a
full-stack product (Cloudflare Pages frontend, OCI Always Free backend and
database) without breaking local-file mode or any Hard Rule in CLAUDE.md.

This document is written to be executed by an agent working in the repo root.
It contains no em-dashes (Hard Rule 1).

---

# Part 1: Architectural Blueprint and Recommendations

## 0. Grounding facts (read the code before trusting the spec)

Three properties of the current codebase decide the whole design:

1. The domain logic is already pure and framework-agnostic. `PandemoniumStore`
   (`src/state/store.js`) has no DOM and no Lit. All mutations run through pure
   reducers in `src/data/project-model.js`. The Fountain parser
   (`src/fountain/*.js`) and the anchor resolver (`src/fountain/resolve.js`) are
   DOM-free. Every one of these files can run unchanged on a Node server.

2. The persistence seam already exists and is honest. Every save/open/autosave
   call goes through the five functions in `src/data/db.js`
   (`saveProject`, `openProjectFile`, `autosaveProject`, `loadAutosavedProject`,
   `clearAutosavedProject`). No component imports an adapter directly. This is
   the single file we extend to add a remote mode.

3. The persisted shape is a plain JSON tree. `src/data/schema.js` defines it:
   `{ name, workspace, type, targetMins, contributors[], scripts[], boards[],
   research[], links[], comments[] }`. Anchors are opaque `{ parts: [{ q, b, s }] }`
   objects that only `resolve.js` interprets. Board images and research
   attachments are data URLs embedded inline.

The heavy assets embedded as data URLs (property 3) are the only part that does
not survive a lift-and-shift to a server. Everything else does.

## 1. Recommended stack

This table is what was actually built under `server/`. It replaces the earlier
Node/Fastify draft: standardizing the whole project on Bun let several rows
collapse into Bun built-ins, cutting the third-party dependency count to one.

| Layer | Recommendation | Why it wins here |
| --- | --- | --- |
| Runtime | Bun 1.3 | Runs the existing pure ES modules verbatim, and runs the server's TypeScript directly with no build step. |
| Language | TypeScript (backend only) | Types on the server's own code; the frontend stays plain JS per CLAUDE.md. Bun executes `.ts` natively. |
| HTTP framework | Hono 4 | Tiny, runs natively on Bun, ships JWT, CORS, and cookie helpers so auth needs no extra packages. |
| API style | REST (resource-oriented) | The domain is a bounded set of nouns (project, script, board, research, link, comment, asset). GraphQL solves a problem this app does not have yet. |
| Database | SQLite (dev) and PostgreSQL (prod) | SQLite needs zero infrastructure for local dev; Postgres is the production target. One dialect-neutral schema and one query layer run on both. Postgres keeps `JSONB`/full-text options open for Phase B. |
| Database driver | `bun:sqlite` and `Bun.SQL` behind one uniform interface | Both are built into Bun (no `pg`, no ORM). `src/db.ts` picks the driver from the `DATABASE_URL` scheme; queries are written once with `?` placeholders. |
| Migrations | Plain `.sql` applied on boot | `schema.sql` is idempotent (`CREATE ... IF NOT EXISTS`), dialect-neutral, and doubles as the migration; a versioned tool is added when the schema starts changing under real data. |
| Auth | `hono/jwt` access token plus httpOnly refresh cookie; passwords hashed with `Bun.password` (argon2id) | Stateless verification, and both pieces are built in, so nothing extra runs on OCI. |
| Object storage | Cloudflare R2 (S3-compatible) | Zero egress fees, sits next to Cloudflare Pages, presigned uploads keep large files off the API box. |
| Reverse proxy / TLS | Nginx + certbot (or Caddy 2) | Nginx is the chosen approach when the host already runs other services; Caddy is simpler standalone. Let's Encrypt in both cases. |
| Container | Docker + Docker Compose | One `compose.yml` reused locally and on the OCI VM (12-Factor parity between dev and prod). The API image is `oven/bun`. |

### The decisive argument for a JavaScript/TypeScript backend

`project-model.js`, `src/fountain/`, and `resolve.js` are the rules of the
product: what a valid project is, how Fountain parses, how a link stays attached
to moving text. Those rules must be enforced on the server too (a client is not
a trust boundary). With a Bun backend you `import` the same files (the server's
`domain/validate.ts` does exactly this) and get one source of truth. Choose Go
or Python and you maintain a second, drifting copy of the parser and the "one
final draft" invariant, which is exactly the kind of divergence Hard Rules 2 and
4 exist to prevent. The server being TypeScript does not break this: Bun imports
the plain-JS client modules directly, untyped, and runs them as-is.

### Trade-offs considered and rejected

- GraphQL: rejected for now. Adds schema, resolvers, and N+1 management to a
  noun set small enough to fit in one screen. Revisit only if a rich client
  query surface (arbitrary cross-entity filtering) becomes a product need.
- Oracle Autonomous Database (the other OCI Always Free DB): powerful, but ties
  you to Oracle client tooling and wallet-based connections, and is awkward to
  reproduce in local Docker for dev. Postgres in a container gives dev/prod
  parity for free. Keep Autonomous DB as a fallback if the A1 VM RAM budget gets
  tight.
- Heavy ORMs (Prisma) and query builders (Kysely, Drizzle): considered, then
  dropped once the runtime became Bun. `Bun.SQL` gives parameterized queries with
  zero dependencies, which is all Phase A needs. Revisit a typed query builder if
  and when the granular Phase B tables make raw SQL unwieldy.
- Storing assets on the OCI block volume: simplest, but puts egress and
  bandwidth on the single small VM and couples asset durability to one host. R2
  is a better default. OCI Object Storage (20 GB Always Free) is the all-in-OCI
  alternative if you want zero Cloudflare account dependencies.

## 2. Database schema

Design principles: normalize the entity graph, keep anchors and Fountain text as
opaque `JSONB`/`text` (the server should never reinterpret an anchor, only the
client resolver does), enforce the product invariants in the schema itself.

```sql
-- Enable extensions once per database.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- fuzzy global search

-- ---- identity ----
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,
  password_hash text   NOT NULL,               -- argon2id
  display_name  text   NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- projects ----
CREATE TABLE projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL DEFAULT 'Untitled',
  workspace    text NOT NULL DEFAULT '',
  type         text NOT NULL DEFAULT '',
  target_mins  integer NOT NULL DEFAULT 0,
  contributors jsonb NOT NULL DEFAULT '[]',    -- [{n, color}], display chips only
  schema_ver   integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Collaboration: who may touch a project and at what level.
CREATE TABLE project_members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'editor'        -- owner | editor | viewer
             CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY (project_id, user_id)
);

-- ---- scripts ----
CREATE TABLE scripts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  fountain    text NOT NULL DEFAULT '',
  is_final    boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Hard Rule 4 enforced in the schema: at most one final draft per project.
CREATE UNIQUE INDEX one_final_draft_per_project
  ON scripts (project_id) WHERE is_final;

-- ---- assets (replaces inline data URLs) ----
CREATE TABLE assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bucket_key  text NOT NULL,                    -- R2 object key
  mime        text NOT NULL,
  byte_size   bigint NOT NULL,
  checksum    text,                             -- sha256 for dedupe
  original_name text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---- boards (storyboard links: script section -> image) ----
CREATE TABLE boards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_id    uuid REFERENCES assets(id) ON DELETE SET NULL,
  caption     text NOT NULL DEFAULT '',
  anchor      jsonb NOT NULL,                   -- { parts: [{ q, b, s }] } into the final draft
  sort_order  integer NOT NULL DEFAULT 0
);

-- ---- research documents ----
CREATE TABLE research_docs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'note'    -- note | url | doc
                CHECK (kind IN ('note','url','doc')),
  title         text NOT NULL DEFAULT 'Untitled',
  url           text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  attachment_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---- research links (script span <-> research span) ----
CREATE TABLE research_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  research_id uuid NOT NULL REFERENCES research_docs(id) ON DELETE CASCADE,
  anchor      jsonb NOT NULL,                   -- script-side { parts: [...] }
  r_anchor    jsonb                             -- research-side { parts: [...] } or null
);

-- ---- inline comments (script-only editorial notes) ----
CREATE TABLE comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  anchor      jsonb NOT NULL,                   -- { parts: [...] }
  body        text NOT NULL DEFAULT '',
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---- global search acceleration ----
CREATE INDEX scripts_fts   ON scripts       USING gin (to_tsvector('english', fountain));
CREATE INDEX research_fts  ON research_docs USING gin (to_tsvector('english', title || ' ' || body));
CREATE INDEX comments_fts  ON comments      USING gin (to_tsvector('english', body));
```

Notes on fidelity:

- `scripts.fountain` is stored as raw `text`, byte for byte. The server never
  reformats it. That is how Hard Rule 2 (round-trip fidelity) survives a
  database.
- Anchors stay `JSONB` and opaque. No server code reads inside `parts`. Only the
  client's `resolve.js` interprets `{ q, b, s }`. Keeping this boundary means the
  anchor scheme can evolve without a migration.
- `contributors` stays denormalized `JSONB` on `projects`. They are display
  chips (name plus color), not accounts. Real access lives in
  `project_members`.

## 3. API specification

Base URL: `https://api.pandemonium.app/v1`. All responses JSON. All mutating
routes require `Authorization: Bearer <access_jwt>`.

### Auth

```
POST   /auth/register      { email, password, displayName }   -> { user, accessToken }  (+ refresh cookie)
POST   /auth/login         { email, password }                -> { user, accessToken }  (+ refresh cookie)
POST   /auth/refresh       (refresh cookie)                    -> { accessToken }
POST   /auth/logout        (refresh cookie)                    -> 204
GET    /auth/me            Bearer                              -> { user }
```

Access token: JWT, ~15 min lifetime, `sub = user.id`. Refresh token: opaque,
httpOnly + Secure + SameSite=Strict cookie, ~30 days, rotated on every refresh.

### Projects (two API surfaces, one per migration phase)

Phase A, document sync (ship first, near-zero client refactor):

```
GET    /projects                        -> [{ id, name, updatedAt }]
POST   /projects        { project }      -> { id, project }     full project JSON tree
GET    /projects/:id                     -> { id, project, updatedAt }
PUT    /projects/:id    { project, baseUpdatedAt } -> { id, project, updatedAt }
DELETE /projects/:id                     -> 204
```

`PUT` carries `baseUpdatedAt` for optimistic concurrency: if the stored
`updated_at` moved, respond `409 Conflict` with the current server copy so the
client can reconcile rather than silently clobber a collaborator.

Phase B, granular resource routes (add once tables are decomposed):

```
GET    /projects/:id/scripts
POST   /projects/:id/scripts             { name, fountain, final }
PATCH  /scripts/:id                      { name?, fountain?, final? }
DELETE /scripts/:id
POST   /scripts/:id/make-final           -> promotes, demotes previous final atomically

GET    /projects/:id/boards
POST   /projects/:id/boards              { assetId, caption, anchor }
PATCH  /boards/:id                       { caption?, assetId?, anchor? }
DELETE /boards/:id

GET    /projects/:id/research
POST   /projects/:id/research            { kind, title, url, body, attachmentId? }
PATCH  /research/:id                     { title?, body?, url? }
DELETE /research/:id

GET    /projects/:id/links
POST   /projects/:id/links               { researchId, anchor, rAnchor? }
PATCH  /links/:id                        { anchor? }
DELETE /links/:id

GET    /projects/:id/comments
POST   /projects/:id/comments            { anchor, body }
PATCH  /comments/:id                     { anchor?, body? }
DELETE /comments/:id

GET    /projects/:id/search?q=...        -> unified hits across scripts, research, comments, boards
```

### Assets (presigned upload, direct to R2)

```
POST   /projects/:id/assets/presign   { mime, byteSize, originalName }
        -> { assetId, uploadUrl, bucketKey }   client PUTs bytes straight to uploadUrl
POST   /assets/:id/commit             -> { asset }   marks upload complete after client PUT
GET    /assets/:id/url                -> { url, expiresAt }   short-lived signed GET url
```

The API never proxies file bytes. It signs URLs; the browser talks to R2
directly. That keeps the 1-OCPU-class VM out of the media path entirely.

## 4. Asset and media storage strategy

Problem today: board images and research attachments are base64 data URLs inside
the project JSON (`boards[].img`, `research[].attachment.data`). A single project
can reach tens of megabytes, which is why autosave already uses IndexedDB over
localStorage. Base64 also inflates every payload by ~33 percent and makes the
project document impossible to diff or partially sync.

Target design:

1. Assets live in Cloudflare R2, one bucket, key layout
   `projects/{projectId}/{assetId}/{originalName}`.
2. The database stores only metadata (`assets` table): key, mime, size,
   checksum. No bytes in Postgres, no bytes in the project JSON.
3. Upload is presigned and direct to R2 (`/assets/presign` then browser `PUT`).
   The API signs, it does not carry bytes.
4. Read is via short-lived signed GET URLs, or a public bucket behind a
   Cloudflare cache if the images are not sensitive. Start private with signed
   URLs; relax later if needed.
5. Deduplicate on `checksum` (sha256): the same storyboard frame reused across
   boards points at one object.

Migration of existing data URLs: on first remote save of a legacy project, a
one-time routine walks `boards[].img` and `research[].attachment`, uploads each
data URL to R2, and rewrites the reference to an `assetId`. This runs in the
remote adapter (Part 2, Phase 2) so local-only users are never affected.

All-OCI alternative: swap R2 for OCI Object Storage (20 GB Always Free) with the
same presigned-URL pattern. The code path is identical because both speak S3
semantics via presigned PUT/GET. Choose R2 for the zero egress and Pages
adjacency; choose OCI Object Storage to keep everything in one cloud account.

---

# Part 2: Step-by-Step Execution Plan

Repo layout added by this plan:

```
/server                 backend service (built, Phase A)
  /src
    index.ts            migrate then Bun.serve(app.fetch)
    app.ts              Hono instance: CORS, health, routes, error handler
    config.ts           env in one place (12-factor)
    db.ts               Bun.SQL Postgres client + migrate()
    schema.sql          Postgres schema (idempotent, doubles as migration)
    errors.ts           HttpError -> JSON
    types.ts            row and payload shapes
    auth/               tokens.ts, middleware.ts, routes.ts
    domain/validate.ts  imports ../../../src/data + ../../../src/fountain for validation
    routes/projects.ts  document-sync CRUD
  test/smoke.test.ts    health always; DB flow gated on RUN_DB_TESTS
  compose.yml           postgres (+ api under the `full` profile)
  Dockerfile            oven/bun image
  tsconfig.json  .env.example
/src/data                 (Phase 2, built)
  remote-api-adapter.js additive: the third adapter behind db.js
  db.js                 mode dispatcher (edited, not rewritten)
  session.js            mode + access token + user + active remote project id
/docs
  BACKEND_ARCHITECTURE.md   this file
```

The server imports the existing pure modules from `../../../src/...` rather than
copying them, so the parser and reducers cannot drift.

## Phase 1: Local backend and database setup (built)

This phase is implemented under `server/`. See `server/README.md` for the full
command list; the essentials:

```bash
cd server
bun install
cp .env.example .env          # then set a real JWT_SECRET
bun run dev                   # http://localhost:8787, SQLite, migrates on boot
```

Dev defaults to a local SQLite file, so nothing else needs starting. For
Postgres parity, set a `postgres://` `DATABASE_URL` (start one with
`docker compose up -d db`) and run the same way; the URL scheme picks the driver.

Verification:

```bash
bun run typecheck             # tsc --noEmit
bun test                      # full suite against in-memory SQLite (no infra)
curl localhost:8787/health
```

The compose file also runs the API in a container next to Postgres (closer to
the OCI prod layout) under a profile: `docker compose --profile full up -d`. The
API image is `oven/bun` and runs `src/index.ts` directly, no build step.

Server-side validation reuse (the point of a Bun backend) is implemented in
`server/src/domain/validate.ts`, which imports the client's own modules so the
invariants are enforced by the same code on both sides:

```ts
// server/src/domain/validate.ts (excerpt)
import { normalizeDraftNames } from '../../../src/data/project-model.js';
import { parseFountain } from '../../../src/fountain/parse.js';

// one final draft, names honest: run the same normalizer the client runs, then
// require every script to still parse as Fountain (Hard Rules 4 and 2).
const project = normalizeDraftNames(ensureBranches(raw));
for (const s of project.scripts) parseFountain(s.text ?? '');
```

Note on the schema: Phase A stores the whole project tree as one TEXT `data`
column (`projects.data`), and the dialect-neutral `server/src/schema.sql`
(TEXT ids, TEXT timestamps) runs unchanged on SQLite and Postgres. The normalized
multi-table schema in Part 1 section 2, with Postgres-native `jsonb`/`timestamptz`
types, is the Phase B target, not what ships first.

## Phase 2: Update `src/data/db.js` to support the backend

The seam does not get rewritten. It gains a mode. Two files change: a new
`remote-api-adapter.js`, and `db.js` becomes a dispatcher. Every component keeps
calling the same five functions.

1. New `src/data/remote-api-adapter.js`:

```js
// The third adapter behind db.js. Same shape as the local adapters, talks to
// the Bun/Hono backend. Auth token is read from the session module, not passed
// through every call, so component code stays identical to local mode.
'use strict';

import { getAccessToken } from './session.js';

const BASE = import.meta.env.VITE_API_BASE; // e.g. https://api.pandemonium.app/v1

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${getAccessToken()}`,
      ...(opts.headers || {}),
    },
    credentials: 'include', // refresh cookie
  });
  if (res.status === 401) throw new Error('auth-required');
  if (!res.ok) throw new Error(`api ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// Phase A document-sync mapping onto the existing project shape.
export async function saveProjectRemote(project, id) {
  const body = JSON.stringify({ project, baseUpdatedAt: project._updatedAt });
  const out = id
    ? await api(`/projects/${id}`, { method: 'PUT', body })
    : await api('/projects', { method: 'POST', body });
  return out; // { id, project, updatedAt }
}

export async function loadProjectRemote(id) {
  const out = await api(`/projects/${id}`);
  return out.project;
}

export function autosaveProjectRemote(project, id) {
  // debounced by the same call site that debounces the IndexedDB autosave
  return saveProjectRemote(project, id);
}
```

2. `src/data/db.js` becomes a dispatcher. The local branch is untouched, so
   offline and file mode keep working exactly as today:

```js
'use strict';

import { saveProjectToFile, parseProjectFileText } from './local-file-adapter.js';
import { saveCurrentProjectLocally, loadCurrentProjectLocally, clearCurrentProjectLocally } from './local-db.js';
import { saveProjectRemote, loadProjectRemote, autosaveProjectRemote } from './remote-api-adapter.js';
import { readFileAsText } from '../utils/files.js';
import { getMode } from './session.js'; // 'local' | 'remote'

// File save/open stays local always: it is the portable-backup path (Hard
// Rule: a .pandemonium.json is still a real deliverable), independent of mode.
export function saveProject(project) {
  saveProjectToFile(project);
}
export async function openProjectFile(file) {
  return parseProjectFileText(await readFileAsText(file));
}

// Continuous persistence routes by mode. Local autosave (IndexedDB) is the
// offline and signed-out default; remote sync takes over once authenticated.
export function autosaveProject(project) {
  return getMode() === 'remote'
    ? autosaveProjectRemote(project, project._remoteId)
    : saveCurrentProjectLocally(project);
}
export function loadAutosavedProject() {
  return getMode() === 'remote'
    ? loadProjectRemote(getMode.currentId?.())
    : loadCurrentProjectLocally();
}
export function clearAutosavedProject() {
  return clearCurrentProjectLocally(); // local cache clear is always safe
}
```

3. Add `src/data/session.js`: holds the current mode, access token in memory,
   and the active remote project id. It is the only new dependency the seam
   introduces, and it is deliberately tiny.

4. Offline-first behavior: keep writing to IndexedDB even in remote mode, and
   treat the server as the source of truth on reconnect. This gives you offline
   editing for free and a local cache to reconcile from on a `409`.

Why this honors the existing design: the file header of `db.js` already
promises "A future backend is a third adapter implementing the same shape,
swapped in here, no component or store code should need to change." This plan is
exactly that promise, kept.

## Phase 3: Cloudflare Pages deployment (frontend)

The frontend is a static Vite SPA. Nothing about the build changes except one
environment variable that points it at the API.

1. Add `VITE_API_BASE` handling. In dev it is `http://localhost:8787/v1`; in
   production it is the deployed API origin. Vite already exposes
   `import.meta.env.VITE_*`.

2. Pages project settings (Cloudflare Pages supports Bun natively; set it as the
   package manager, or leave detection to the `bun.lock` at the repo root):
   - Build command: `bun run build`
   - Build output directory: `dist`
   - Environment variable: `VITE_API_BASE = https://api.pandemonium.app/v1`

3. SPA fallback. Add `public/_redirects` so client routes resolve:

```
/*    /index.html   200
```

4. Deploy. Either connect the Git repo in the Cloudflare dashboard (build on
   push), or use Wrangler:

```bash
bun add -d wrangler
bun run build
bunx wrangler pages deploy dist --project-name pandemonium
```

5. CORS: the API `CORS_ORIGIN` must list the Pages domain
   (`https://pandemonium.pages.dev` and any custom domain). Credentials are
   included for the refresh cookie, so the API must echo the exact origin, not
   `*`.

## Phase 4: Oracle Cloud (OCI) Always Free deployment (backend and DB)

Target: one Ampere A1 instance (Always Free allows up to 4 OCPU / 24 GB RAM)
running Docker Compose: Postgres, the Bun API, and Caddy for TLS.

### 4.1 Provision the instance

1. Create an Ampere A1 (aarch64) compute instance, Ubuntu 22.04 or 24.04. A
   sensible free split is 2 OCPU / 12 GB. Note: Ampere is ARM, so the API base
   image (`oven/bun`) must be multi-arch (it is; Bun ships arm64). There are no
   native npm addons to compile: password hashing and Postgres are Bun built-ins.
2. Assign a reserved public IP.
3. Add an A record for `api.pandemonium.app` pointing at that IP (Cloudflare DNS,
   proxy off initially so Let's Encrypt can validate directly).

### 4.2 Open the network (two layers, both required)

OCI blocks ingress in two places. Miss either and TLS issuance hangs.

1. OCI Security List (or Network Security Group) on the instance subnet: add
   stateful ingress rules for TCP 80 and TCP 443 from `0.0.0.0/0`.
2. The instance's own firewall. Oracle Ubuntu images ship with restrictive
   iptables rules. Allow the ports:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Keep 5432 closed to the internet. Postgres is reached only over the Docker
network by the API container, never exposed on the host.

### 4.3 Install Docker and pull the repo

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
git clone <repo-url> pandemonium && cd pandemonium/server
cp .env.example .env   # set strong JWT_SECRET, real DB password, R2 creds,
                       # CORS_ORIGIN=https://pandemonium.pages.dev
```

### 4.4 Production compose overlay with Caddy (automatic TLS)

`server/compose.prod.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: pandemonium
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: pandemonium
    volumes: ["pgdata:/var/lib/postgresql/data"]
    restart: always
  api:
    build: { context: .., dockerfile: server/Dockerfile }
    env_file: .env
    depends_on: { db: { condition: service_healthy } }
    restart: always
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [api]
    restart: always
volumes:
  pgdata:
  caddy_data:
```

`server/Caddyfile` (this is the entire TLS setup; Caddy fetches and renews the
certificate automatically):

```
api.pandemonium.app {
  reverse_proxy api:8787
}
```

Bring it up and apply migrations:

```bash
docker compose -f compose.yml -f compose.prod.yml up -d --build
docker compose exec -T db psql -U pandemonium -d pandemonium < migrations/0001_init.sql
curl https://api.pandemonium.app/health
```

### 4.5 Nginx plus certbot alternative (if Caddy is not wanted)

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
# /etc/nginx/sites-available/pandemonium:
#   server { server_name api.pandemonium.app;
#            location / { proxy_pass http://127.0.0.1:8787;
#                         proxy_set_header Host $host;
#                         proxy_set_header X-Forwarded-For $remote_addr; } }
sudo ln -s /etc/nginx/sites-available/pandemonium /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.pandemonium.app   # issues and auto-renews
```

Here the API container publishes `127.0.0.1:8787` on the host and Nginx runs on
the host rather than in Compose. Caddy is fewer moving parts; Nginx is the
choice if you already run other host services.

### 4.6 Operations checklist

- Backups: nightly `pg_dump` to R2 or OCI Object Storage via cron. A database
  with no backup is a data-loss incident waiting for a date.
- Secrets: `JWT_SECRET` at least 32 bytes, DB password strong, `.env` never
  committed (add to `.gitignore`).
- Once TLS is verified working, turn Cloudflare proxy (orange cloud) on for the
  API record for DDoS shielding and caching of signed-asset reads.
- Log rotation and container `restart: always` are set; add `docker system prune`
  to cron to keep the small disk clean.
- Health endpoint plus an uptime check (Cloudflare Health Checks or a cron
  `curl`) so the single VM going down is noticed.

---

## Sequencing recommendation

1. Phase 1 and Phase 2A (document sync) first. This gets real accounts and
   cross-device persistence with minimal client change, because the whole
   project JSON keeps its current shape and just moves behind the API.
2. Phase 3 and 4 to go live on Cloudflare Pages plus OCI.
3. Phase 2B (granular resource tables and routes) and the R2 asset migration
   next, once there is real usage to justify decomposing the document. Do the
   asset extraction here so payloads shrink before they become a problem.
4. Collaboration (multi-member projects, presence, and eventually real-time
   editing) last, on top of the granular routes.

Nothing in this plan removes local file mode. `saveProject` and
`openProjectFile` stay local forever: a `.pandemonium.json` on disk remains a
first-class portable artifact regardless of whether a backend is present.
