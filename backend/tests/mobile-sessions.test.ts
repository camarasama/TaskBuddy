import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * P0-4 — long-lived mobile sessions, and the revoke controls that make them acceptable.
 *
 * Two things are asserted here and they are a pair: a mobile parent session lasts 90 days instead
 * of 7, and any such session can be ended on demand. The first without the second would just be a
 * longer-lived credential on a child's phone with no way to kill it.
 */
const findMany = jest.fn();
const findFirst = jest.fn();
const updateMany = jest.fn();
const create = jest.fn();
const userFindMany = jest.fn();

jest.mock('../src/services/database', () => ({
  prisma: {
    refreshSession: {
      findMany: (...args: unknown[]) => findMany(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
      create: (...args: unknown[]) => create(...args),
    },
    user: { findMany: (...args: unknown[]) => userFindMany(...args), update: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));

import { app } from '../src/index';
import { config } from '../src/config';
import { authService } from '../src/services/auth';
import { SessionService } from '../src/services/SessionService';
import { JWT_ISSUER, JWT_AUDIENCE } from '../src/utils/jwt';

const PARENT = { userId: 'parent-1', familyId: 'family-1', role: 'parent' as const };
const CHILD_ID = 'child-1';

/** A real access token, so `authenticate` runs for real rather than being stubbed out. */
function accessToken(payload: Record<string, unknown>, jti = 'session-jti') {
  return jwt.sign(payload, config.jwt.secret, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '1h',
    jwtid: jti,
  });
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function sessionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: UUID_A,
    userId: CHILD_ID,
    chainId: 'chain-1',
    client: 'taskbuddy-android/1.0.0',
    userAgent: 'okhttp/4.9.2',
    createdByIp: '203.0.113.7',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
    absoluteExpiresAt: new Date(now.getTime() + 86_400_000 * 90),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  updateMany.mockResolvedValue({ count: 1 });
  create.mockResolvedValue({});
  userFindMany.mockResolvedValue([{ id: CHILD_ID }]);
});

describe('P0-4: the chain cap matches the token, per client', () => {
  /** The absolute cap the session row was opened with, in whole days from now. */
  async function capDays(ctx: Parameters<typeof SessionService.create>[2]) {
    const { refreshToken } = authService.generateTokens(PARENT, { isMobile: ctx?.isMobile });
    await SessionService.create(PARENT.userId, refreshToken, ctx);
    const { absoluteExpiresAt } = create.mock.calls[0][0].data;
    return Math.round((absoluteExpiresAt.getTime() - Date.now()) / 86_400_000);
  }

  // A 90-day token under a 30-day chain cap would die at 30 days with no visible cause — the
  // token is still valid, the rotation just stops. This is the pairing that prevents that.
  it('mobile parent: 90-day cap to match the 90-day token', async () => {
    expect(await capDays({ isMobile: true })).toBe(90);
  });

  it('web parent: unchanged at 30 days', async () => {
    expect(await capDays({})).toBe(30);
  });

  it('child: keeps the longest cap on any client', async () => {
    expect(await capDays({ isChild: true, isMobile: true })).toBe(180);
  });

  it('stores the client label so the revoke list can name the device', async () => {
    await SessionService.create(PARENT.userId, authService.generateTokens(PARENT).refreshToken, {
      isMobile: true,
      client: 'taskbuddy-android/1.0.0',
    });
    expect(create.mock.calls[0][0].data.client).toBe('taskbuddy-android/1.0.0');
  });
});

describe('P0-4: mobile parent sessions last 90 days, not 7', () => {
  /** Decode a refresh token's lifetime in whole days. */
  function lifetimeDays(token: string): number {
    const { iat, exp } = jwt.decode(token) as { iat: number; exp: number };
    return Math.round((exp - iat) / 86_400);
  }

  it('web keeps the 7-day refresh token', () => {
    const { refreshToken } = authService.generateTokens(PARENT);
    expect(lifetimeDays(refreshToken)).toBe(7);
  });

  it('mobile gets 90 days', () => {
    const { refreshToken } = authService.generateTokens(PARENT, { isMobile: true });
    expect(lifetimeDays(refreshToken)).toBe(90);
  });

  it('the access token stays short-lived on mobile — revocation must stay responsive', () => {
    const web = authService.generateTokens(PARENT);
    const mobile = authService.generateTokens(PARENT, { isMobile: true });
    expect(mobile.expiresIn).toBe(web.expiresIn);
  });
});

describe('GET /sessions', () => {
  it('lists the caller\'s own devices and flags the current one', async () => {
    findMany.mockResolvedValue([
      sessionRow({ id: UUID_A, userId: PARENT.userId }),
      sessionRow({ id: UUID_B, userId: PARENT.userId, client: null, chainId: 'chain-2' }),
    ]);

    const res = await request(app)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${accessToken(PARENT, UUID_A)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sessions).toHaveLength(2);
    expect(res.body.data.sessions[0]).toMatchObject({
      id: UUID_A,
      client: 'taskbuddy-android/1.0.0',
      isCurrent: true,
    });
    // A session with no client string was opened from a browser.
    expect(res.body.data.sessions[1]).toMatchObject({ client: 'web', isCurrent: false });
  });

  it('never returns the token hash or chain id', async () => {
    findMany.mockResolvedValue([sessionRow({ userId: PARENT.userId, tokenHash: 'sha256-secret' })]);

    const res = await request(app)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${accessToken(PARENT)}`);

    expect(JSON.stringify(res.body)).not.toContain('sha256-secret');
    expect(JSON.stringify(res.body)).not.toContain('chain-1');
  });

  it('excludes expired rows, not just revoked ones', async () => {
    findMany.mockResolvedValue([]);

    await request(app).get('/api/v1/sessions').set('Authorization', `Bearer ${accessToken(PARENT)}`);

    const where = findMany.mock.calls[0][0].where;
    expect(where.revokedAt).toBeNull();
    expect(where.expiresAt).toHaveProperty('gt');
    expect(where.absoluteExpiresAt).toHaveProperty('gt');
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/sessions');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /sessions/:sessionId', () => {
  it('revokes the whole chain, not just the presented row', async () => {
    findFirst.mockResolvedValue({ userId: PARENT.userId, chainId: 'chain-1' });

    const res = await request(app)
      .delete(`/api/v1/sessions/${UUID_A}`)
      .set('Authorization', `Bearer ${accessToken(PARENT)}`);

    expect(res.status).toBe(200);
    // Revoking by chain is what keeps a deliberate sign-out from tripping reuse detection.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chainId: 'chain-1', revokedAt: null },
        data: expect.objectContaining({ revokedReason: 'user_revoke' }),
      })
    );
  });

  it('404s on a session belonging to someone else — same as one that does not exist', async () => {
    findFirst.mockResolvedValue({ userId: 'someone-else', chainId: 'chain-9' });

    const res = await request(app)
      .delete(`/api/v1/sessions/${UUID_A}`)
      .set('Authorization', `Bearer ${accessToken(PARENT)}`);

    expect(res.status).toBe(404);
  });

  it('404s on an unknown session', async () => {
    findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/v1/sessions/${UUID_A}`)
      .set('Authorization', `Bearer ${accessToken(PARENT)}`);

    expect(res.status).toBe(404);
  });
});

describe('parent remote-revoke', () => {
  it('GET /sessions/children lists the family\'s children only', async () => {
    findMany.mockResolvedValue([sessionRow()]);

    const res = await request(app)
      .get('/api/v1/sessions/children')
      .set('Authorization', `Bearer ${accessToken(PARENT)}`);

    expect(res.status).toBe(200);
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId: PARENT.familyId, role: 'child', deletedAt: null },
      })
    );
    expect(findMany.mock.calls[0][0].where.userId).toEqual({ in: [CHILD_ID] });
  });

  it('DELETE /sessions/children/:id signs out a child device', async () => {
    findFirst.mockResolvedValue({ userId: CHILD_ID, chainId: 'chain-1' });

    const res = await request(app)
      .delete(`/api/v1/sessions/children/${UUID_A}`)
      .set('Authorization', `Bearer ${accessToken(PARENT)}`);

    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokedReason: 'parent_revoke' }),
      })
    );
  });

  it('a parent cannot revoke a co-parent\'s session through the child route', async () => {
    // The session belongs to a real family member — just not a child.
    findFirst.mockResolvedValue({ userId: 'co-parent-1', chainId: 'chain-3' });
    userFindMany.mockResolvedValue([{ id: CHILD_ID }]);

    const res = await request(app)
      .delete(`/api/v1/sessions/children/${UUID_A}`)
      .set('Authorization', `Bearer ${accessToken(PARENT)}`);

    expect(res.status).toBe(404);
  });

  it('a child cannot reach the parent routes', async () => {
    const childToken = accessToken({ userId: CHILD_ID, familyId: 'family-1', role: 'child' });

    const list = await request(app)
      .get('/api/v1/sessions/children')
      .set('Authorization', `Bearer ${childToken}`);
    const revoke = await request(app)
      .delete(`/api/v1/sessions/children/${UUID_A}`)
      .set('Authorization', `Bearer ${childToken}`);

    expect(list.status).toBe(403);
    expect(revoke.status).toBe(403);
  });
});
