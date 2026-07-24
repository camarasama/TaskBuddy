import dns from 'dns/promises';
import net from 'net';

/**
 * FR-18: SSRF guard for user-supplied webhook URLs.
 *
 * A family can point a webhook anywhere, and the server is the one making the request — so without
 * this, "https://…/hook" is an authenticated request generator aimed at whatever the VPS can reach:
 * the loopback API on :3100, Postgres on :5432, a cloud metadata endpoint. The guard is two-layer:
 *
 *  1. **Shape** (`assertSafeWebhookUrl`) — https only, no embedded credentials, no non-standard
 *     port, and no literal private address. Runs when the subscription is saved, so a bad URL is
 *     rejected with a clear message rather than failing silently at 2am.
 *  2. **Resolution** (`assertPublicHost`) — every A/AAAA record the hostname resolves to must be a
 *     public address. Runs again immediately before each delivery, because DNS answers change.
 *
 * Residual risk: a DNS rebind can still flip the answer between our check and Node's connect. Fully
 * closing that needs a pinned-IP connect with a Host override, which `fetch` does not expose. The
 * window is milliseconds and the delivery follows no redirects, so the payoff for an attacker is a
 * single blind POST — accepted, and recorded here rather than left implicit.
 */

/** Ports a webhook receiver legitimately listens on. Anything else is a port scan in disguise. */
const ALLOWED_PORTS = new Set(['', '443']);

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

/** RFC 1918 + loopback + link-local + CGNAT + the IANA special-purpose and reserved blocks. */
const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16', // cloud metadata lives here
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, incl. 255.255.255.255
];

export function isPrivateAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return BLOCKED_V4.some((cidr) => inCidr(ip, cidr));
  if (version !== 6) return true; // not an IP at all → refuse rather than guess

  const addr = ip.toLowerCase().split('%')[0]; // strip any zone id
  if (addr === '::' || addr === '::1') return true;

  // IPv4-mapped (::ffff:1.2.3.4) and NAT64 (64:ff9b::1.2.3.4) carry a v4 address that must be
  // judged on its own merits — otherwise ::ffff:127.0.0.1 walks straight through.
  const embedded = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded) return isPrivateAddress(embedded[1]);

  const head = parseInt(addr.split(':')[0] || '0', 16);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (addr.startsWith('2001:db8:')) return true; // documentation range

  return false;
}

/**
 * Validate the shape of a webhook URL. Throws `UnsafeUrlError` with a message safe to show the
 * parent who typed it.
 */
export function assertSafeWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Enter a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError('Webhook URLs must use https.');
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('Webhook URLs must not contain a username or password.');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError('Webhook URLs must use the default https port.');
  }
  // A literal private IP is rejected here without a DNS lookup — no point resolving 127.0.0.1.
  if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    throw new UnsafeUrlError('That address is not reachable from the internet.');
  }
  // `localhost` and bare single-label names (`db`, `backend`) resolve to internal hosts on many
  // networks and never to a real webhook receiver.
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
    throw new UnsafeUrlError('That address is not reachable from the internet.');
  }

  return url;
}

/**
 * Resolve `hostname` and confirm every answer is a public address. Called immediately before each
 * delivery, so a hostname that later starts resolving to 127.0.0.1 stops being delivered to.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UnsafeUrlError('Endpoint resolves to a private address.');
    return;
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    throw new UnsafeUrlError('Endpoint hostname could not be resolved.');
  }

  if (addresses.length === 0) throw new UnsafeUrlError('Endpoint hostname could not be resolved.');
  // Every answer must be public: a round-robin that mixes one internal address with public ones
  // would otherwise be exploitable by retrying until the internal address is picked.
  if (addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError('Endpoint resolves to a private address.');
  }
}
