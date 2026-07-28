// Sharing: collaborator grants and read-only links. Phase A stores a project
// as one document row, so every grant here is project-scoped; a per-script
// grant would promise an isolation the storage cannot enforce (see
// docs/BACKEND_ARCHITECTURE.md, addendum B).
//
// Two routers are exported because they sit on opposite sides of auth:
//   - `shares`, mounted under /v1/projects, owner-only management of grants
//     and the read link
//   - `sharedPublic`, mounted at /v1/shared, the ONE unauthenticated surface:
//     resolving a link token to a read-only projection. The token is the
//     capability, so possession is the whole check; what it serves is a
//     projection (final draft plus boards), never the stored row, because
//     research notes and collaborator emails are not part of what a shared
//     script link promises.

import { Hono } from 'hono';
import { db, now } from '../db';
import { HttpError } from '../errors';
import { requireAuth } from '../auth/middleware';
import { ownedRow } from './projects';
import type { AppEnv } from '../types';

const ROLES = new Set(['viewer', 'editor']);

export const shares = new Hono<AppEnv>();
shares.use('*', requireAuth);

// ---- collaborator grants (owner only) ----

shares.get('/:id/shares', async (c) => {
  const project = await ownedRow(c.req.param('id'), c.get('userId'));
  const rows = await db.query(
    `SELECT s.id, s.role, s.created_at, u.email, u.display_name
     FROM project_shares s JOIN users u ON u.id = s.grantee_id
     WHERE s.project_id = ?`,
    [project.id],
  );
  return c.json(rows.map((r: any) => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name || '',
    role: r.role,
    createdAt: new Date(r.created_at).toISOString(),
  })));
});

shares.post('/:id/shares', async (c) => {
  const project = await ownedRow(c.req.param('id'), c.get('userId'));
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || 'viewer');
  if (!email) throw new HttpError(400, 'an email is required');
  if (!ROLES.has(role)) throw new HttpError(400, 'role must be viewer or editor');

  const [grantee] = await db.query('SELECT id, email, display_name FROM users WHERE email = ?', [email]);
  // Grants require an existing account: inviting an address with none would
  // need an email pipeline this backend does not have, and pretending
  // otherwise would leave the owner believing something was shared.
  if (!grantee) throw new HttpError(404, 'no account exists with that email');
  if (grantee.id === c.get('userId')) throw new HttpError(400, 'that is your own account');

  // Upsert by hand (UPDATE, then INSERT if nothing moved): portable across
  // both engines without ON CONFLICT dialect differences.
  const ts = now();
  await db.query(
    'UPDATE project_shares SET role = ? WHERE project_id = ? AND grantee_id = ?',
    [role, project.id, grantee.id],
  );
  const [existing] = await db.query(
    'SELECT id FROM project_shares WHERE project_id = ? AND grantee_id = ?',
    [project.id, grantee.id],
  );
  let shareId = existing && existing.id;
  if (!shareId) {
    shareId = crypto.randomUUID();
    await db.query(
      'INSERT INTO project_shares (id, project_id, grantee_id, role, created_at) VALUES (?, ?, ?, ?, ?)',
      [shareId, project.id, grantee.id, role, ts],
    );
  }
  return c.json({ id: shareId, email: grantee.email, displayName: grantee.display_name || '', role, createdAt: ts }, 201);
});

shares.delete('/:id/shares/:shareId', async (c) => {
  const project = await ownedRow(c.req.param('id'), c.get('userId'));
  await db.query('DELETE FROM project_shares WHERE id = ? AND project_id = ?', [c.req.param('shareId'), project.id]);
  return c.body(null, 204);
});

// ---- read-only link (owner only) ----

shares.get('/:id/share-link', async (c) => {
  const project = await ownedRow(c.req.param('id'), c.get('userId'));
  const [row] = await db.query('SELECT token FROM project_links WHERE project_id = ?', [project.id]);
  return c.json({ token: row ? row.token : null });
});

shares.post('/:id/share-link', async (c) => {
  const project = await ownedRow(c.req.param('id'), c.get('userId'));
  const [existing] = await db.query('SELECT token FROM project_links WHERE project_id = ?', [project.id]);
  // Minting twice returns the same token: the owner asking again wants the
  // link, not a rotation. Revoke and mint again is the rotation path.
  if (existing) return c.json({ token: existing.token });
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await db.query(
    'INSERT INTO project_links (project_id, token, created_at) VALUES (?, ?, ?)',
    [project.id, token, now()],
  );
  return c.json({ token }, 201);
});

shares.delete('/:id/share-link', async (c) => {
  const project = await ownedRow(c.req.param('id'), c.get('userId'));
  await db.query('DELETE FROM project_links WHERE project_id = ?', [project.id]);
  return c.body(null, 204);
});

// ---- public link resolution (no auth) ----

export const sharedPublic = new Hono<AppEnv>();

sharedPublic.get('/:token', async (c) => {
  const token = c.req.param('token');
  const [link] = await db.query('SELECT project_id FROM project_links WHERE token = ?', [token]);
  if (!link) throw new HttpError(404, 'link not found');
  const [row] = await db.query('SELECT name, workspace, data FROM projects WHERE id = ?', [link.project_id]);
  if (!row) throw new HttpError(404, 'link not found');

  const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
  const finalDraft = (data.scripts || []).find((s: any) => s.final) || (data.scripts || [])[0];

  // Board images live in the assets table (the blob only carries imgAssetId);
  // the viewer is unauthenticated and cannot call /v1/assets, so they are
  // inlined here. The link token gates this: it is the capability that grants
  // exactly this projection, images included.
  const boards: Array<{ id: string; anchor: unknown; img: string | null; caption: string; seq: number }> = [];
  for (const b of data.boards || []) {
    let img = b.img || null;
    if (!img && b.imgAssetId) {
      const [asset] = await db.query('SELECT data_url FROM assets WHERE id = ?', [b.imgAssetId]);
      img = asset ? asset.data_url : null;
    }
    boards.push({ id: b.id, anchor: b.anchor, img, caption: b.caption || '', seq: b.seq || 0 });
  }

  // Project-shaped so the client can load it straight into its store, with
  // everything a script link does not promise stripped: research, comments,
  // links, other drafts, contributor names.
  return c.json({
    project: {
      name: row.name,
      workspace: row.workspace || '',
      type: '', targetMins: data.targetMins || 0, contributors: [],
      scripts: finalDraft ? [{ id: finalDraft.id, name: finalDraft.name, text: finalDraft.text || '', final: true }] : [],
      boards,
      research: [], links: [], comments: [],
      layout: null,
    },
  });
});
