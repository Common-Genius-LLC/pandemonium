-- PostgreSQL schema for Phase A (document sync): the whole project JSON tree is
-- stored as one jsonb blob per project rather than decomposed into per-entity
-- tables (that is Phase B, per docs/BACKEND_ARCHITECTURE.md). All statements are
-- idempotent so this file doubles as the migration. No extensions are required:
-- uuids are generated in the application (crypto.randomUUID).

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY,
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'Untitled',
  data        jsonb NOT NULL,
  schema_ver  integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner_id);

-- Refresh tokens are stored hashed (never cleartext), one row per issued token,
-- deleted on rotation and logout.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_user ON refresh_tokens (user_id);
