// Fetch, cache and parse one URL into a LinkPreview.
//
// Every dependency that touches the outside world (fetch, DNS, the clock) is
// injectable, so the whole pipeline, redirects and blocks and timeouts
// included, is tested without the network (test/link-preview.test.ts). The
// live checks against real sites are a separate script
// (scripts/validate-link-preview.ts), because a test suite that fails when
// Amazon has a bad day is not a test suite.

import { HttpError } from '../errors';
import { assertPublicUrl, parseFetchableUrl, systemLookup, type Lookup } from './ssrf';
import { buildPreview, decodeBody, extractMeta, urlOnlyPreview, type LinkPreview } from './parse';

// Two user agents, tried in this order, because no single one works
// everywhere and the live check proved it (scripts/validate-link-preview.ts):
//
//   1. A desktop Chrome on Windows. Many sites answer an unknown or library
//      user agent with an instant 403; they answer a browser with the page.
//
//   2. Our own bot, named honestly. App-like sites do the reverse: Spotify
//      answers Chrome with a JavaScript shell carrying no metadata at all, and
//      Amazon answers it with a 202 and an empty body (a bot challenge that
//      needs a real browser to pass). Both serve their full OG card to a
//      self-identified link-preview bot. It is our own name, not Facebook's or
//      Slack's: impersonating a specific company's crawler would work too,
//      but some sites verify those by IP, and it is not ours to wear.
//      Note that it must NOT start with "Mozilla/5.0 (compatible; ...)":
//      Amazon challenges anything that begins like a browser.
//
// The second is only tried when the first comes back with nothing worth
// showing (see isThin), so a well-behaved site costs one request. Both are
// overridable from the environment, because a browser UA string ages.
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const DEFAULT_BOT_USER_AGENT = 'PandemoniumBot/1.0 (+https://pandemonium.commongenius.in)';

export const LIMITS = {
  timeoutMs: 8000, // the whole fetch, every hop and the body included
  maxRedirects: 5,
  maxBodyBytes: 1_000_000, // metadata lives in <head>; 1 MB covers even YouTube's page
  successTtlMs: 24 * 60 * 60 * 1000,
  // Failures are cached too, so a blocked site is not hammered by every
  // viewer, but only briefly: a block or an outage is often temporary, and a
  // day of plain links for a site that recovered in a minute is the wrong trade.
  failureTtlMs: 10 * 60 * 1000,
  maxCacheEntries: 5000,
  maxConcurrent: 8, // upstream fetches in flight at once, across all clients
  maxQueued: 64, // waiting beyond that is refused rather than queued forever
};

// Only the call shape this file uses, so a test can hand in a plain function
// (Bun's own fetch type also carries extras like preconnect).
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface PreviewDeps {
  fetch: FetchFn;
  lookup: Lookup;
  now: () => number;
  userAgent: string;
  botUserAgent: string;
}

// A result with nothing a card could use beyond the URL: the page was not
// read, or it was read and carried no OG or Twitter metadata and no image.
// That is what a bot wall or a JavaScript-only shell looks like from here.
export function isThin(p: LinkPreview): boolean {
  if (!p.fetched) return true;
  const tagged = p.sources.title === 'og' || p.sources.title === 'twitter';
  return !tagged && !p.image;
}

// How much a result has to show, for choosing between the two attempts.
function richness(p: LinkPreview): number {
  const title = p.sources.title === 'og' || p.sources.title === 'twitter' ? 3 : p.sources.title === 'html' ? 1 : 0;
  return title + (p.image ? 3 : 0) + (p.description ? 1 : 0) + (p.fetched ? 1 : 0);
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;
const IMAGE_TYPES = /^image\//i;

// Reads at most `max` bytes and then stops, so a multi-gigabyte response (or
// one that never ends) costs one megabyte and not the server.
async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(Math.min(total, max));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, out.byteLength - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.byteLength) break;
  }
  return out;
}

function discard(res: Response) {
  if (res.body) res.body.cancel().catch(() => {});
}

