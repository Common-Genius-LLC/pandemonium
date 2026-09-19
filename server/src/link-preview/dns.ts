// The system resolver, for the Bun API server only. Kept apart from ssrf.ts
// because node:dns does not exist in a Cloudflare Worker, and the preview core
// has to load in both.

import { lookup as dnsLookup } from 'node:dns/promises';
import type { Lookup } from './ssrf';

// Every address the name resolves to, v4 and v6. `all: true` is the point:
// the check has to see every record the fetch might end up using.
export const systemLookup: NonNullable<Lookup> = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};
