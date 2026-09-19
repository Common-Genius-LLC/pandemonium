// The Cloudflare Pages Function adapter (functions/api/link-preview.ts): what
// it adds on top of the shared service, which is tested on its own. Runs in
// Bun with a fake Cache API; nothing here touches the network.

import { describe, it, expect, afterEach } from 'bun:test';
import { onRequestGet } from '../../functions/api/link-preview';

const call = (qs: string, headers: Record<string, string> = {}) =>
  onRequestGet({
    request: new Request('https://pandemonium.commongenius.in/api/link-preview' + qs, { headers }),
    env: {},
    waitUntil: () => {},
  });

afterEach(() => { delete (globalThis as any).caches; });

describe('Pages Function /api/link-preview', () => {
  it('refuses browsers on other sites, so it is not a free unfurl API', async () => {
    const res = await call('?url=https://ogp.me/', { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
  });
  it('serves the app itself, and clients that send no fetch metadata', async () => {
    expect((await call('', { 'sec-fetch-site': 'same-origin' })).status).toBe(400);
    expect((await call('')).status).toBe(400);
  });
  it('rejects a missing, oversized or non-web URL before any fetch', async () => {
    expect(await (await call('')).json()).toEqual({ error: 'missing url' });
    expect((await call('?url=https://a.example/' + 'x'.repeat(3000))).status).toBe(400);
    const ftp = await call('?url=' + encodeURIComponent('ftp://example.com/'));
    expect(ftp.status).toBe(400);
  });
  it('refuses private addresses at the edge too', async () => {
    for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/', 'http://localhost/', 'http://[::1]/']) {
      const res = await call('?url=' + encodeURIComponent(u));
      expect([u, res.status]).toEqual([u, 400]);
    }
  });
  it('answers from the edge cache without fetching, keyed without the fragment', async () => {
    const seen: string[] = [];
    (globalThis as any).caches = {
      default: {
        match: async (req: Request) => { seen.push(req.url); return new Response('{"cached":true}', { headers: { 'content-type': 'application/json' } }); },
        put: async () => {},
      },
    };
    const res = await call('?url=' + encodeURIComponent('https://example.com/page#section'));
    expect(await res.json()).toEqual({ cached: true });
    expect(seen).toEqual(['https://link-preview.cache/?url=' + encodeURIComponent('https://example.com/page')]);
  });
});
