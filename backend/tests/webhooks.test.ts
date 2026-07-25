import crypto from 'crypto';
import request from 'supertest';

/**
 * FR-18 — outbound webhooks: the management API, the signed delivery, the retry/auto-disable
 * lifecycle, and the property that matters most operationally: dispatch is fire-and-forget, so a
 * hanging endpoint can never slow the request that produced the notification.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    webhookSubscription: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    notification: { create: jest.fn() },
    user: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

let CURRENT: { userId: string; role: string; familyId: string };
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual, // requireParent stays REAL - that is what refuses children
    authenticate: (req: any, _res: any, next: any) => { req.user = { ...CURRENT }; next(); },
    familyIsolation: (req: any, _res: any, next: any) => { req.familyId = CURRENT.familyId; next(); },
  };
});

jest.mock('../src/services/SocketService', () => ({
  ...jest.requireActual('../src/services/SocketService'),
  emitNotificationNew: jest.fn(),
}));
jest.mock('../src/services/PushService', () => ({ PushService: { sendPush: jest.fn().mockResolvedValue(undefined) } }));

import dns from 'dns/promises';
import { app } from '../src/index';
import { prisma } from '../src/services/database';
import { createNotification } from '../src/routes/notifications';
import { WebhookService, sealWebhookSecret } from '../src/services/WebhookService';
import { WEBHOOK_EVENTS, WEBHOOK_MAX_CONSECUTIVE_FAILURES } from '@taskbuddy/shared';

const lookup = dns.lookup as unknown as jest.Mock;
const subFindMany = prisma.webhookSubscription.findMany as jest.Mock;
const subFindFirst = prisma.webhookSubscription.findFirst as jest.Mock;
const subCount = prisma.webhookSubscription.count as jest.Mock;
const subCreate = prisma.webhookSubscription.create as jest.Mock;
const subDeleteMany = prisma.webhookSubscription.deleteMany as jest.Mock;
const subUpdate = prisma.webhookSubscription.update as jest.Mock;
const notificationCreate = prisma.notification.create as jest.Mock;
const userFindMany = prisma.user.findMany as jest.Mock;

const SECRET = 'a'.repeat(64);
const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

/** A stored subscription row as dispatch() selects it. */
const storedSub = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'wh1',
  familyId: 'fam1',
  url: 'https://hooks.example.com/taskbuddy',
  secret: sealWebhookSecret(SECRET),
  failureCount: 0,
  recentFailures: [],
  ...over,
});

const okResponse = (status = 200) => ({ status, body: { cancel: async () => undefined } });

beforeEach(() => {
  jest.clearAllMocks();
  CURRENT = { userId: 'par1', role: 'parent', familyId: 'fam1' };
  WebhookService.retryDelaysMs = [1, 1]; // collapse the backoff so tests do not sleep for real
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  subFindMany.mockResolvedValue([]);
  subCount.mockResolvedValue(0);
  subUpdate.mockResolvedValue({});
  userFindMany.mockResolvedValue([]);
  notificationCreate.mockResolvedValue({
    id: 'n1', notificationType: 'task_approved', title: 't', message: 'm',
    referenceType: null, referenceId: null, createdAt: new Date('2026-07-24T10:00:00.000Z'),
  });
  fetchMock.mockResolvedValue(okResponse());
});

// ─── Management API ──────────────────────────────────────────────────────────

describe('GET /webhooks', () => {
  it('lists the family subscriptions and the canonical event list', async () => {
    subFindMany.mockResolvedValue([{ id: 'wh1', url: 'https://hooks.example.com/x', events: ['task_approved'] }]);
    const res = await request(app).get('/api/v1/webhooks');
    expect(res.status).toBe(200);
    expect(res.body.data.availableEvents).toEqual([...WEBHOOK_EVENTS]);
    expect(subFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: 'fam1' } }));
  });

  it('NEVER selects the signing secret', async () => {
    await request(app).get('/api/v1/webhooks');
    const select = subFindMany.mock.calls[0][0].select;
    expect(select.secret).toBeUndefined();
    expect(Object.keys(select)).not.toContain('secret');
  });

  it('refuses a child', async () => {
    CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
    expect((await request(app).get('/api/v1/webhooks')).status).toBe(403);
  });
});

