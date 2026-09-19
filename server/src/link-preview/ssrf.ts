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
// Residual risk, stated plainly: DNS rebinding. We resolve, check, and then
// fetch() resolves again, so a hostile DNS server answering with a very short
// TTL could return a public address to the check and a private one to the
// fetch. Closing that fully needs the fetch to connect to the checked address,
// which Bun's fetch does not expose. The backstop is at the network layer: an
// egress rule on the host denying the API container 169.254.0.0/16 and the
// private ranges (see docs/DEPLOYMENT.md). This file is the first line, not
// the only one.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError } from '../errors';

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

export type Lookup = (hostname: string) => Promise<string[]>;

// Every address the name resolves to, v4 and v6. `all: true` is the point:
// the check has to see every record the fetch might end up using.
export const systemLookup: Lookup = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

// ---- address classification ----

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

// [base, prefix length] for every IPv4 range that is not the public internet.
const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including the 169.254.169.254 metadata service
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation (TEST-NET-1)
  ['192.88.99.0', 24], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation (TEST-NET-2)
  ['203.0.113.0', 24], // documentation (TEST-NET-3)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including 255.255.255.255
];

const V4_BLOCKED_INT = V4_BLOCKED.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net: (v4ToInt(base)! & mask) >>> 0, mask };
});

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n == null) return false;
  return !V4_BLOCKED_INT.some(({ net, mask }) => ((n & mask) >>> 0) === net);
}

// Expands any valid IPv6 text form (including "::" and a trailing dotted v4)
// into eight 16-bit groups.
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const n = v4ToInt(maybeV4);
    if (n == null) return null;
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h ? h.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...new Array(fill).fill(0), ...rest];
  if (groups.length !== 8) return null;
  if (tail.length) { groups[6] = tail[0]; groups[7] = tail[1]; }
  return groups;
}

function isPublicV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return false;
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.every((x) => x === 0)) return false; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1 loopback
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judged by the
  // v4 address inside, or ::ffff:169.254.169.254 walks straight past a v4 check.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicV4(embeddedV4());
  // NAT64 well-known prefix 64:ff9b::/96, same reasoning.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(embeddedV4());
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false; // 100::/64 discard
  if (g[0] === 0x2002) return isPublicV4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPublicV4(ip);
  if (kind === 6) return isPublicV6(ip);
  return false;
}

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
export async function assertPublicUrl(raw: string, lookup: Lookup = systemLookup): Promise<URL> {
  const u = parseFetchableUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
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
