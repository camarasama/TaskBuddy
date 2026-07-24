/**
 * FR-18 — the two halves of webhook delivery that carry real risk.
 *
 * The SSRF guard is the security boundary: a family types the URL, but the *server* makes the
 * request, so a missed private range turns the feature into an authenticated request generator
 * aimed at the VPS's own network. The delivery loop is the reliability boundary: it must not follow
 * redirects (the classic guard bypass), must not retry a rejection forever, and must switch off an
 * endpoint that has stopped answering.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    webhookSubscription: {
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import {
  assertPublicHost,
  assertSafeWebhookUrl,
  isPrivateAddress,
  UnsafeUrlError,
} from '../src/utils/ssrf';
import { WebhookService } from '../src/services/WebhookService';
import { prisma } from '../src/services/database';

const update = prisma.webhookSubscription.update as jest.Mock;
const findUnique = prisma.webhookSubscription.findUnique as jest.Mock;

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1', // multicast
  ])('rejects %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111'])(
    'allows %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  );

  it.each(['::1', '::', 'fc00::1', 'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1'])(
    'rejects IPv6 %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  );

  it('judges an IPv4-mapped IPv6 address on its embedded v4 address', () => {
    // ::ffff:127.0.0.1 reaches loopback; treating it as "just an IPv6 address" walks it straight
    // through every v4 range check.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('64:ff9b::10.0.0.1')).toBe(true); // NAT64
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('rejects anything that is not an IP rather than guessing', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});

describe('assertSafeWebhookUrl', () => {
  it('accepts a normal https endpoint', () => {
    expect(() => assertSafeWebhookUrl('https://hooks.zapier.com/hooks/catch/1/abc')).not.toThrow();
    expect(() => assertSafeWebhookUrl('https://example.com:443/hook')).not.toThrow();
  });

  it.each([
    ['http://example.com/hook', 'plain http'],
    ['ftp://example.com/hook', 'a non-http scheme'],
    ['https://user:pass@example.com/hook', 'embedded credentials'],
    ['https://example.com:5432/hook', 'a non-https port'],
    ['https://127.0.0.1/hook', 'a loopback literal'],
    ['https://169.254.169.254/latest/meta-data', 'the metadata address'],
    ['https://localhost/hook', 'localhost'],
    ['https://api.localhost/hook', 'a .localhost name'],
    ['https://backend/hook', 'a single-label internal name'],
    ['not a url', 'garbage'],
  ])('rejects %s (%s)', (url) => {
    expect(() => assertSafeWebhookUrl(url)).toThrow(UnsafeUrlError);
  });
});

describe('assertPublicHost', () => {
  it('passes a public IP literal without a DNS lookup', async () => {
    await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
  });

  it('rejects a private IP literal', async () => {
    await expect(assertPublicHost('10.0.0.1')).rejects.toThrow(UnsafeUrlError);
  });
});

describe('WebhookService.sign', () => {
  it('signs timestamp and body together so a captured delivery cannot be replayed', () => {
    const body = '{"event":"ping"}';
    const a = WebhookService.sign('whsec_test', 1_700_000_000, body);
    const b = WebhookService.sign('whsec_test', 1_700_000_001, body);

    expect(a).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(a).not.toBe(b); // same body, different timestamp → different signature
  });

  it('is stable for the same inputs and changes with the secret', () => {
    const sig = WebhookService.sign('whsec_a', 1_700_000_000, 'x');
    expect(WebhookService.sign('whsec_a', 1_700_000_000, 'x')).toBe(sig);
    expect(WebhookService.sign('whsec_b', 1_700_000_000, 'x')).not.toBe(sig);
  });
});

describe('WebhookService.deliver', () => {
  const secretPlain = 'whsec_deadbeef';
  const subscription = () => ({
    id: 'wh1',
    url: 'https://hooks.example.com/catch',
    secret: WebhookService.encryptSecret(secretPlain),
  });

  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    update.mockResolvedValue({});
    findUnique.mockResolvedValue({ consecutiveFailures: 0 });
    // The delivery path re-resolves the hostname on every attempt; the guard itself is covered
    // above, so here it is stubbed to keep the suite off the network.
    jest.spyOn(require('../src/utils/ssrf'), 'assertPublicHost').mockResolvedValue(undefined);
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('POSTs a signed payload the receiver can verify', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const result = await WebhookService.deliver(subscription(), 'task.approved', { taskId: 't1' });

    expect(result).toEqual({ delivered: true, status: 200 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/catch');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual'); // a followed redirect would bypass the SSRF check

    // Recompute the signature the way a receiver would: HMAC over `timestamp.body`.
    const timestamp = Number(init.headers['X-TaskBuddy-Timestamp']);
    expect(init.headers['X-TaskBuddy-Signature']).toBe(
      WebhookService.sign(secretPlain, timestamp, init.body)
    );
    expect(init.headers['X-TaskBuddy-Event']).toBe('task.approved');
    expect(JSON.parse(init.body)).toEqual({
      event: 'task.approved',
      timestamp,
      data: { taskId: 't1' },
    });
  });

  it('refuses a redirect instead of following it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 302 });

    const result = await WebhookService.deliver(subscription(), 'ping', {});

    expect(result.delivered).toBe(false);
    expect(result.error).toMatch(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); // a redirect is not retried
  });

  it('does not retry a 4xx — the receiver has said no', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 410 });

    const result = await WebhookService.deliver(subscription(), 'ping', {});

    expect(result).toMatchObject({ delivered: false, status: 410 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx up to the attempt limit', async () => {
    jest.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const pending = WebhookService.deliver(subscription(), 'ping', {});
    await jest.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(result.delivered).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops retrying once a retry succeeds', async () => {
    jest.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    const pending = WebhookService.deliver(subscription(), 'ping', {});
    await jest.advanceTimersByTimeAsync(30_000);

    expect((await pending).delivered).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports an unreachable endpoint without throwing into the caller', async () => {
    jest.useFakeTimers();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const pending = WebhookService.deliver(subscription(), 'ping', {});
    await jest.advanceTimersByTimeAsync(30_000);

    expect(await pending).toMatchObject({ delivered: false, error: expect.any(String) });
  });

  it('refuses to send when the endpoint now resolves to a private address', async () => {
    jest
      .spyOn(require('../src/utils/ssrf'), 'assertPublicHost')
      .mockRejectedValue(new UnsafeUrlError('Endpoint resolves to a private address.'));
    jest.useFakeTimers();

    const pending = WebhookService.deliver(subscription(), 'ping', {});
    await jest.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(result.delivered).toBe(false);
    expect(result.error).toMatch(/private address/);
    expect(fetchMock).not.toHaveBeenCalled(); // never even attempted
  });

  it('clears the failure counter after a success', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await WebhookService.deliver(subscription(), 'ping', {});

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wh1' },
        data: expect.objectContaining({ consecutiveFailures: 0, lastError: null }),
      })
    );
  });

  it('disables a subscription that has failed too many times', async () => {
    findUnique.mockResolvedValue({ consecutiveFailures: 9 }); // this failure is the 10th
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    await WebhookService.deliver(subscription(), 'ping', {});

    const data = update.mock.calls[0][0].data;
    expect(data.consecutiveFailures).toBe(10);
    expect(data.isActive).toBe(false);
    expect(data.disabledAt).toBeInstanceOf(Date);
  });

  it('keeps a subscription alive below the failure limit', async () => {
    findUnique.mockResolvedValue({ consecutiveFailures: 3 });
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    await WebhookService.deliver(subscription(), 'ping', {});

    const data = update.mock.calls[0][0].data;
    expect(data.consecutiveFailures).toBe(4);
    expect(data.isActive).toBeUndefined();
  });

  it('gives up immediately when the stored secret cannot be decrypted', async () => {
    const result = await WebhookService.deliver(
      { id: 'wh1', url: 'https://hooks.example.com/catch', secret: 'not-encrypted' },
      'ping',
      {}
    );

    expect(result.delivered).toBe(false);
    // No signature is possible, so sending would only produce a delivery the receiver must reject.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WebhookService.dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    update.mockResolvedValue({});
    findUnique.mockResolvedValue({ consecutiveFailures: 0 });
    jest.spyOn(require('../src/utils/ssrf'), 'assertPublicHost').mockResolvedValue(undefined);
    (global as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => jest.restoreAllMocks());

  it('only queries active subscriptions for the event and family', async () => {
    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValue([]);

    await WebhookService.dispatch('fam1', 'task.approved', {});

    expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId: 'fam1', isActive: true, events: { has: 'task.approved' } },
      })
    );
  });

  it('fans out to every matching subscription', async () => {
    const secret = WebhookService.encryptSecret('whsec_x');
    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValue([
      { id: 'a', url: 'https://a.example.com/h', secret },
      { id: 'b', url: 'https://b.example.com/h', secret },
    ]);

    await WebhookService.dispatch('fam1', 'reward.redeemed', { rewardId: 'r1' });

    expect((global as unknown as { fetch: jest.Mock }).fetch).toHaveBeenCalledTimes(2);
  });
});
