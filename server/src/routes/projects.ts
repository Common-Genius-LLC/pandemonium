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

// Every route here is owner-scoped.
projects.use('*', requireAuth);

async function ownedRow(id: string, userId: string): Promise<ProjectRow> {
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

// List: metadata only, newest first. The full tree is fetched per project.
projects.get('/', async (c) => {
  const rows = await db.query(
    'SELECT id, name, updated_at FROM projects WHERE owner_id = ? ORDER BY updated_at DESC',
    [c.get('userId')],
  );
  return c.json(rows.map((r: any) => ({ id: r.id, name: r.name, updatedAt: isoOf(r.updated_at) })));
});

projects.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const project = validateProject(body.project);
  const id = crypto.randomUUID();
  const ts = now();
  await db.query(
    'INSERT INTO projects (id, owner_id, name, data, schema_ver, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    [id, c.get('userId'), project.name || 'Untitled', JSON.stringify(project), ts, ts],
  );
  return c.json({ id, project, updatedAt: ts }, 201);
});

projects.get('/:id', async (c) => {
  return c.json(toResponse(await ownedRow(c.req.param('id'), c.get('userId'))));
});

// Update with optimistic concurrency. If the client sends baseUpdatedAt and it
// no longer matches the stored timestamp, someone else (another device or
// collaborator) wrote in between: respond 409 with the current server copy so
// the client can reconcile rather than silently clobber it.
projects.put('/:id', async (c) => {
  const existing = await ownedRow(c.req.param('id'), c.get('userId'));
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
    'UPDATE projects SET name = ?, data = ?, updated_at = ? WHERE id = ?',
    [project.name || 'Untitled', JSON.stringify(project), ts, existing.id],
  );
  return c.json({ id: existing.id, project, updatedAt: ts });
});

projects.delete('/:id', async (c) => {
  const existing = await ownedRow(c.req.param('id'), c.get('userId'));
  await db.query('DELETE FROM projects WHERE id = ?', [existing.id]);
  return c.body(null, 204);
});

export default projects;