describe('POST /webhooks', () => {
  const body = { url: 'https://hooks.example.com/taskbuddy', events: ['task_approved', 'reward_redeemed'] };

  it('creates a subscription, stores an encrypted secret, and returns the plaintext once', async () => {
    subCreate.mockImplementation(async ({ data }: any) => ({ id: 'wh1', ...data, isActive: true }));
    const res = await request(app).post('/api/v1/webhooks').send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.secret).toMatch(/^[0-9a-f]{64}$/);
    // What lands in the DB is the AES-256-GCM envelope, not the raw secret.
    const stored = subCreate.mock.calls[0][0].data.secret;
    expect(stored).not.toBe(res.body.data.secret);
    expect(stored.split(':')).toHaveLength(3);
    expect(subCreate.mock.calls[0][0].data.familyId).toBe('fam1');
  });

  it('rejects a non-HTTPS URL', async () => {
    const res = await request(app).post('/api/v1/webhooks').send({ ...body, url: 'http://hooks.example.com/x' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/https/i);
    expect(subCreate).not.toHaveBeenCalled();
  });

  it('rejects a URL resolving to a private address at CREATE time', async () => {
    lookup.mockResolvedValue([{ address: '192.168.1.50', family: 4 }]);
    const res = await request(app).post('/api/v1/webhooks').send(body);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/private/);
    expect(subCreate).not.toHaveBeenCalled();
  });

  it('rejects the cloud metadata address as a literal', async () => {
    const res = await request(app).post('/api/v1/webhooks').send({ ...body, url: 'https://169.254.169.254/latest' });
    expect(res.status).toBe(400);
    expect(subCreate).not.toHaveBeenCalled();
  });

  it('rejects an unknown event name', async () => {
    const res = await request(app).post('/api/v1/webhooks').send({ ...body, events: ['not_a_real_event'] });
    expect(res.status).toBe(400);
  });

  it('refuses to subscribe to the auto-disable notice (the dispatch loop guard)', async () => {
    const res = await request(app).post('/api/v1/webhooks').send({ ...body, events: ['webhook_disabled'] });
    expect(res.status).toBe(400);
  });

  it('caps the number of endpoints per family', async () => {
    subCount.mockResolvedValue(10);
    expect((await request(app).post('/api/v1/webhooks').send(body)).status).toBe(409);
  });

  it('refuses a child', async () => {
    CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
    expect((await request(app).post('/api/v1/webhooks').send(body)).status).toBe(403);
  });
});

describe('GET /webhooks/:id/secret', () => {
  it('reveals the decrypted secret to a parent in the owning family', async () => {
    subFindFirst.mockResolvedValue({ id: 'wh1', secret: sealWebhookSecret(SECRET) });
    const res = await request(app).get('/api/v1/webhooks/wh1/secret');
    expect(res.status).toBe(200);
    expect(res.body.data.secret).toBe(SECRET);
  });

  it('scopes the lookup by familyId so family B cannot reveal family A\'s secret', async () => {
    CURRENT = { userId: 'parB', role: 'parent', familyId: 'famB' };
    subFindFirst.mockResolvedValue(null); // the familyId in the WHERE finds nothing
    const res = await request(app).get('/api/v1/webhooks/wh1/secret');
    expect(res.status).toBe(404);
    expect(subFindFirst.mock.calls[0][0].where).toEqual({ id: 'wh1', familyId: 'famB' });
  });

  it('refuses a child', async () => {
    CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
    expect((await request(app).get('/api/v1/webhooks/wh1/secret')).status).toBe(403);
  });
});

