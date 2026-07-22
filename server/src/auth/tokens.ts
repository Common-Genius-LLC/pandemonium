// Token machinery. Access tokens are stateless JWTs (verified by signature).
// Refresh tokens are opaque random strings: we hand the raw value to the client
// in an httpOnly cookie and keep only its sha256 in the db, so a database leak
// never yields a usable token. Refresh tokens rotate on every use.

import { sign, verify } from 'hono/jwt';
import { db, now } from '../db';
import { config } from '../config';

const JWT_ALG = 'HS256';

export function signAccessToken(user: { id: string; email: string }) {
  const iat = Math.floor(Date.now() / 1000);
  return sign(
    { sub: user.id, email: user.email, iat, exp: iat + config.accessTtlSec },
    config.jwtSecret,
    JWT_ALG,
  );
}

// Throws if the token is missing, tampered, or expired. Returns the payload.
export function verifyAccessToken(token: string) {
  return verify(token, config.jwtSecret, JWT_ALG);
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sha256hex(s: string) {
  return new Bun.CryptoHasher('sha256').update(s).digest('hex');
}

// Issues a fresh refresh token, records its hash, returns the raw value to set
// as a cookie.
export async function issueRefreshToken(userId: string) {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + config.refreshTtlSec * 1000).toISOString();
  await db.query(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    [crypto.randomUUID(), userId, sha256hex(raw), expiresAt, now()],
  );
  return raw;
}

// Validates a raw refresh token against the db. Returns the owning user id, or
// null if unknown or expired. Does not rotate (that is the caller's job).
export async function lookupRefreshToken(raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  const [row] = await db.query(
    'SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = ?',
    [sha256hex(raw)],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await revokeRefreshToken(raw);
    return null;
  }
  return row.user_id as string;
}

export async function revokeRefreshToken(raw: string | undefined) {
  if (!raw) return;
  await db.query('DELETE FROM refresh_tokens WHERE token_hash = ?', [sha256hex(raw)]);
}
