// Project persistence, Phase A document sync: the whole project JSON tree is
// stored as one jsonb blob per row. This maps 1:1 onto the client's existing
// project shape, so the remote adapter (src/data/remote-api-adapter.js) can move
// a project to and from the server with no restructuring. Granular per-entity
// routes come in Phase B, per docs/BACKEND_ARCHITECTURE.md.

import { Hono } from 'hono';
import { db, now } from '../db';
import { HttpError } from '../errors';
import { requireAuth } from '../auth/middleware';
import { validateProject } from '../domain/validate';
import type { AppEnv, ProjectRow } from '../types';

const projects = new Hono<AppEnv>();

projects.use('*', requireAuth);

export type Role = 'owner' | 'editor' | 'viewer';

// Access is owner-or-grantee now, not owner-only: project_shares rows grant
// 'viewer' or 'editor'. A request for a project the user has no path to is a
// 404, not a 403, so the response does not confirm the project exists.
export async function accessibleRow(id: string, userId: string, write = false): Promise<{ row: ProjectRow; role: Role }> {
  const [row] = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'project not found');
  if (row.owner_id === userId) return { row: row as ProjectRow, role: 'owner' };
  const [share] = await db.query(
    'SELECT role FROM project_shares WHERE project_id = ? AND grantee_id = ?',
    [id, userId],
  );
  if (!share) throw new HttpError(404, 'project not found');
  const role = share.role === 'editor' ? 'editor' : 'viewer';
  if (write && role !== 'editor') {
    throw new HttpError(403, 'you have view access to this project only');
  }
  return { row: row as ProjectRow, role };
}

// Owner-only operations (deleting, managing shares) keep the strict check.
export async function ownedRow(id: string, userId: string): Promise<ProjectRow> {
  const [row] = await db.query('SELECT * FROM projects WHERE id = ?', [id]);
  if (!row || row.owner_id !== userId) throw new HttpError(404, 'project not found');
  return row as ProjectRow;
}

function isoOf(v: string | Date): string {
  return new Date(v).toISOString();
}

function toResponse(row: ProjectRow) {
  const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  return { id: row.id, project: data, updatedAt: isoOf(row.updated_at) };
}

// List: metadata only, newest first, owned and shared-with-me together, each
// row labeled with the caller's role so the client can show it and hide
// owner-only actions. Two queries merged in JS rather than a UNION, which
// keeps the SQL dialect-neutral. `workspace` is a column rather than a read
// into the `data` blob: doing it in SQL would need json_extract on SQLite and
// ->> on Postgres, exactly the dialect split the single query layer avoids.
projects.get('/', async (c) => {
  const userId = c.get('userId');
  const owned = await db.query(
    'SELECT id, name, workspace, updated_at FROM projects WHERE owner_id = ?',
    [userId],
  );
  const shared = await db.query(
    `SELECT p.id, p.name, p.workspace, p.updated_at, s.role
     FROM projects p JOIN project_shares s ON s.project_id = p.id
     WHERE s.grantee_id = ?`,
    [userId],
  );
  const rows = [
    ...owned.map((r: any) => ({ ...r, role: 'owner' })),
    ...shared.map((r: any) => ({ ...r, role: r.role === 'editor' ? 'editor' : 'viewer' })),
  ].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return c.json(rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    workspace: r.workspace || '',
    role: r.role,
    updatedAt: isoOf(r.updated_at),
  })));
});

projects.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const project = validateProject(body.project);
  const id = crypto.randomUUID();
  const ts = now();
  await db.query(
    'INSERT INTO projects (id, owner_id, name, workspace, data, schema_ver, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    [id, c.get('userId'), project.name || 'Untitled', String(project.workspace || ''), JSON.stringify(project), ts, ts],
  );
  return c.json({ id, project, updatedAt: ts }, 201);
});

projects.get('/:id', async (c) => {
  const { row, role } = await accessibleRow(c.req.param('id'), c.get('userId'));
  return c.json({ ...toResponse(row), role });
});

// Update with optimistic concurrency. If the client sends baseUpdatedAt and it
// no longer matches the stored timestamp, someone else (another device or
// collaborator) wrote in between: respond 409 with the current server copy so
// the client can merge rather than silently clobber it. The 409 body must keep
// carrying the FULL current project: it is one of the three inputs the
// client's three-way merge needs, so a metadata-only "optimization" here
// breaks conflict resolution outright.
projects.put('/:id', async (c) => {
  const { row: existing } = await accessibleRow(c.req.param('id'), c.get('userId'), true);
  const body = await c.req.json().catch(() => ({}));
  const currentTs = isoOf(existing.updated_at);
  if (body.baseUpdatedAt && body.baseUpdatedAt !== currentTs) {
    throw new HttpError(409, 'project changed on the server since it was loaded', {
      current: toResponse(existing),
    });
  }
  const project = validateProject(body.project);
  const ts = now();
  await db.query(
    'UPDATE projects SET name = ?, workspace = ?, data = ?, updated_at = ? WHERE id = ?',
    [project.name || 'Untitled', String(project.workspace || ''), JSON.stringify(project), ts, existing.id],
  );
  return c.json({ id: existing.id, project, updatedAt: ts });
});

projects.delete('/:id', async (c) => {
  const existing = await ownedRow(c.req.param('id'), c.get('userId'));
  await db.query('DELETE FROM projects WHERE id = ?', [existing.id]);
  return c.body(null, 204);
});

export default projects;
