// Runtime configuration, read once from the environment (Bun auto-loads .env).
// Twelve-factor: everything that differs between local and prod is here, and
// nowhere else reads process.env directly.

const num = (v: string | undefined, d: number) => (v == null || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8787),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-change-me-0123456789abcdef',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://pandemonium:devpassword@localhost:5432/pandemonium',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Access token: short lived, verified on every request. Refresh token: long
  // lived, rotated on use, stored hashed in the db.
  accessTtlSec: 60 * 15,
  refreshTtlSec: 60 * 60 * 24 * 30,
};
