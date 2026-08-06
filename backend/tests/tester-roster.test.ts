/**
 * The closed-test roster (admin → Testers).
 *
 * Three properties are worth defending, and none of them is CRUD plumbing:
 *
 *  - **The email→account link is resolved on READ, not trusted from `userId`.** A tester can sign up
 *    at any moment and nothing tells this table when they do. If the join were only done at write
 *    time, a roster entry would say "no account" forever for someone who registered yesterday —
 *    which is precisely the signal the whole screen exists to show.
 *  - **`optedIn` counts `active` only.** Play counts testers *opted in*, not invited. Counting the
 *    roster length instead would report 15 when the clock is actually counting zero, and the clock is
 *    the entire point of the feature.
 *  - **Invites refuse to send without `PLAY_OPT_IN_URL`.** The link is issued by Play Console and
 *    cannot be derived. An invitation is a one-shot message; sending a broken one wastes it.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    tester: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    auditLog: { count: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn() },
}));

jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn() },
}));

/**
 * The auth middleware is replaced wholesale. `authenticate` verifies a real JWT, so without this the
 * router answers 401 before any roster code runs. Both guards have their own tests; what is under
 * test here is the logic behind them.
 */
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-1', role: 'admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

import request from 'supertest';
import express from 'express';

import { prisma } from '../src/services/database';
import { EmailService } from '../src/services/email';

const p = prisma as unknown as {
  tester: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
  user: { findUnique: jest.Mock; findFirst: jest.Mock };
  auditLog: { count: jest.Mock; findMany: jest.Mock };
};

/** Mounts the router with the auth middleware mocked out above. */
function buildApp() {
  jest.isolateModules(() => undefined);
  const app = express();
  app.use(express.json());
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { adminTestersRouter } = require('../src/routes/adminTesters');
  app.use('/testers', adminTestersRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? 500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

function tester(over: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    phone: null,
    status: 'invited',
    userId: null,
    invitedAt: null,
    lastRemindedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.auditLog.count.mockResolvedValue(0);
  p.auditLog.findMany.mockResolvedValue([]);
  p.user.findUnique.mockResolvedValue(null);
  p.user.findFirst.mockResolvedValue(null);
  p.tester.update.mockImplementation(async ({ data }: any) => tester(data));
  delete process.env.PLAY_OPT_IN_URL;
});

describe('the email → account link is resolved on read', () => {
  it('finds an account that signed up AFTER the roster entry was created', async () => {
    // The whole point: `userId` is null on the row, but someone has since registered with that
    // address. Trusting the stored column would report "no account" forever.
    p.tester.findMany.mockResolvedValue([tester({ userId: null })]);
    p.user.findFirst.mockResolvedValue({
      id: 'u-9',
      createdAt: new Date('2026-08-01'),
      lastLoginAt: new Date('2026-08-05'),
    });
    p.auditLog.count.mockResolvedValue(7);

    const res = await request(buildApp()).get('/testers');

    expect(res.status).toBe(200);
    expect(res.body.data.testers[0].activity.hasAccount).toBe(true);
    expect(res.body.data.testers[0].activity.actionCount).toBe(7);
  });

  it('caches the link back onto the row once found', async () => {
    // Cheap and idempotent, and it keeps working if they later change the email on the account — at
    // which point the lookup by address would stop matching.
    p.tester.findMany.mockResolvedValue([tester({ userId: null })]);
    p.user.findFirst.mockResolvedValue({ id: 'u-9', createdAt: new Date(), lastLoginAt: null });

    await request(buildApp()).get('/testers');

    expect(p.tester.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: '11111111-1111-4111-8111-111111111111' }, data: { userId: 'u-9' } }),
    );
  });

  it('reports no account when nobody has signed up with that address', async () => {
    p.tester.findMany.mockResolvedValue([tester()]);

    const res = await request(buildApp()).get('/testers');

    expect(res.body.data.testers[0].activity.hasAccount).toBe(false);
    expect(res.body.data.testers[0].activity.lastLoginAt).toBeNull();
  });
});

describe('the summary counts what Play counts', () => {
  it('counts only `active` toward the 12, not the roster size', async () => {
    // Reporting 4 here would say the clock is running when it is not.
    p.tester.findMany.mockResolvedValue([
      tester({ id: 'a', status: 'active' }),
      tester({ id: 'b', status: 'invited' }),
      tester({ id: 'c', status: 'opted_in' }),
      tester({ id: 'd', status: 'declined' }),
    ]);

    const res = await request(buildApp()).get('/testers');

    expect(res.body.data.summary.total).toBe(4);
    expect(res.body.data.summary.optedIn).toBe(1);
    expect(res.body.data.summary.shortfall).toBe(11);
  });

  it('reports no shortfall once twelve are opted in', async () => {
    p.tester.findMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => tester({ id: `t${i}`, status: 'active' })),
    );

    const res = await request(buildApp()).get('/testers');

    expect(res.body.data.summary.shortfall).toBe(0);
  });
});

describe('invitations', () => {
  it('refuses to send without PLAY_OPT_IN_URL rather than emailing a broken link', async () => {
    p.tester.findUnique.mockResolvedValue(tester());

    const res = await request(buildApp()).post('/testers/11111111-1111-4111-8111-111111111111/invite');

    expect(res.status).toBe(400);
    expect(EmailService.send).not.toHaveBeenCalled();
  });

  it('sends with no family and no user, since a tester may have neither', async () => {
    process.env.PLAY_OPT_IN_URL = 'https://play.google.com/apps/testing/com.gettaskbuddy.app';
    p.tester.findUnique.mockResolvedValue(tester());

    await request(buildApp()).post('/testers/11111111-1111-4111-8111-111111111111/invite');

    expect(EmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'tester_invite',
        toEmail: 'ada@example.test',
        toUserId: null,
        familyId: null,
        // No family record means no notification preferences to consult; without this the send is
        // silently dropped.
        skipPreferenceCheck: true,
      }),
    );
  });
});

describe('reminders adapt to where the tester actually got stuck', () => {
  beforeEach(() => {
    process.env.PLAY_OPT_IN_URL = 'https://play.google.com/apps/testing/com.gettaskbuddy.app';
    p.tester.findUnique.mockResolvedValue(tester());
  });

  it('tells someone with no account that enrolment is the missing step', async () => {
    const res = await request(buildApp()).post('/testers/11111111-1111-4111-8111-111111111111/remind');

    expect(res.status).toBe(200);
    expect(EmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'tester_reminder',
        templateData: expect.objectContaining({ hasSignedIn: false }),
      }),
    );
  });

  it('tells someone with an account to open the app instead', async () => {
    // Same button, different message. Sending the enrolment text to someone already enrolled wastes
    // the one nudge you get.
    p.user.findFirst.mockResolvedValue({ id: 'u-9', createdAt: new Date(), lastLoginAt: new Date() });

    await request(buildApp()).post('/testers/11111111-1111-4111-8111-111111111111/remind');

    expect(EmailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateData: expect.objectContaining({ hasSignedIn: true }),
      }),
    );
  });
});