// A counting gate for upstream fetches. Past maxQueued it refuses outright:
// a public endpoint must not let a burst of requests pile up unbounded work.
function createGate(max: number, maxQueued: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      if (queue.length >= maxQueued) throw new HttpError(503, 'link previews are busy, try again shortly');
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

export function createPreviewService(partial: Partial<PreviewDeps> = {}, limits = LIMITS) {
  const deps: PreviewDeps = {
    fetch: partial.fetch || ((url, init) => fetch(url, init)),
    lookup: partial.lookup || systemLookup,
    now: partial.now || Date.now,
    userAgent: partial.userAgent || DEFAULT_USER_AGENT,
    botUserAgent: partial.botUserAgent || DEFAULT_BOT_USER_AGENT,
  };
  const cache = new Map<string, { value: LinkPreview; expires: number }>();
  const inflight = new Map<string, Promise<LinkPreview>>();
  const gate = createGate(limits.maxConcurrent, limits.maxQueued);

  const headersFor = (userAgent: string) => ({
    'User-Agent': userAgent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  });

  // Browser first; the honest bot only when the browser got nothing usable.
  async function fetchPreview(requested: string): Promise<LinkPreview> {
    const first = await fetchOnce(requested, deps.userAgent);
    if (!isThin(first)) return first;
    const second = await fetchOnce(requested, deps.botUserAgent);
    return richness(second) > richness(first) ? second : first;
  }

  // Redirects are followed by hand, never by fetch itself, so that every hop's
  // destination goes through the SSRF check before it is requested.
  async function fetchOnce(requested: string, userAgent: string): Promise<LinkPreview> {
    const headers = headersFor(userAgent);
    // Checked before anything else starts, so a refused URL is a clean 400
    // and leaves no timer behind.
    let current = await assertPublicUrl(requested, deps.lookup);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), limits.timeoutMs);
    try {
      let res: Response | null = null;
      for (let hop = 0; ; hop++) {
        res = await deps.fetch(current.href, { redirect: 'manual', headers, signal: ctrl.signal });
        if (!REDIRECT.has(res.status)) break;
        const location = res.headers.get('location');
        discard(res);
        if (!location || hop >= limits.maxRedirects) {
          return urlOnlyPreview(requested, current.href, { status: res.status });
        }
        // A redirect into the private network is refused the same way the
        // first URL would have been; the preview falls back to the URL alone.
        try {
          current = await assertPublicUrl(new URL(location, current).href, deps.lookup);
        } catch {
          return urlOnlyPreview(requested, current.href, { status: res.status });
        }
      }

      const contentType = res.headers.get('content-type');
      // 200, or 203 (a 200 rewritten by a proxy), is a page. Any other 2xx is
      // not: Amazon's bot challenge is a 202 with an empty body, and counting
      // that as a successful read is how a block ends up cached for a day.
      if (res.status !== 200 && res.status !== 203) {
        discard(res);
        return urlOnlyPreview(requested, current.href, { status: res.status, contentType });
      }
      // The link IS an image: it is its own preview. Nothing is read.
      if (contentType && IMAGE_TYPES.test(contentType)) {
        discard(res);
        return {
          ...urlOnlyPreview(requested, current.href, { status: res.status, contentType }),
          image: current.href,
          sources: { title: 'url', description: null, image: 'self' },
          fetched: true,
        };
      }
      // A PDF, a zip, JSON: fetched fine, but there is no markup to read.
      if (!contentType || !HTML_TYPES.test(contentType)) {
        discard(res);
        return { ...urlOnlyPreview(requested, current.href, { status: res.status, contentType }), fetched: true };
      }
      const bytes = await readCapped(res, limits.maxBodyBytes);
      const html = decodeBody(bytes, contentType);
      const raw = await extractMeta(html);
      return buildPreview(raw, { requestedUrl: requested, finalUrl: current.href, status: res.status, contentType });
    } catch (err) {
      // Timeouts, resets, TLS failures, DNS vanishing mid-redirect: the site
      // could not be read, and that is an answer, not a server error.
      if (err instanceof HttpError) throw err;
      return urlOnlyPreview(requested, current.href);
    } finally {
      clearTimeout(timer);
    }
  }

  function remember(key: string, value: LinkPreview) {
    const ttl = value.fetched ? limits.successTtlMs : limits.failureTtlMs;
    cache.delete(key);
    cache.set(key, { value, expires: deps.now() + ttl });
    // Map keeps insertion order, and a hit re-inserts its key (see get), so the
    // first key is always the least recently used one.
    while (cache.size > limits.maxCacheEntries) cache.delete(cache.keys().next().value!);
  }

  return {
    // Resolves to a preview for any well-formed public URL, whether or not the
    // page could be read. Throws a 400 HttpError only for input that must not
    // be fetched at all (bad scheme, private address, credentials...).
    async get(rawUrl: string): Promise<LinkPreview> {
      const parsed = parseFetchableUrl(rawUrl);
      parsed.hash = ''; // a fragment never changes what the server sends
      const key = parsed.href;

      const hit = cache.get(key);
      if (hit && hit.expires > deps.now()) {
        cache.delete(key);
        cache.set(key, hit);
        return hit.value;
      }
      if (hit) cache.delete(key);

      // Two viewers opening the same link at once share one upstream fetch.
      const pending = inflight.get(key);
      if (pending) return pending;
      const job = gate(() => fetchPreview(key))
        .then((value) => { remember(key, value); return value; })
        .finally(() => inflight.delete(key));
      inflight.set(key, job);
      return job;
    },
    size: () => cache.size,
  };
}
