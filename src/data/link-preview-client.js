// The client end of the link-preview endpoint. One request per URL per
// session: the grid, the reader, and every note that mentions the same link
// share one promise, and a failure is forgotten so the next ask tries again.
//
// Where it asks: production sets VITE_LINK_PREVIEW_URL=/api/link-preview, the
// Cloudflare Pages Function on the app's own origin (functions/api/). Without
// it (local dev) it asks the Bun API server's route. Same pipeline behind
// both; see server/src/link-preview/service.ts.
//
// No credentials are sent: the endpoint needs none, and the refresh cookie has
// no business travelling to a route that fetches strangers' pages.
'use strict';

import { session } from './session.js';

const ENDPOINT = (import.meta.env && import.meta.env.VITE_LINK_PREVIEW_URL) || null;
const memo = new Map();
const settled = new Map(); // url -> preview, once a request has succeeded
const TIMEOUT_MS = 20000; // up to three attempts server-side, 8s each at worst

function endpoint() {
  return ENDPOINT || session.apiBase + '/link-preview';
}

async function request(url) {
  const res = await fetch(endpoint() + '?url=' + encodeURIComponent(url), {
    credentials: 'omit',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    let message = 'preview unavailable';
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  return res.json();
}

export function fetchLinkPreview(url) {
  if (!memo.has(url)) {
    memo.set(url, request(url).then(
      (p) => { settled.set(url, p); return p; },
      (err) => { memo.delete(url); throw err; },
    ));
  }
  return memo.get(url);
}

// The answer, synchronously, if this session already has it. A card that is
// re-created (a note's paragraphs remount after every edit) draws from this at
// once instead of flashing its loading skeleton for a frame.
export function peekLinkPreview(url) {
  return settled.get(url) || null;
}
