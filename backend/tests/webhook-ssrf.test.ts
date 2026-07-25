/**
 * FR-18 — SSRF policy for outbound webhooks.
 *
 * The server POSTs to a URL an end user typed, so this guard is the security core of the feature.
 * Policy: https:// only, and every address the host resolves to must be public unicast.
 */

jest.mock('../src/services/database', () => ({ prisma: {} }));
jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

import dns from 'dns/promises';
import { assertSafeWebhookUrl, ipRejectReason, WebhookUrlError } from '../src/services/WebhookService';

const lookup = dns.lookup as unknown as jest.Mock;

/** Make the hostname resolve to whatever a test wants (the rebinding lever). */
function resolvesTo(...addresses: string[]): void {
  lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

beforeEach(() => {
  jest.clearAllMocks();
  resolvesTo('93.184.216.34'); // a public address by default
});

async function reject(url: string): Promise<string> {
  await expect(assertSafeWebhookUrl(url)).rejects.toBeInstanceOf(WebhookUrlError);
  try {
    await assertSafeWebhookUrl(url);
    throw new Error('expected rejection');
  } catch (err) {
    return (err as Error).message;
  }
}

describe('scheme and URL shape', () => {
  it.each([
    'http://example.com/hook',
    'ftp://example.com/hook',
    'file:///etc/passwd',
    'gopher://example.com/',
    'ws://example.com/',
  ])('rejects %s', async (url) => {
    await expect(assertSafeWebhookUrl(url)).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it('rejects embedded credentials (they leak to the endpoint and confuse parsers)', async () => {
    expect(await reject('https://user:pass@example.com/hook')).toMatch(/credentials/i);
  });

  it('rejects a string that is not a URL at all', async () => {
    await expect(assertSafeWebhookUrl('not a url')).rejects.toBeInstanceOf(WebhookUrlError);
  });

  it('accepts a plain public https endpoint', async () => {
    const { url, addresses } = await assertSafeWebhookUrl('https://hooks.example.com/taskbuddy');
    expect(url.protocol).toBe('https:');
    expect(addresses).toEqual(['93.184.216.34']);
  });

  it('accepts a non-default port on a public host (only public targets are reachable anyway)', async () => {
    await expect(assertSafeWebhookUrl('https://hooks.example.com:5678/webhook')).resolves.toBeTruthy();
  });
});

describe('IPv4 literals', () => {
  const blocked: Array<[string, RegExp]> = [
    ['127.0.0.1', /loopback/],
    ['127.1.2.3', /loopback/],
    ['0.0.0.0', /this-network/],
    ['10.0.0.1', /private/],
    ['10.255.255.254', /private/],
    ['172.16.0.1', /private/],
    ['172.31.255.254', /private/],
    ['192.168.1.1', /private/],
    ['169.254.169.254', /link-local|metadata/], // AWS/GCP/Azure instance metadata
    ['169.254.0.1', /link-local|metadata/],
    ['100.64.0.1', /carrier-grade NAT/],
    ['192.0.0.1', /IETF/],
    ['192.0.2.5', /documentation/],
    ['198.18.0.1', /benchmarking/],
    ['198.51.100.7', /documentation/],
    ['203.0.113.9', /documentation/],
    ['224.0.0.1', /multicast/],
    ['239.1.2.3', /multicast/],
    ['240.0.0.1', /reserved/],
    ['255.255.255.255', /reserved/],
  ];

  it.each(blocked)('rejects the literal %s', async (ip, pattern) => {
    expect(await reject(`https://${ip}/hook`)).toMatch(pattern);
    expect(lookup).not.toHaveBeenCalled(); // literals never touch DNS
  });

  it.each(['172.15.0.1', '172.32.0.1', '11.0.0.1', '9.255.255.255', '100.63.255.255', '100.128.0.1'])(
    'accepts the just-outside-the-range literal %s',
    async (ip) => {
      await expect(assertSafeWebhookUrl(`https://${ip}/hook`)).resolves.toBeTruthy();
    },
  );
});

describe('IPv6 literals', () => {
  const blocked: Array<[string, RegExp]> = [
    ['::1', /loopback/],
    ['::', /unspecified/],
    ['fe80::1', /link-local/],
    ['febf::1', /link-local/],
    ['fc00::1', /unique-local/],
    ['fd12:3456:789a::1', /unique-local/],
    ['ff02::1', /multicast/],
    ['::ffff:127.0.0.1', /IPv4-mapped.*loopback/],
    ['::ffff:169.254.169.254', /IPv4-mapped.*(link-local|metadata)/],
    ['::ffff:10.0.0.1', /IPv4-mapped.*private/],
    ['::ffff:7f00:1', /IPv4-mapped.*loopback/], // same address written in hex
    ['::127.0.0.1', /IPv4-compatible|reserved/],
    ['64:ff9b::7f00:1', /NAT64/],
    ['100::1', /discard-only/],
    ['2001:db8::1', /documentation/],
    ['2001::1', /Teredo|IETF/],
    ['2002:7f00:1::1', /6to4/],
    ['3fff::1', /documentation/],
    ['4000::1', /outside global unicast/],
    ['::ffff:0.0.0.0', /IPv4-mapped.*this-network/],
  ];

  it.each(blocked)('rejects the literal [%s]', async (ip, pattern) => {
    expect(await reject(`https://[${ip}]/hook`)).toMatch(pattern);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['2606:4700:4700::1111', '2a00:1450:4001:81b::200e'])('accepts the public literal [%s]', async (ip) => {
    await expect(assertSafeWebhookUrl(`https://[${ip}]/hook`)).resolves.toBeTruthy();
  });

  it('strips a zone id before classifying (fe80::1%25eth0 is still link-local)', () => {
    expect(ipRejectReason('fe80::1%eth0')).toMatch(/link-local/);
  });
});

describe('hostname resolution', () => {
  it('rejects a hostname that resolves to loopback (the localhost case)', async () => {
    resolvesTo('127.0.0.1');
    expect(await reject('https://localhost.example.com/hook')).toMatch(/loopback/);
  });

  it('rejects a hostname that resolves to the cloud metadata address', async () => {
    resolvesTo('169.254.169.254');
    expect(await reject('https://metadata.attacker.test/hook')).toMatch(/link-local|metadata/);
  });

  it('rejects when ANY of several answers is internal, not just the first', async () => {
    resolvesTo('93.184.216.34', '10.1.2.3');
    expect(await reject('https://split-horizon.test/hook')).toMatch(/private/);
  });

  it('rejects an internal AAAA answer alongside a public A answer', async () => {
    resolvesTo('93.184.216.34', 'fd00::1');
    expect(await reject('https://dual-stack.test/hook')).toMatch(/unique-local/);
  });

  it('rejects an unresolvable hostname', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await reject('https://nope.invalid/hook')).toMatch(/Could not resolve/);
  });

  it('rejects a hostname that resolves to nothing', async () => {
    lookup.mockResolvedValue([]);
    expect(await reject('https://empty.test/hook')).toMatch(/does not resolve/);
  });

  // Parser-confusion forms (octal / decimal / short-form IPv4) are not valid literals, so they fall
  // through to DNS — where the resolver's inet_aton semantics turn them back into 127.0.0.1. The
  // guard checks the RESOLVED address, so the bypass closes there rather than in the parser.
  it.each(['0177.0.0.1', '2130706433', '127.1'])('rejects the parser-confusion form %s', async (host) => {
    resolvesTo('127.0.0.1');
    expect(await reject(`https://${host}/hook`)).toMatch(/loopback/);
  });
});

describe('DNS rebinding', () => {
  it('re-resolves on every call, so a host that turns internal later is refused', async () => {
    resolvesTo('93.184.216.34');
    await expect(assertSafeWebhookUrl('https://rebind.test/hook')).resolves.toBeTruthy();

    resolvesTo('127.0.0.1'); // same URL, attacker flipped the record
    expect(await reject('https://rebind.test/hook')).toMatch(/loopback/);
  });
});
