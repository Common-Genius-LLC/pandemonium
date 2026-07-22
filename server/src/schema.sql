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

CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner_id);

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
