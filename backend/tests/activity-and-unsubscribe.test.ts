/**
 * ActivityService (who counts as active, and the throttle that keeps it off the hot path) and the
 * public unsubscribe endpoint.
 */

process.env.ACTIVITY_TRACKING_IN_TESTS = 'true';

jest.mock('../src/services/database', () => ({
  prisma: {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: { updateMany: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  },
}));

import express from 'express';
import request from 'supertest';
import { prisma } from '../src/services/database';
import { ActivityService, THROTTLE_MS } from '../src/services/ActivityService';
import { emailPreferencesRouter } from '../src/routes/emailPreferences';
import { signUnsubscribe } from '../src/services/ReengagementService';
import { errorHandler } from '../src/middleware/errorHandler';

const exec = prisma.$executeRaw as unknown as jest.Mock;
const updateMany = prisma.user.updateMany as jest.Mock;
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.clearAllMocks();
  ActivityService._reset();
});

describe('ActivityService.touch', () => {
  const now = new Date('2026-10-26T10:00:00Z');

  it('writes the user, the day row, the family and the email return marker', async () => {
    ActivityService.touch({ userId: 'u1', familyId: 'f1', role: 'parent', now });
    await flush();
    const sql = exec.mock.calls.map((c) => (c[0] as string[]).join('?'));
    expect(sql.some((s) => s.includes('UPDATE users SET last_active_at'))).toBe(true);
    expect(sql.some((s) => s.includes('INSERT INTO family_activity_days'))).toBe(true);
    expect(sql.some((s) => s.includes('UPDATE families SET last_active_at'))).toBe(true);
    expect(sql.some((s) => s.includes('UPDATE reengagement_emails SET returned_at'))).toBe(true);
  });

  it('is throttled per user and per family', async () => {
    ActivityService.touch({ userId: 'u1', familyId: 'f1', role: 'child', now });
    ActivityService.touch({ userId: 'u1', familyId: 'f1', role: 'child', now: new Date(now.getTime() + 60_000) });
    await flush();
    expect(exec).toHaveBeenCalledTimes(4);
    ActivityService.touch({ userId: 'u1', familyId: 'f1', role: 'child', now: new Date(now.getTime() + THROTTLE_MS) });
    await flush();
    expect(exec).toHaveBeenCalledTimes(8);
  });

  it('ignores admins', async () => {
    ActivityService.touch({ userId: 'a1', familyId: null, role: 'admin', now });
    await flush();
    expect(exec).not.toHaveBeenCalled();
  });

  it('never throws when the database fails', async () => {
    exec.mockRejectedValueOnce(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => ActivityService.touch({ userId: 'u2', familyId: 'f2', role: 'parent', now })).not.toThrow();
    await flush();
    warn.mockRestore();
  });
});

describe('POST /email/unsubscribe', () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/email', emailPreferencesRouter);
  app.use(errorHandler);
  const USER = '0b6f2f4e-4e8e-4b7a-9d55-1d0c1c0c0c01';

  it('accepts the RFC 8058 one-click POST with the token in the query', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app)
      .post(`/email/unsubscribe?u=${USER}&t=${signUnsubscribe(USER)}`)
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: USER, reengagementOptOutAt: null } }));
  });

  it('accepts the web page POST with the token in the body', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post('/email/unsubscribe').send({ u: USER, t: signUnsubscribe(USER) });
    expect(res.status).toBe(200);
  });

  it('rejects a forged token without touching the database', async () => {
    const res = await request(app).post('/email/unsubscribe').send({ u: USER, t: 'a'.repeat(32) });
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('has no GET that could unsubscribe on a link preview', async () => {
    const res = await request(app).get(`/email/unsubscribe?u=${USER}&t=${signUnsubscribe(USER)}`);
    expect(res.status).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
