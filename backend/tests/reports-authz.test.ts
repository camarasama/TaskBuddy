import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Reports are for parents and admins (security audit 2026-09-14, M2).
 *
 * The router used to authenticate and stop there, so a child's token could read the family audit
 * trail (actor names, IP addresses), the parents' email delivery log, every sibling's points ledger,
 * and export any of it as CSV or PDF. These tests use the REAL auth middleware with signed tokens,
 * because the defect lived in which middleware was mounted, and mocking it would hide exactly that.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/ReportService', () => {
  const ok = jest.fn().mockResolvedValue({ rows: [] });
  return new Proxy({}, { get: (_t, key) => (key === '__esModule' ? true : ok) });
});
jest.mock('../src/services/ExportService', () => {
  const buf = jest.fn().mockResolvedValue(Buffer.from('x'));
  return new Proxy({}, { get: (_t, key) => (key === '__esModule' ? true : buf) });
});
jest.mock('../src/services/InsightsService', () => ({ getInsights: jest.fn().mockResolvedValue({}) }));
jest.mock('../src/services/ReportCardService', () => ({
  buildReportCard: jest.fn().mockResolvedValue({ childName: 'Maya' }),
}));

import { app } from '../src/index';
import { prisma } from '../src/services/database';
import { config } from '../src/config';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/utils/jwt';
import { getAuditTrailReport } from '../src/services/ReportService';

const token = (role: 'child' | 'parent' | 'admin', familyId: string | undefined = 'fam1') =>
  jwt.sign({ userId: `${role}-1`, role, familyId }, config.jwt.secret, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '1h',
    jwtid: 'sess',
  });

const FAMILY_ENDPOINTS = [
  '/insights',
  '/task-completion',
  '/points-ledger',
  '/reward-redemption',
  '/engagement-streak',
  '/achievement',
  '/leaderboard',
  '/task-execution-time',
  '/expiry-overdue',
  '/audit-trail',
  '/email-delivery',
  '/games',
  '/webhook-deliveries',
  '/report-card?childId=c1&month=2026-08',
  '/audit-trail/export?format=csv',
  '/email-delivery/export?format=pdf',
  '/points-ledger/export?format=csv',
];

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.family.findUnique as jest.Mock).mockResolvedValue({ isSuspended: false, deletedAt: null });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ emailVerifiedAt: new Date() });
});

describe('child tokens', () => {
  it.each(FAMILY_ENDPOINTS)('are refused on %s', async (path) => {
    const res = await request(app).get(`/api/v1/reports${path}`).set('Authorization', `Bearer ${token('child')}`);
    expect(res.status).toBe(403);
  });

  it('never reach the report services', async () => {
    await request(app).get('/api/v1/reports/audit-trail').set('Authorization', `Bearer ${token('child')}`);
    expect(getAuditTrailReport).not.toHaveBeenCalled();
  });
});

describe('parent tokens', () => {
  it.each(FAMILY_ENDPOINTS)('are allowed on %s', async (path) => {
    const res = await request(app).get(`/api/v1/reports${path}`).set('Authorization', `Bearer ${token('parent')}`);
    expect(res.status).toBe(200);
  });

  it('are refused for a suspended family', async () => {
    (prisma.family.findUnique as jest.Mock).mockResolvedValue({ isSuspended: true, deletedAt: null });
    const res = await request(app).get('/api/v1/reports/task-completion').set('Authorization', `Bearer ${token('parent')}`);
    expect(res.status).toBe(403);
  });

  it('cannot point a report at another family', async () => {
    const res = await request(app)
      .get('/api/v1/reports/audit-trail?familyId=someone-else')
      .set('Authorization', `Bearer ${token('parent')}`);
    expect(res.status).toBe(403);
  });

  it('are refused until the parent has verified their email, like every other family route', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ emailVerifiedAt: null });
    const res = await request(app).get('/api/v1/reports/task-completion').set('Authorization', `Bearer ${token('parent')}`);
    expect(res.status).toBe(403);
  });

  it('still cannot see platform health', async () => {
    const res = await request(app).get('/api/v1/reports/platform-health').set('Authorization', `Bearer ${token('parent')}`);
    expect(res.status).toBe(403);
  });
});

describe('admin tokens', () => {
  it('can target any family with ?familyId=, which the admin reports page relies on', async () => {
    const res = await request(app)
      .get('/api/v1/reports/audit-trail?familyId=any-family')
      .set('Authorization', `Bearer ${token('admin', undefined)}`);
    expect(res.status).toBe(200);
    expect((getAuditTrailReport as jest.Mock).mock.calls[0][0]).toMatchObject({ familyId: 'any-family' });
  });

  it('can see platform health', async () => {
    const res = await request(app).get('/api/v1/reports/platform-health').set('Authorization', `Bearer ${token('admin', undefined)}`);
    expect(res.status).toBe(200);
  });
});

describe('errors', () => {
  it('return the standard envelope without internals', async () => {
    (getAuditTrailReport as jest.Mock).mockRejectedValueOnce(
      new Error('PrismaClientKnownRequestError: column "ip_address" of relation "audit_logs"'),
    );
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await request(app).get('/api/v1/reports/audit-trail').set('Authorization', `Bearer ${token('parent')}`);
      expect(res.status).toBe(500);
      expect(res.body.detail).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/audit_logs|Prisma/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
