# Pandemonium

Web app for film pre-production: write the Fountain script, board it, and back
every claim with a source, in one place. Frontend is Lit + Vite (plain JS). The
backend under `server/` is Bun + Hono + Postgres (TypeScript). See
[CLAUDE.md](CLAUDE.md) for project context and
[docs/BACKEND_ARCHITECTURE.md](docs/BACKEND_ARCHITECTURE.md) for the backend
design.

Package manager is Bun for both. If `bun` is not found, open a new terminal
(the installer adds `C:\Users\naman\.bun\bin` to PATH) or run
`& "$env:USERPROFILE\.bun\bin\bun.exe"`.

## Frontend (Vite dev server)

Run from the repo root:

```bash
bun install          # first time only
bun run dev          # http://localhost:5173
```

Other frontend commands:

```bash
bun run build        # production build to dist/
bun run preview      # serve the built dist/
bun run test         # Vitest (note: NOT "bun test", which runs Bun's own runner)
```

The frontend runs fully standalone: signed out, projects save to the browser
(IndexedDB autosave) and to `.pandemonium.json` files, so you do not need the
server running to use the app. Sign in (topbar or start screen) to sync projects
to your account instead; that path needs the backend running (below). Set
`VITE_API_BASE` in `.env.local` to point at the API (defaults to
`http://localhost:8787/v1`; see `.env.example`).

## Backend (API + database)

The backend needs a PostgreSQL database. The compose file starts one.

Run from `server/`:

```bash
cd server
bun install                 # first time only
cp .env.example .env        # first time only, then set a real JWT_SECRET

docker compose up -d db     # start Postgres (needs Docker Desktop running)
bun run migrate             # apply the schema (first time, and after schema changes)
bun run dev                 # http://localhost:8787, auto-reload
```

Check it is up:

```bash
curl http://localhost:8787/health
```

No Docker? Point `DATABASE_URL` in `server/.env` at any Postgres (for example a
free cloud instance), then run `bun run migrate` and `bun run dev`.

### Backend verification

```bash
cd server
bun run typecheck           # tsc --noEmit
bun test                    # health check only (no database needed)
RUN_DB_TESTS=1 bun test     # full auth + project-sync flow (needs Postgres up)
```

## Running both together

Two terminals:

- Terminal 1 (repo root): `bun run dev` for the frontend on port 5173.
- Terminal 2 (`server/`): `docker compose up -d db` then `bun run dev` for the
  API on port 8787.

`CORS_ORIGIN` in `server/.env` defaults to `http://localhost:5173`, so the two
line up. With both running, sign in from the app to create an account and sync
projects to the backend.

## Ports

| Service | URL |
| --- | --- |
| Frontend (Vite) | http://localhost:5173 |
| Backend API | http://localhost:8787 |
| Postgres | localhost:5432 |
