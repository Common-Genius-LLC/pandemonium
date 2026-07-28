-- Dialect-neutral schema for Phase A (document sync), running unchanged on both
-- SQLite (dev) and PostgreSQL (prod). Choices that keep it portable:
--   - ids are TEXT (app-generated uuids via crypto.randomUUID).
--   - the project tree is stored as one TEXT blob (JSON string); Phase A never
--     queries inside it, so no jsonb is needed. Phase B can enrich this on
--     Postgres.
--   - timestamps are TEXT (ISO strings) set by the app, so the two engines are
--     directly comparable and there are no engine-specific DEFAULT expressions.
-- All statements are idempotent so this file doubles as the migration.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Untitled',
  data        TEXT NOT NULL,
  schema_ver  INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- NOTE: `workspace` is added by the additive migration in db.ts rather than
-- here, because a fresh database and an existing one both have to end up with
-- it and ADD COLUMN has no portable IF NOT EXISTS. Adding it to the CREATE
-- above as well would leave the two paths free to drift.

CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner_id);

CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime          TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  data_url      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS assets_owner ON assets (owner_id);

-- Sharing. Phase A stores a project as one document row, so a grant is
-- project-scoped: offering per-script access would promise an isolation the
-- storage cannot enforce.
CREATE TABLE IF NOT EXISTS project_shares (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  grantee_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,            -- 'viewer' | 'editor'
  created_at  TEXT NOT NULL,
  UNIQUE (project_id, grantee_id)
);

CREATE INDEX IF NOT EXISTS shares_grantee ON project_shares (grantee_id);
CREATE INDEX IF NOT EXISTS shares_project ON project_shares (project_id);

-- Read-only share links: one unguessable token per project, minted on demand
-- and revocable independently of everything else. The token is a capability;
-- it is never derivable from anything the client already holds.
CREATE TABLE IF NOT EXISTS project_links (
  project_id  TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- Refresh tokens are stored hashed (never cleartext), one row per issued token,
-- deleted on rotation and logout.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS refresh_user ON refresh_tokens (user_id);
