// GET /api/link-preview?url=... on the frontend's own domain: the production
// home of link previews, as a Cloudflare Pages Function.
//
// Why here and not only on the API server: a preview needs no database and no
// account, just fetch-and-parse, which is exactly what an edge function is for;
// it deploys with the frontend on every push to main; and it sits on the
// app's own origin, so the browser calls it with no CORS at all. The Bun route
// (server/src/routes/link-preview.ts) serves local development and stays
// available on the API server. Both are thin adapters over ONE pipeline,
// server/src/link-preview/service.ts, so they cannot drift.
//
// What changes at the edge, and why it is safe:
//   - no DNS pre-check (lookup: null). A Worker cannot connect to a private or
//     reserved address at all (Cloudflare answers error 1000 for a name that
//     resolves to one), and there is no metadata service or private network of
//     ours behind it. Private IP literals and localhost names are still
//     refused by the shared URL rules.
//   - the cache is Cloudflare's own (the Cache API, per data centre) on top of
//     the per-isolate LRU in the service: a day for a page that was read, ten
//     minutes for one that was not, same as everywhere else.
//   - the rate limit is per isolate. It is a speed bump, not a wall; the real
//     cost ceiling is the Workers plan's request quota, and running past it
//     stops previews, never the site (static assets are not metered).
//   - browsers on other sites are refused (Sec-Fetch-Site), so this is the
//     app's endpoint and not a free unfurl API for anyone's visitors.

import { createPreviewService } from '../../server/src/link-preview/service';
import { parseFetchableUrl } from '../../server/src/link-preview/ssrf';
import { createRateLimiter } from '../../server/src/rate-limit';
import { HttpError } from '../../server/src/errors';

interface Context {
  request: Request;
  env: Record<string, string | undefined>;
  waitUntil: (p: Promise<unknown>) => void;
}

let service: ReturnType<typeof createPreviewService> | null = null;
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

function serviceFor(env: Context['env']) {
  if (!service) {
    service = createPreviewService({
      lookup: null,
      userAgent: env.LINK_PREVIEW_USER_AGENT || undefined,
      botUserAgent: env.LINK_PREVIEW_BOT_USER_AGENT || undefined,
      socialUserAgent: env.LINK_PREVIEW_SOCIAL_UA === 'off' ? null : undefined,
    });
  }
  return service;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

export async function onRequestGet(context: Context): Promise<Response> {
  const { request } = context;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'not available cross-site' }, 403);

  const target = new URL(request.url).searchParams.get('url');
  if (!target) return json({ error: 'missing url' }, 400);
  if (target.length > 2048) return json({ error: 'url too long' }, 400);

  let key: string;
  try {
    const parsed = parseFetchableUrl(target);
    parsed.hash = '';
    key = parsed.href;
  } catch (err) {
    return json({ error: (err as Error).message }, err instanceof HttpError ? err.status : 400);
  }

  // A synthetic request is the cache key: one entry per previewed URL, shared
  // by every visitor that data centre serves.
  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const cacheKey = new Request('https://link-preview.cache/?url=' + encodeURIComponent(key));
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  // Only a miss costs an upstream fetch, so only a miss is rate limited.
  const verdict = limiter.check(request.headers.get('cf-connecting-ip') || 'unknown');
  if (!verdict.ok) return json({ error: 'too many link previews, slow down' }, 429, { 'retry-after': String(verdict.retryAfterSec) });

  try {
    const preview = await serviceFor(context.env).get(key);
    const res = json(preview, 200, { 'cache-control': preview.fetched ? 'public, max-age=86400' : 'public, max-age=600' });
    if (cache) context.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: 'preview failed' }, 502);
  }
}
