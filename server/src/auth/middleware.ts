// Gate for protected routes: requires a valid Bearer access token and stashes
// the caller's user id on the context for handlers to read via c.get('userId').

import type { MiddlewareHandler } from 'hono';
import { verifyAccessToken } from './tokens';
import { HttpError } from '../errors';
import type { AppEnv } from '../types';

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') || '';
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) throw new HttpError(401, 'missing bearer token');
  let payload;
  try {
    payload = await verifyAccessToken(m[1]);
  } catch {
    throw new HttpError(401, 'invalid or expired token');
  }
  c.set('userId', payload.sub as string);
  c.set('userEmail', (payload.email as string) || '');
  await next();
};
