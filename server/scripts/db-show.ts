// Inspect the dev database. Read-only, safe to run while the server is up.
//
//   bun run db:show                 tables + users + projects (summary)
//   bun run db:show <projectId>     the full stored JSON tree for one project
//
// Only supports the SQLite dev database (a postgres:// URL prints a hint).

import { Database } from 'bun:sqlite';
import { config } from '../src/config';

const url = config.databaseUrl;
if (/^postgres/i.test(url)) {
  console.log('DATABASE_URL is Postgres. Use psql, e.g.:');
  console.log(`  psql "${url}" -c "SELECT id, email FROM users;"`);
  process.exit(0);
}

const path = url.replace(/^sqlite:\/\//i, '').replace(/^file:/i, '') || ':memory:';
const db = new Database(path, { readonly: true });

const projectId = process.argv[2];

if (projectId) {
  const row = db.query('SELECT name, data FROM projects WHERE id = ?').get(projectId) as
    | { name: string; data: string }
    | undefined;
  if (!row) {
    console.log(`No project with id ${projectId}`);
    process.exit(1);
  }
  console.log(`# ${row.name} (${projectId})`);
  console.log(JSON.stringify(JSON.parse(row.data), null, 2));
  process.exit(0);
}

console.log(`DB: ${path}\n`);
console.log('USERS');
console.table(db.query('SELECT id, email, display_name, created_at FROM users').all());
console.log('PROJECTS');
console.table(
  db.query('SELECT id, owner_id, name, length(data) AS data_bytes, updated_at FROM projects ORDER BY updated_at DESC').all(),
);
console.log('refresh_tokens:', (db.query('SELECT count(*) AS n FROM refresh_tokens').get() as { n: number }).n);
