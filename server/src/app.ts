// Hono application assembly: CORS, health check, route mounting, and a single
// error handler that turns thrown HttpErrors into clean JSON. Exported without
// starting a server so tests can drive it via app.request(); index.ts is what
// actually listens.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { config } from './config';
import { HttpError } from './errors';
import authRoutes from './auth/routes';
import assetRoutes from './routes/assets';
import projectRoutes from './routes/projects';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Request logging first, so every request and its response status/time is
// printed to the server console. Skipped under test to keep output clean.
if (process.env.NODE_ENV !== 'test') app.use('*', logger());

// Credentials are included for the refresh cookie, so the origin must be the
// exact Vite/Pages origin, never "*".
app.use('*', cors({
  origin: config.corsOrigin,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/health', (c) => c.json({ ok: true, service: 'pandemonium-api' }));

app.route('/v1/auth', authRoutes);
app.route('/v1/assets', assetRoutes);
app.route('/v1/projects', projectRoutes);

app.notFound((c) => c.json({ error: 'not found' }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, ...(err.extra || {}) }, err.status as any);
  }
  console.error('unhandled error:', err);
  return c.json({ error: 'internal server error' }, 500);
});

export default app;
