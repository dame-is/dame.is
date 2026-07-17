// Shared SSRF guard for the owner-facing fetch proxies (`api/unfurl.js`,
// `api/image-proxy.js`). Both take a caller-supplied `?url=` and fetch it
// server-side, so a naive `^https?://` gate lets a caller point them at
// loopback / RFC-1918 / link-local / cloud-metadata hosts and read internal
// responses (or launder bandwidth). This module resolves the hostname to its
// actual IP(s) and refuses anything that lands in a non-public range.
//
// Usage: call `assertPublicHttpUrl(url)` BEFORE the first fetch and again on
// every redirect `Location` (the proxies follow redirects manually so each hop
// is re-validated) — DNS can rebind and a redirect can jump to an internal host.

import { promises as dns } from 'node:dns';

/** IPv4 dotted-quad → true if it falls in a private / reserved / non-routable range. */
function isPrivateV4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return true; // malformed → fail closed
  const [a, b] = parts.map((p) => Number(p));
  if (![a, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return true;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

/** Numeric value of the first 16-bit group of an IPv6 address (handles a leading `::`). */
function firstHextet(addr) {
  if (addr.startsWith('::')) return 0;
  const g = addr.split(':')[0];
  if (!g) return 0;
  const v = parseInt(g, 16);
  return Number.isNaN(v) ? 0 : v;
}

/** IPv6 string → true if loopback / unspecified / ULA / link-local / IPv4-mapped-private. */
function isPrivateV6(addr) {
  if (addr === '::1' || addr === '::') return true; // loopback / unspecified
  // IPv4-mapped forms: ::ffff:1.2.3.4  and  ::ffff:xxxx:xxxx
  const dotted = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dotted) return isPrivateV4(dotted[1]);
  const hexMapped = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    const v4 = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    return isPrivateV4(v4);
  }
  const head = firstHextet(addr);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/** True if `ip` (v4 or v6 string) is loopback/private/link-local/reserved. Fails closed. */
export function isPrivateIp(ip) {
  if (typeof ip !== 'string' || !ip) return true;
  let addr = ip.trim().toLowerCase();
  const zone = addr.indexOf('%'); // strip IPv6 zone id
  if (zone !== -1) addr = addr.slice(0, zone);
  if (addr.includes(':')) return isPrivateV6(addr);
  return isPrivateV4(addr);
}

/**
 * Assert `rawUrl` is a public http(s) URL: reject non-http(s), resolve the
 * hostname via DNS, and reject if ANY resolved address is non-public. Throws an
 * Error on rejection; returns the parsed `URL` on success.
 */
export async function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.');
  }
  // URL.hostname keeps IPv6 literals bracketed; strip them for DNS/IP checks.
  let hostname = parsed.hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }
  if (!hostname) {
    throw new Error('URL has no host.');
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error('Could not resolve host.');
  }
  if (!addresses || addresses.length === 0) {
    throw new Error('Host did not resolve.');
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error('Refusing to fetch a private, loopback, or link-local address.');
    }
  }
  return parsed;
}
