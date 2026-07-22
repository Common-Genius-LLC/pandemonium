// Asset storage for media that should not live inside the project JSON.
// Phase A keeps this intentionally small: the API stores the asset row and
// serves the data URL back on demand, while the client keeps the project blob
// itself compact by referencing assets by id.

import { Hono } from 'hono';
import { db, now } from '../db';
import { HttpError } from '../errors';
import { requireAuth } from '../auth/middleware';
import type { AppEnv, AssetRow } from '../types';

const assets = new Hono<AppEnv>();

assets.use('*', requireAuth);

function ownedAsset(id: string, userId: string): Promise<AssetRow> {
  return db.query('SELECT * FROM assets WHERE id = ?', [id]).then((rows) => {
    const [row] = rows;
    if (!row || row.owner_id !== userId) throw new HttpError(404, 'asset not found');
    return row as AssetRow;
  });
}

function parseDataUrl(dataUrl: string): { mime: string; dataUrl: string } {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?(?:;base64)?,/i.exec(dataUrl || '');
  if (!match) throw new HttpError(400, 'invalid asset data');
  return { mime: match[1], dataUrl };
}

assets.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
  if (!dataUrl) throw new HttpError(400, 'missing asset data');
  const parsed = parseDataUrl(dataUrl);
  const id = crypto.randomUUID();
  const ts = now();
  await db.query(
    'INSERT INTO assets (id, owner_id, mime, original_name, data_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, c.get('userId'), parsed.mime, String(body.originalName || ''), parsed.dataUrl, ts],
  );
  return c.json({ id, mime: parsed.mime, originalName: String(body.originalName || ''), createdAt: ts }, 201);
});

assets.get('/:id', async (c) => {
  const asset = await ownedAsset(c.req.param('id'), c.get('userId'));
  return c.json({
    id: asset.id,
    mime: asset.mime,
    originalName: asset.original_name,
    dataUrl: asset.data_url,
  });
});

export default assets;