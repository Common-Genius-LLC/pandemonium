// GET /v1/link-preview?url=...
//
// The one public route that makes this server reach out to the internet, so it
// is fenced on every side: the SSRF guard on every hop (link-preview/ssrf.ts),
// a per-client rate limit here, a global cap on upstream fetches and a 24-hour
// cache in the service, size and time caps on each fetch, and a response that
// is only ever a small JSON summary, never the fetched content itself. What it
// hands back is a card's worth of metadata and nothing an attacker could use
// the server to read.
//
// No auth, by decision: rich links should work for signed-out users too, who
// are most users of a local-first app.

import { Hono, type Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { config } from '../config';
import { HttpError } from '../errors';
import { createPreviewService } from '../link-preview/service';
import { systemLookup } from '../link-preview/dns';
import { createRateLimiter } from '../rate-limit';
import type { AppEnv } from '../types';

const MAX_URL_LENGTH = 2048;

function clientIp(c: Context<AppEnv>): string {
  if (config.trustProxy) {
    const real = c.req.header('x-real-ip');
    if (real) return real.trim();
  }
  try {
    return getConnInfo(c).remote.address || 'unknown';
  } catch {
    return 'unknown'; // no socket (app.request in tests)
  }
}

export function linkPreviewRoutes(
  service = createPreviewService({
    lookup: systemLookup,
    userAgent: config.linkPreview.userAgent || undefined,
    botUserAgent: config.linkPreview.botUserAgent || undefined,
    socialUserAgent: config.linkPreview.socialUserAgentOff ? null : undefined,
  }),
  limiter = createRateLimiter({ limit: config.linkPreview.ratePerMinute, windowMs: 60_000 }),
) {
  const r = new Hono<AppEnv>();

  r.get('/', async (c) => {
    const url = c.req.query('url');
    if (!url) throw new HttpError(400, 'missing url');
    if (url.length > MAX_URL_LENGTH) throw new HttpError(400, 'url too long');

    const verdict = limiter.check(clientIp(c));
    if (!verdict.ok) {
      c.header('Retry-After', String(verdict.retryAfterSec));
      throw new HttpError(429, 'too many link previews, slow down', { retryAfter: verdict.retryAfterSec });
    }

    const preview = await service.get(url);
    // Browsers and any CDN in front can cache the same way the service does:
    // a day for a page that was read, ten minutes for one that was not.
    c.header('Cache-Control', preview.fetched ? 'public, max-age=86400' : 'public, max-age=600');
    return c.json(preview);
  });

  return r;
}

export default linkPreviewRoutes();
