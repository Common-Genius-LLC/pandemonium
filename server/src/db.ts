// The one place that opens the database. Everything else imports `sql` from
// here. Uses Bun's native Postgres client (Bun.SQL), so there is no third-party
// driver dependency. The connection is lazy: constructing SQL does not dial the
// server, the first query does.

import { SQL } from 'bun';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config';

const here = dirname(fileURLToPath(import.meta.url));

export const sql = new SQL(config.databaseUrl);

// ISO timestamp used for created_at/updated_at so the value the client sees is
// exactly what optimistic-concurrency comparisons run against.
export const now = () => new Date().toISOString();

// Applies schema.sql. It is all CREATE ... IF NOT EXISTS, so it is safe on every
// boot. Bun.SQL sends one statement per query, so the file is split first (there
// are no function bodies or dollar-quoted strings to complicate splitting).
export async function migrate() {
  const text = readFileSync(join(here, 'schema.sql'), 'utf8');
  const withoutComments = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const statements = withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sql.unsafe(stmt);
  }
}
