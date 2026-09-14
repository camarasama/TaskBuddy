import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * A signed-out session stops working immediately (security audit 2026-09-14).
 *
 * Access tokens were verified by signature alone, so "sign out this device", a PIN or password reset
 * and a family suspension only killed the REFRESH token. The access token already on the device kept
 * working until it expired: up to an hour for a parent, up to 24 hours for a child.
 *
 * The property that matters most is the negative one: ordinary refresh (rotation) must NOT deny
 * anything, or every user would be signed out every time their token refreshed.
 */
const HOUR = 60 * 60 * 1000;
const rows: any[] = [];

jest.mock('../src/services/database', () => ({
  prisma: {
    refreshSession: {
      findMany: jest.fn(async ({ where = {}, distinct }: any) => {
        let out = rows.filter((r) => {
          if (where.userId !== undefined && r.userId !== where.userId) return false;
          if (where.chainId?.in && !where.chainId.in.includes(r.chainId)) return false;
          if (where.createdAt?.gt && !(r.createdAt > where.createdAt.gt)) return false;
          if (where.revokedAt?.gt && !(r.revokedAt && r.revokedAt > where.revokedAt.gt)) return false;
          if (where.NOT?.revokedReason && r.revokedReason === where.NOT.revokedReason) return false;
          return true;
        });
        if (distinct) out = out.filter((r, i) => out.findIndex((o) => o.chainId === r.chainId) === i);
        return out;
      }),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.revokedAt === null) ?? null),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.tokenHash === where.tokenHash) ?? null),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    user: { findMany: jest.fn(async () => [{ id: 'maya' }, { id: 'sam' }]) },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));

import { app } from '../src/index';
import { config } from '../src/config';
import { JWT_AUDIENCE, JWT_ISSUER } from '../src/utils/jwt';
import { SessionService } from '../src/services/SessionService';
import {
  clearAccessDenylist,
  denyAccess,
  durationMs,
  isAccessDenied,
  maxAccessTtlMs,
  pruneAccessDenylist,
} from '../src/utils/accessDenylist';

const row = (over: Record<string, unknown>) => ({
  userId: 'maya',
  chainId: 'chain-1',
  tokenHash: 'hash',
  revokedAt: null,
  revokedReason: null,
  createdAt: new Date(),
  ...over,
});

const token = (jti: string, role = 'child') =>
  jwt.sign({ userId: 'maya', role, familyId: 'fam1' }, config.jwt.secret, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '24h',
    jwtid: jti,
  });

beforeEach(() => {
  rows.length = 0;
  clearAccessDenylist();
  jest.clearAllMocks();
});

describe('durations', () => {
  it('parses jsonwebtoken-style lifetimes', () => {
    expect(durationMs('15m', 0)).toBe(15 * 60 * 1000);
    expect(durationMs('24h', 0)).toBe(24 * HOUR);
    expect(durationMs('7d', 0)).toBe(7 * 24 * HOUR);
    expect(durationMs('3600', 0)).toBe(HOUR);
    expect(durationMs('nonsense', 42)).toBe(42);
  });

  it('covers the longest access token, which is the child one', () => {
    expect(maxAccessTtlMs()).toBeGreaterThanOrEqual(24 * HOUR);
  });
});

describe('the list itself', () => {
  it('forgets an entry once the token it guards has expired anyway', () => {
    denyAccess('a', Date.now() + 1000);
    denyAccess('b', Date.now() - 1);
    expect(isAccessDenied('a')).toBe(true);
    expect(isAccessDenied('b')).toBe(false);
    expect(pruneAccessDenylist(Date.now() + 2000)).toBe(1);
    expect(isAccessDenied('a')).toBe(false);
  });

  it('never denies a token without a jti', () => {
    expect(isAccessDenied(undefined)).toBe(false);
  });
});

describe('revoking a session denies its access tokens', () => {
  it('revokeById denies the live row AND recent rotated rows of the chain (requests in flight)', async () => {
    rows.push(
      row({ id: 'head', revokedAt: null }),
      row({ id: 'rotated-recently', revokedAt: new Date(), revokedReason: 'rotated', createdAt: new Date(Date.now() - HOUR) }),
      row({ id: 'rotated-long-ago', revokedAt: new Date(), revokedReason: 'rotated', createdAt: new Date(Date.now() - 3 * 24 * HOUR) }),
    );

    await SessionService.revokeById('head', 'parent_revoke', ['maya']);

    expect(isAccessDenied('head')).toBe(true);
    expect(isAccessDenied('rotated-recently')).toBe(true);
    // Too old to have minted an access token that is still valid.
    expect(isAccessDenied('rotated-long-ago')).toBe(false);
  });

  it('revokeById for someone not on the allow list denies and revokes nothing', async () => {
    rows.push(row({ id: 'head', userId: 'sam' }));
    const { prisma } = jest.requireMock('../src/services/database');

    const result = await SessionService.revokeById('head', 'user_revoke', ['maya']);

    expect(result).toBeNull();
    expect(isAccessDenied('head')).toBe(false);
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('revokeAllForUser (PIN or password reset) denies that user\'s recent sessions only', async () => {
    rows.push(row({ id: 'maya-phone' }), row({ id: 'sam-laptop', userId: 'sam', chainId: 'chain-2' }));

    await SessionService.revokeAllForUser('maya', 'pin_reset');

    expect(isAccessDenied('maya-phone')).toBe(true);
    expect(isAccessDenied('sam-laptop')).toBe(false);
  });

  it('revokeAllForFamily (suspension) denies every member', async () => {
    rows.push(row({ id: 'maya-phone' }), row({ id: 'sam-laptop', userId: 'sam', chainId: 'chain-2' }));

    await SessionService.revokeAllForFamily('fam1', 'admin');

    expect(isAccessDenied('maya-phone')).toBe(true);
    expect(isAccessDenied('sam-laptop')).toBe(true);
  });

  it('logout denies the device\'s access token too', async () => {
    rows.push(row({ id: 'head', tokenHash: require('crypto').createHash('sha256').update('refresh-jwt').digest('hex') }));

    await SessionService.revokeByToken('refresh-jwt', 'logout');

    expect(isAccessDenied('head')).toBe(true);
  });
});

describe('after a restart', () => {
  it('restores revoked chains and ignores chains that were only rotated', async () => {
    rows.push(
      row({ id: 'signed-out', chainId: 'chain-out', revokedAt: new Date(), revokedReason: 'parent_revoke' }),
      row({ id: 'refreshed', chainId: 'chain-alive', revokedAt: new Date(), revokedReason: 'rotated' }),
      row({ id: 'current', chainId: 'chain-alive', revokedAt: null }),
    );

    const chains = await SessionService.hydrateAccessDenylist();

    expect(chains).toBe(1);
    expect(isAccessDenied('signed-out')).toBe(true);
    // A normal refresh is not a sign-out: nobody is logged out by a restart.
    expect(isAccessDenied('refreshed')).toBe(false);
    expect(isAccessDenied('current')).toBe(false);
  });
});

describe('authenticate', () => {
  it('refuses a signed-out access token with 401, even though its signature is valid', async () => {
    denyAccess('revoked-jti', Date.now() + HOUR);

    const res = await request(app).get('/api/v1/sessions').set('Authorization', `Bearer ${token('revoked-jti')}`);

    expect(res.status).toBe(401);
  });

  it('accepts a live access token', async () => {
    const res = await request(app).get('/api/v1/sessions').set('Authorization', `Bearer ${token('live-jti')}`);
    expect(res.status).toBe(200);
  });
});
