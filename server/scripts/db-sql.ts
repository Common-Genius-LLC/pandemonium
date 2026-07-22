// Run an arbitrary SQL statement against the dev SQLite database. Reads and
// writes (so you can fix or clean up rows locally). Examples:
//
//   bun run db:sql "SELECT id, name FROM projects"
//   bun run db:sql "DELETE FROM projects WHERE id = 'abc'"
//
// Only supports the SQLite dev database (a postgres:// URL prints a psql hint).

import { Database } from 'bun:sqlite';
import { config } from '../src/config';

const sqlText = process.argv.slice(2).join(' ').trim();
if (!sqlText) {
  console.log('Usage: bun run db:sql "<SQL statement>"');
  process.exit(1);
}

const url = config.databaseUrl;
if (/^postgres/i.test(url)) {
  console.log('DATABASE_URL is Postgres. Use psql instead, e.g.:');
  console.log(`  psql "${url}" -c "${sqlText.replace(/"/g, '\\"')}"`);
  process.exit(0);
}

const path = url.replace(/^sqlite:\/\//i, '').replace(/^file:/i, '') || ':memory:';
const db = new Database(path);
db.exec('PRAGMA foreign_keys = ON;');

if (/^\s*(select|pragma|with|explain)/i.test(sqlText)) {
  console.table(db.query(sqlText).all());
} else {
  const info = db.run(sqlText);
  console.log('OK. rows changed:', info.changes);
}
