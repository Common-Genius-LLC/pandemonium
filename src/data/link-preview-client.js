// The client end of GET /v1/link-preview. One request per URL per session:
// the grid, the reader and anything else asking about the same link share the
// same promise, and a failure is forgotten so the next ask tries again.
//
// No credentials are sent. The endpoint is public by design and needs none,
// and the refresh cookie has no business travelling to a route that fetches
// strangers' pages.
'use strict';

import { session } from './session.js';

const memo = new Map();
const TIMEOUT_MS = 12000; // the server gives up at 8s per attempt; this is the backstop

async function request(url) {
  const res = await fetch(session.apiBase + '/link-preview?url=' + encodeURIComponent(url), {
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
    memo.set(url, request(url).catch((err) => { memo.delete(url); throw err; }));
  }
  return memo.get(url);
}
