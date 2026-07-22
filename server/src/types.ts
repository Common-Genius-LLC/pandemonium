// Shared row and payload shapes. Kept deliberately light: the project tree
// itself stays `unknown`/`any` here because its authoritative shape lives in
// the client's src/data (imported for validation), not duplicated in the server.

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string | Date;
}

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  data: unknown; // jsonb: parsed object from Bun.SQL, or string
  schema_ver: number;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

// Hono context variables set by requireAuth.
export type AppEnv = { Variables: { userId: string; userEmail: string } };
