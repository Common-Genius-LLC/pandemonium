// Auth surface: register, login, refresh, logout, me. Passwords are hashed with
// Bun.password (argon2id, built in, no dependency). The refresh token rides in
// an httpOnly cookie; the access token is returned in the body for the client
// to hold in memory and send as a Bearer header.

import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { db, now } from '../db';
import { config } from '../config';
import { HttpError } from '../errors';
import { requireAuth } from './middleware';
import { signAccessToken, issueRefreshToken, lookupRefreshToken, revokeRefreshToken } from './tokens';
import type { AppEnv, UserRow, PublicUser } from '../types';

const REFRESH_COOKIE = 'pnd_refresh';
const COOKIE_PATH = '/v1/auth';

function setRefreshCookie(c: Context, raw: string) {
  setCookie(c, REFRESH_COOKIE, raw, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSecure ? 'None' : 'Lax',
    path: COOKIE_PATH,
    maxAge: config.refreshTtlSec,
  });
}

function publicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, displayName: row.display_name };
}

async function issueSession(c: Context, user: UserRow) {
  const accessToken = await signAccessToken(user);
  setRefreshCookie(c, await issueRefreshToken(user.id));
  return { user: publicUser(user), accessToken };
}

const auth = new Hono<AppEnv>();

auth.post('/register', async (c) => {
  const { email, password, displayName } = await c.req.json().catch(() => ({}));
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) throw new HttpError(400, 'a valid email is required');
  if (!password || password.length < 8) throw new HttpError(400, 'password must be at least 8 characters');

  const [exists] = await db.query('SELECT 1 AS one FROM users WHERE email = ?', [cleanEmail]);
  if (exists) throw new HttpError(409, 'an account with that email already exists');

  const user: UserRow = {
    id: crypto.randomUUID(),
    email: cleanEmail,
    display_name: (displayName || '').trim(),
    password_hash: await Bun.password.hash(password),
    created_at: now(),
  };
  await db.query(
    'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
    [user.id, user.email, user.password_hash, user.display_name, user.created_at],
  );

  return c.json(await issueSession(c, user), 201);
});

auth.post('/login', async (c) => {
  const { email, password } = await c.req.json().catch(() => ({}));
  const cleanEmail = (email || '').trim().toLowerCase();
  const [row] = await db.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
  // Verify against the stored hash. When the account does not exist, still run a
  // hash so the response time does not reveal which emails are registered.
  let ok = false;
  if (row) ok = await Bun.password.verify(password || '', row.password_hash);
  else await Bun.password.verify('x', await Bun.password.hash('y'));
  if (!row || !ok) throw new HttpError(401, 'incorrect email or password');
  return c.json(await issueSession(c, row as UserRow));
});

auth.post('/refresh', async (c) => {
  const raw = getCookie(c, REFRESH_COOKIE);
  const userId = await lookupRefreshToken(raw);
  if (!userId) throw new HttpError(401, 'no valid refresh token');
  // Rotate: the presented token is single use.
  await revokeRefreshToken(raw);
  const [row] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!row) throw new HttpError(401, 'no valid refresh token');
  const accessToken = await signAccessToken(row as UserRow);
  setRefreshCookie(c, await issueRefreshToken(row.id));
  return c.json({ accessToken });
});

auth.post('/logout', async (c) => {
  await revokeRefreshToken(getCookie(c, REFRESH_COOKIE));
  deleteCookie(c, REFRESH_COOKIE, { path: COOKIE_PATH });
  return c.body(null, 204);
});

auth.get('/me', requireAuth, async (c) => {
  const [row] = await db.query('SELECT * FROM users WHERE id = ?', [c.get('userId')]);
  if (!row) throw new HttpError(404, 'user not found');
  return c.json({ user: publicUser(row as UserRow) });
});

export default auth;
