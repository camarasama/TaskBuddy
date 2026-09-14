import crypto from 'crypto';
import request from 'supertest';

/**
 * Two small items from the security audit of 2026-09-14.
 *
 *  - Parents could set any URL as their own or a child's avatar, and every family member's browser
 *    and phone then fetched it: a tracking beacon, or unmoderated content in a children's app.
 *  - The digest open pixel was signed with the JWT secret itself. It now uses a derived key, and
 *    still accepts the old signature until LEGACY_PIXEL_UNTIL so digests already sent keep counting.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    user: { update: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    family: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { userId: 'p1', role: 'parent', familyId: 'fam1' };
      next();
    },
    familyIsolation: (req: any, _res: any, next: any) => {
      req.familyId = 'fam1';
      next();
    },
  };
});
jest.mock('../src/services/AuditService', () => ({ AuditService: { logAction: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/services/AnalyticsService', () => ({ AnalyticsService: { record: jest.fn() } }));

import { app } from '../src/index';
import { prisma } from '../src/services/database';
import { config } from '../src/config';
import { AnalyticsService } from '../src/services/AnalyticsService';
import { LEGACY_PIXEL_UNTIL, signDigestOpen } from '../src/routes/track';

const db = prisma as any;
const ownUrl = `${config.apiUrl.replace(/\/$/, '')}/uploads/avatars/2026-09-14/abc.jpg`;

beforeEach(() => {
  jest.clearAllMocks();
  db.user.update.mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
});

describe('avatar URLs must be our own uploads', () => {
  it('PUT /auth/me refuses a third-party image URL', async () => {
    const res = await request(app).put('/api/v1/auth/me').send({ avatarUrl: 'https://tracker.example/pixel.png?u=sam' });
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('PUT /auth/me accepts the URL an upload returned, and clearing it', async () => {
    expect((await request(app).put('/api/v1/auth/me').send({ avatarUrl: ownUrl })).status).toBe(200);
    expect((await request(app).put('/api/v1/auth/me').send({ avatarUrl: null })).status).toBe(200);
  });

  it('PUT /families/me/children/:id refuses a third-party image URL for a child', async () => {
    const res = await request(app)
      .put('/api/v1/families/me/children/11111111-1111-1111-1111-111111111111')
      .send({ avatarUrl: 'https://tracker.example/pixel.png' });
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe('digest open pixel', () => {
  const week = '2026-09-07';
  const legacy = crypto.createHmac('sha256', config.jwt.secret).update(`digest-open:fam1:${week}`).digest('hex').slice(0, 32);

  it('is no longer signed with the JWT secret directly', () => {
    expect(signDigestOpen('fam1', week)).not.toBe(legacy);
  });

  it('counts an open signed with the current key', async () => {
    await request(app).get(`/api/v1/track/digest/fam1/${week}/${signDigestOpen('fam1', week)}.gif`);
    expect(AnalyticsService.record).toHaveBeenCalledTimes(1);
  });

  it('still counts a digest sent before the change, until the cutoff', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(LEGACY_PIXEL_UNTIL.getTime() - 1000);
    await request(app).get(`/api/v1/track/digest/fam1/${week}/${legacy}.gif`);
    now.mockRestore();
    expect(AnalyticsService.record).toHaveBeenCalledTimes(1);
  });

  it('stops accepting the old signature after the cutoff, and always answers with the pixel', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(LEGACY_PIXEL_UNTIL.getTime() + 1000);
    const res = await request(app).get(`/api/v1/track/digest/fam1/${week}/${legacy}.gif`);
    now.mockRestore();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(AnalyticsService.record).not.toHaveBeenCalled();
  });
});
