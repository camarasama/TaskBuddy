import request from 'supertest';

/**
 * FR-18 — the webhook management API. Pins the three things that would matter if they broke:
 * the signing secret is write-once and never readable, a webhook belongs to exactly one family,
 * and an unsafe URL is refused at the door rather than at delivery time.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    webhookSubscription: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

// Audit writes are asserted elsewhere; here they would just need another prisma table.
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));

let CURRENT: { userId: string; role: string; familyId: string } = {
  userId: 'par1',
  role: 'parent',
  familyId: 'fam1',
};
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { ...CURRENT };
      next();
    },
    familyIsolation: (req: any, _res: any, next: any) => {
      req.familyId = CURRENT.familyId;
      next();
    },
  };
});

import { app } from '../src/index';
import { prisma } from '../src/services/database';
import { WebhookService } from '../src/services/WebhookService';
import { MAX_WEBHOOKS_PER_FAMILY } from '@taskbuddy/shared';

const findMany = prisma.webhookSubscription.findMany as jest.Mock;
const findFirst = prisma.webhookSubscription.findFirst as jest.Mock;
const count = prisma.webhookSubscription.count as jest.Mock;
const create = prisma.webhookSubscription.create as jest.Mock;
const update = prisma.webhookSubscription.update as jest.Mock;
const del = prisma.webhookSubscription.delete as jest.Mock;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'wh1',
  familyId: 'fam1',
  url: 'https://hooks.example.com/catch',
  events: ['task.approved'],
  description: null,
  isActive: true,
  lastDeliveryAt: null,
  lastStatus: null,
  lastError: null,
  consecutiveFailures: 0,
  disabledAt: null,
  createdAt: new Date('2026-07-24T00:00:00Z'),
  updatedAt: new Date('2026-07-24T00:00:00Z'),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  CURRENT = { userId: 'par1', role: 'parent', familyId: 'fam1' };
  count.mockResolvedValue(0);
  findMany.mockResolvedValue([]);
});

describe('GET /webhooks', () => {
  it('lists the family webhooks without ever selecting the secret', async () => {
    findMany.mockResolvedValue([row()]);

    const res = await request(app).get('/api/v1/webhooks');

    expect(res.status).toBe(200);
    expect(res.body.data.webhooks).toHaveLength(1);
    expect(res.body.data.webhooks[0].secret).toBeUndefined();
    // The guarantee is in the query, not just the response: `secret` is not in the projection.
    const select = findMany.mock.calls[0][0].select;
    expect(select.secret).toBeUndefined();
    expect(findMany.mock.calls[0][0].where).toEqual({ familyId: 'fam1' });
  });

  it('refuses a child', async () => {
    CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
    const res = await request(app).get('/api/v1/webhooks');
    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks', () => {
  it('creates a webhook and returns the signing secret exactly once', async () => {
    create.mockImplementation(async ({ data }: any) => row({ url: data.url, events: data.events }));

    const res = await request(app)
      .post('/api/v1/webhooks')
      .send({ url: 'https://hooks.zapier.com/hooks/catch/1/abc', events: ['task.approved'] });

    expect(res.status).toBe(201);
    expect(res.body.data.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(res.body.data.webhook.secret).toBeUndefined();

    // Stored encrypted, never in plaintext: `iv:tag:ciphertext`, and it round-trips to what the
    // parent was shown.
    const stored = create.mock.calls[0][0].data.secret;
    expect(stored).not.toContain(res.body.data.secret);
    expect(stored.split(':')).toHaveLength(3);
    const { decryptSecret } = require('../src/utils/mfa');
    expect(decryptSecret(stored)).toBe(res.body.data.secret);
  });

  it('stamps the creating parent and their family', async () => {
    create.mockResolvedValue(row());

    await request(app)
      .post('/api/v1/webhooks')
      .send({ url: 'https://hooks.example.com/catch', events: ['reward.redeemed'] });

    expect(create.mock.calls[0][0].data).toMatchObject({ familyId: 'fam1', createdBy: 'par1' });
  });

  it.each([
    'http://hooks.example.com/catch',
    'https://127.0.0.1/catch',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/catch',
    'https://user:pw@hooks.example.com/catch',
    'https://hooks.example.com:5432/catch',
  ])('rejects the unsafe URL %s with a 400', async (url) => {
    const res = await request(app).post('/api/v1/webhooks').send({ url, events: ['task.approved'] });

    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an unknown event name', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks')
      .send({ url: 'https://hooks.example.com/catch', events: ['task.deleted'] });

    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('requires at least one event', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks')
      .send({ url: 'https://hooks.example.com/catch', events: [] });

    expect(res.status).toBe(400);
  });

  it('enforces the per-family cap', async () => {
    count.mockResolvedValue(MAX_WEBHOOKS_PER_FAMILY);

    const res = await request(app)
      .post('/api/v1/webhooks')
      .send({ url: 'https://hooks.example.com/catch', events: ['task.approved'] });

    expect(res.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a child', async () => {
    CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
    const res = await request(app)
      .post('/api/v1/webhooks')
      .send({ url: 'https://hooks.example.com/catch', events: ['task.approved'] });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /webhooks/:id', () => {
  it('updates events and url after re-validating the url', async () => {
    findFirst.mockResolvedValue({ id: 'wh1' });
    update.mockResolvedValue(row({ events: ['reward.redeemed'] }));

    const res = await request(app)
      .patch('/api/v1/webhooks/wh1')
      .send({ url: 'https://other.example.com/catch', events: ['reward.redeemed'] });

    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data).toMatchObject({
      url: 'https://other.example.com/catch',
      events: ['reward.redeemed'],
    });
  });

  it('rejects an unsafe url on update too', async () => {
    findFirst.mockResolvedValue({ id: 'wh1' });

    const res = await request(app)
      .patch('/api/v1/webhooks/wh1')
      .send({ url: 'https://10.0.0.5/catch' });

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('clears the failure state when a disabled webhook is re-enabled', async () => {
    findFirst.mockResolvedValue({ id: 'wh1' });
    update.mockResolvedValue(row());

    await request(app).patch('/api/v1/webhooks/wh1').send({ isActive: true });

    // Without this, the next failure would immediately re-trip the auto-disable limit and the
    // parent's fix would look like it did nothing.
    expect(update.mock.calls[0][0].data).toMatchObject({
      isActive: true,
      consecutiveFailures: 0,
      disabledAt: null,
    });
  });

  it('does not reset the counter when merely disabling', async () => {
    findFirst.mockResolvedValue({ id: 'wh1' });
    update.mockResolvedValue(row({ isActive: false }));

    await request(app).patch('/api/v1/webhooks/wh1').send({ isActive: false });

    expect(update.mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it('404s on another family’s webhook (scoped lookup finds nothing)', async () => {
    findFirst.mockResolvedValue(null);

    const res = await request(app).patch('/api/v1/webhooks/wh1').send({ isActive: false });

    expect(res.status).toBe(404);
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'wh1', familyId: 'fam1' });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an empty update', async () => {
    findFirst.mockResolvedValue({ id: 'wh1' });

    const res = await request(app).patch('/api/v1/webhooks/wh1').send({});

    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('DELETE /webhooks/:id', () => {
  it('deletes a webhook in the caller’s family', async () => {
    findFirst.mockResolvedValue({ id: 'wh1', url: 'https://hooks.example.com/catch' });
    del.mockResolvedValue({});

    const res = await request(app).delete('/api/v1/webhooks/wh1');

    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: 'wh1' } });
  });

  it('404s on another family’s webhook', async () => {
    findFirst.mockResolvedValue(null);

    const res = await request(app).delete('/api/v1/webhooks/wh1');

    expect(res.status).toBe(404);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/:id/test', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends a ping and reports the outcome', async () => {
    findFirst.mockResolvedValue({
      id: 'wh1',
      url: 'https://hooks.example.com/catch',
      secret: 'enc',
    });
    const deliver = jest
      .spyOn(WebhookService, 'deliver')
      .mockResolvedValue({ delivered: true, status: 200 });

    const res = await request(app).post('/api/v1/webhooks/wh1/test');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ delivered: true, status: 200 });
    expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: 'wh1' }), 'ping', expect.any(Object));
  });

  it('reports a failed ping as a 200 with delivered:false, not an error', async () => {
    findFirst.mockResolvedValue({
      id: 'wh1',
      url: 'https://hooks.example.com/catch',
      secret: 'enc',
    });
    jest
      .spyOn(WebhookService, 'deliver')
      .mockResolvedValue({ delivered: false, error: 'Endpoint timed out.' });

    const res = await request(app).post('/api/v1/webhooks/wh1/test');

    // The request succeeded; the delivery didn't. Collapsing the two would make the UI unable to
    // tell "your endpoint is broken" from "TaskBuddy is broken".
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ delivered: false, error: 'Endpoint timed out.' });
  });

  it('404s on another family’s webhook', async () => {
    findFirst.mockResolvedValue(null);
    const deliver = jest.spyOn(WebhookService, 'deliver');

    const res = await request(app).post('/api/v1/webhooks/wh1/test');

    expect(res.status).toBe(404);
    expect(deliver).not.toHaveBeenCalled();
  });
});
