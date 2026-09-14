import request from 'supertest';

/**
 * Notification routes: errors and push unsubscribe scoping (security audit 2026-09-14).
 *
 *  - A failing query used to answer `{ error, detail: String(err) }`, handing Prisma's message (model
 *    and column names) to the client. Errors now go through the central handler.
 *  - `DELETE /push/unsubscribe` with an `endpoint` deleted whoever owned that endpoint, so any
 *    signed-in account could silence another account's browser notifications given the URL.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    notification: { findMany: jest.fn(), count: jest.fn() },
    pushSubscription: { deleteMany: jest.fn() },
    expoPushToken: { upsert: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { userId: 'me', role: 'parent', familyId: 'fam1' };
      next();
    },
  };
});

import { app } from '../src/index';
import { prisma } from '../src/services/database';

const db = prisma as any;

beforeEach(() => {
  jest.clearAllMocks();
  db.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
});

describe('DELETE /notifications/push/unsubscribe', () => {
  it('only ever deletes the caller\'s own subscription for an endpoint', async () => {
    const res = await request(app)
      .delete('/api/v1/notifications/push/unsubscribe')
      .send({ endpoint: 'https://push.example/someone-elses' });

    expect(res.status).toBe(200);
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/someone-elses', userId: 'me' },
    });
  });

  it('with no endpoint, removes all of the caller\'s subscriptions and nobody else\'s', async () => {
    await request(app).delete('/api/v1/notifications/push/unsubscribe').send({});
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: 'me' } });
  });
});

describe('errors', () => {
  it('do not leak the database message', async () => {
    db.notification.findMany.mockRejectedValue(new Error('Invalid `prisma.notification.findMany()` invocation: column "user_id"'));
    db.notification.count.mockResolvedValue(0);
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(500);
      expect(res.body.detail).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/prisma|user_id/i);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('answer instead of hanging when registering an Expo token fails', async () => {
    db.expoPushToken.upsert.mockRejectedValue(new Error('db down'));
    const res = await request(app)
      .post('/api/v1/notifications/push/expo-token')
      .send({ token: 'ExponentPushToken[abc]' });
    expect(res.status).toBe(500);
  });
});
