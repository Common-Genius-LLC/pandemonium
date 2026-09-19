// Runtime configuration, read once from the environment (Bun auto-loads .env).
// Twelve-factor: everything that differs between local and prod is here, and
// nowhere else reads process.env directly.

const num = (v: string | undefined, d: number) => (v == null || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 8787),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-change-me-0123456789abcdef',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // SQLite by default for zero-infra dev (sqlite://path, file:path, :memory:, or
  // a bare path). Set a postgres:// URL for prod. See db.ts for driver selection.
  databaseUrl: process.env.DATABASE_URL || 'sqlite://./pandemonium.dev.sqlite',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  // Access token: short lived, verified on every request. Refresh token: long
  // lived, rotated on use, stored hashed in the db.
  accessTtlSec: 60 * 15,
  refreshTtlSec: 60 * 60 * 24 * 30,
  // Behind a reverse proxy the socket address is the proxy's, so every caller
  // would share one rate-limit bucket. With this on, the client address is
  // read from X-Real-IP, which the nginx config in docs/DEPLOYMENT.md SETS
  // (overwriting anything the client sent) rather than appends to. Leave it
  // off anywhere the API is reachable without that proxy in front, or anyone
  // could choose their own address by sending the header.
  trustProxy: process.env.TRUST_PROXY === 'true',
  linkPreview: {
    // Requests per client per minute to /v1/link-preview. Cache hits count
    // too: they are cheap, but a limit that only counted misses would be one
    // any caller could reason about and walk around with unique URLs.
    ratePerMinute: num(process.env.LINK_PREVIEW_RATE_PER_MINUTE, 60),
    userAgent: process.env.LINK_PREVIEW_USER_AGENT || '',
    botUserAgent: process.env.LINK_PREVIEW_BOT_USER_AGENT || '',
  },
};
