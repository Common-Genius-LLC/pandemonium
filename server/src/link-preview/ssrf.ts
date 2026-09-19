// SSRF guard for the link-preview fetcher.
//
// /v1/link-preview is a public endpoint that makes this server fetch whatever
// URL it is handed. Without this file that is a way to make the server read
// its own internals and hand the result back: most sharply the cloud-metadata
// service at 169.254.169.254, which Oracle Cloud exposes to every instance and
// which can hold instance credentials, but also localhost (the API's own
// Postgres, other services on the shared host) and anything on the private
// network.
//
// The rule is simple and applied to EVERY hop, not just the first URL, because
// the classic bypass is a public page that 302s to an internal address:
//
//   1. http or https only, no credentials in the URL, web ports only;
//   2. resolve the hostname and refuse if ANY address it resolves to is not a
//      public unicast address (all of them, because a hostname with one public
//      and one private record lets the client pick the private one).
//
// Residual risk, stated plainly (in Bun; see Lookup for Workers): DNS rebinding. We resolve, check, and then
// fetch() resolves again, so a hostile DNS server answering with a very short
// TTL could return a public address to the check and a private one to the
// fetch. Closing that fully needs the fetch to connect to the checked address,
// which Bun's fetch does not expose. The backstop is at the network layer: an
// egress rule on the host denying the API container 169.254.0.0/16 and the
// private ranges (see docs/DEPLOYMENT.md). This file is the first line, not
// the only one.

import { HttpError } from '../errors';
import { ipVersion, isPublicAddress } from './ip';

export { isPublicAddress };

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

// Resolves a hostname to every address it has. `null` means the runtime does
// the refusing itself: a Cloudflare Worker cannot open a connection to a
// private or reserved address at all (the edge answers error 1000 for a name
// that resolves to one), and it has no metadata service or private network of
// ours to reach, so there is nothing for a DNS pre-check to add there. In Bun
// the check is real and required; see dns.ts.
export type Lookup = ((hostname: string) => Promise<string[]>) | null;

// ---- URL checks ----

// Parses and checks everything about a URL that can be checked without DNS.
// Throws a 400 HttpError whose message is safe to show the client.
export function parseFetchableUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new HttpError(400, 'not a valid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'only http and https links can be previewed');
  if (u.username || u.password) throw new HttpError(400, 'links with credentials in them are not fetched');
  if (!ALLOWED_PORTS.has(u.port)) throw new HttpError(400, 'only standard web ports are fetched');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new HttpError(400, 'not a valid URL');
  // "localhost" and friends resolve through /etc/hosts, which a DNS-based
  // check would see, but refusing them by name costs nothing and reads plainly.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new HttpError(400, 'that address is not on the public internet');
  }
  return u;
}

// The full check for one hop: static rules, then every resolved address.
// An IP literal is always judged here, lookup or not.
export async function assertPublicUrl(raw: string, lookup: Lookup): Promise<URL> {
  const u = parseFetchableUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (ipVersion(host)) {
    addresses = [host];
  } else if (lookup === null) {
    return u;
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new HttpError(400, 'that site could not be found');
    }
  }
  if (!addresses.length) throw new HttpError(400, 'that site could not be found');
  if (!addresses.every(isPublicAddress)) throw new HttpError(400, 'that address is not on the public internet');
  return u;
}