describe('DELETE /webhooks/:id', () => {
  it('deletes within the family', async () => {
    subDeleteMany.mockResolvedValue({ count: 1 });
    expect((await request(app).delete('/api/v1/webhooks/wh1')).status).toBe(200);
    expect(subDeleteMany.mock.calls[0][0].where).toEqual({ id: 'wh1', familyId: 'fam1' });
  });

  it('404s (and deletes nothing) for another family\'s subscription id', async () => {
    CURRENT = { userId: 'parB', role: 'parent', familyId: 'famB' };
    subDeleteMany.mockResolvedValue({ count: 0 });
    expect((await request(app).delete('/api/v1/webhooks/wh1')).status).toBe(404);
    expect(subDeleteMany.mock.calls[0][0].where.familyId).toBe('famB');
  });

  it('refuses a child', async () => {
    CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
    expect((await request(app).delete('/api/v1/webhooks/wh1')).status).toBe(403);
  });
});

// ─── Signed delivery ─────────────────────────────────────────────────────────

describe('delivery', () => {
  it('resolves the family from the userId in ONE query and POSTs a signed body', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: { title: 'Nice' } });

    expect(subFindMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      events: { has: 'task_approved' },
      family: { users: { some: { id: 'kid1' } } },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/taskbuddy');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual'); // a 302 to an internal host must never be followed

    // The documented verification recipe, executed.
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(init.body, 'utf8').digest('hex');
    expect(init.headers['X-TaskBuddy-Signature']).toBe(expected);

    const parsed = JSON.parse(init.body);
    expect(parsed.event).toBe('task_approved');
    expect(parsed.familyId).toBe('fam1');
    expect(parsed.data.title).toBe('Nice');
    // Timestamp header mirrors the SIGNED body field, which is the one a receiver must trust.
    expect(init.headers['X-TaskBuddy-Timestamp']).toBe(parsed.timestamp);
    expect(init.headers['X-TaskBuddy-Event']).toBe('task_approved');
    expect(init.headers['X-TaskBuddy-Delivery']).toBe(parsed.id);
  });

  it('signs the EXACT bytes sent - a re-serialised body would not verify', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    await WebhookService.dispatch({ userId: 'kid1', event: 'level_up', payload: { level: 4 } });
    const { body, headers } = fetchMock.mock.calls[0][1];
    const reserialised = JSON.stringify(JSON.parse(body), Object.keys(JSON.parse(body)).sort());
    const wrong = 'sha256=' + crypto.createHmac('sha256', SECRET).update(reserialised, 'utf8').digest('hex');
    expect(headers['X-TaskBuddy-Signature']).not.toBe(wrong);
  });

  it('re-checks SSRF policy at DELIVERY time (DNS rebinding after create)', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]); // the record flipped
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(subUpdate.mock.calls[0][0].data.recentFailures[0].reason).toMatch(/blocked by SSRF policy.*loopback/);
  });

  it('records a 3xx as a failure without following it', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    fetchMock.mockResolvedValue(okResponse(302));
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(subUpdate.mock.calls[0][0].data.recentFailures[0].reason).toMatch(/redirect/);
  });

  it('sends nothing when the family has no subscription for that event', async () => {
    subFindMany.mockResolvedValue([]);
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never dispatches the auto-disable notice, even if a row somehow lists it', async () => {
    await WebhookService.dispatch({ userId: 'par1', event: 'webhook_disabled', payload: {} });
    expect(subFindMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Retry, failure accounting, auto-disable ─────────────────────────────────

describe('retry and auto-disable', () => {
  it('retries a 5xx with backoff and resets the counter once one attempt succeeds', async () => {
    subFindMany.mockResolvedValue([storedSub({ failureCount: 3 })]);
    fetchMock
      .mockResolvedValueOnce(okResponse(503))
      .mockResolvedValueOnce(okResponse(500))
      .mockResolvedValueOnce(okResponse(204));

    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(subUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failureCount: 0 }) }),
    );
  });

  it('retries a network error / timeout', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    fetchMock.mockRejectedValue(new Error('The operation was aborted due to timeout'));
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(subUpdate.mock.calls[0][0].data.recentFailures[0].reason).toMatch(/network error/);
  });

  it('does NOT retry a deliberate 4xx', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    fetchMock.mockResolvedValue(okResponse(403));
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(subUpdate.mock.calls[0][0].data.failureCount).toBe(1);
  });

  it('DOES retry a 429 (rate limited, not a rejection)', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    fetchMock.mockResolvedValue(okResponse(429));
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('keeps a bounded, newest-first list of recent failures', async () => {
    const old = Array.from({ length: 12 }, (_, i) => ({ at: `2026-01-${i + 1}`, event: 'x', reason: 'old' }));
    subFindMany.mockResolvedValue([storedSub({ recentFailures: old })]);
    fetchMock.mockResolvedValue(okResponse(400));
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });

    const list = subUpdate.mock.calls[0][0].data.recentFailures;
    expect(list).toHaveLength(10);
    expect(list[0].reason).toMatch(/HTTP 400/);
  });

  it(`auto-disables after ${WEBHOOK_MAX_CONSECUTIVE_FAILURES} consecutive failures and notifies the parents`, async () => {
    subFindMany.mockResolvedValue([storedSub({ failureCount: WEBHOOK_MAX_CONSECUTIVE_FAILURES - 1 })]);
    fetchMock.mockResolvedValue(okResponse(400));
    userFindMany.mockResolvedValue([{ id: 'par1' }, { id: 'par2' }]);

    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });

    const data = subUpdate.mock.calls[0][0].data;
    expect(data.failureCount).toBe(WEBHOOK_MAX_CONSECUTIVE_FAILURES);
    expect(data.isActive).toBe(false);
    expect(data.disabledAt).toBeInstanceOf(Date);

    // Both parents are told, with the non-subscribable type so this cannot cause another dispatch.
    expect(notificationCreate).toHaveBeenCalledTimes(2);
    const types = notificationCreate.mock.calls.map((c) => c[0].data.notificationType);
    expect(types).toEqual(['webhook_disabled', 'webhook_disabled']);
    expect(WEBHOOK_EVENTS as readonly string[]).not.toContain('webhook_disabled');
  });

  it('does not auto-disable while below the threshold', async () => {
    subFindMany.mockResolvedValue([storedSub({ failureCount: 0 })]);
    fetchMock.mockResolvedValue(okResponse(400));
    await WebhookService.dispatch({ userId: 'kid1', event: 'task_approved', payload: {} });
    expect(subUpdate.mock.calls[0][0].data.isActive).toBeUndefined();
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});

// ─── AC-g: fire-and-forget ───────────────────────────────────────────────────

describe('fire-and-forget', () => {
  it('returns promptly from createNotification even when the endpoint hangs', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    let release: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const started = Date.now();
    await createNotification({
      userId: 'kid1', notificationType: 'task_approved', title: 'Approved', message: 'Nice work',
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(200); // the hanging POST is still in flight
    expect(notificationCreate).toHaveBeenCalledTimes(1); // the real work completed

    release(okResponse()); // let the dangling delivery finish so nothing leaks into the next test
    await new Promise((r) => setImmediate(r));
  });

  it('returns promptly from createNotification even when the endpoint throws', async () => {
    subFindMany.mockResolvedValue([storedSub()]);
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const started = Date.now();
    await createNotification({
      userId: 'kid1', notificationType: 'task_approved', title: 'Approved', message: 'Nice work',
    });
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('still creates the notification when the webhook lookup itself blows up', async () => {
    subFindMany.mockRejectedValue(new Error('DB on fire'));
    await createNotification({
      userId: 'kid1', notificationType: 'task_approved', title: 'Approved', message: 'Nice work',
    });
    expect(notificationCreate).toHaveBeenCalledTimes(1);
  });
});
