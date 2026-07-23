import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// In-memory stand-in for prisma.refreshSession so rotation/reuse/revocation logic can be
// exercised deterministically without a database. $transaction just runs its callback with the
// same client (good enough: the only rollback the code depends on is the count===0 guard, which
// never mutates before it throws).
jest.mock('../src/services/database', () => {
  const rows = new Map<string, any>();

  const matches = (r: any, where: any): boolean => {
    if (where.id !== undefined && r.id !== where.id) return false;
    if (where.userId !== undefined && r.userId !== where.userId) return false;
    if (where.chainId !== undefined && r.chainId !== where.chainId) return false;
    if (where.tokenHash !== undefined && r.tokenHash !== where.tokenHash) return false;
    if (where.revokedAt === null && r.revokedAt != null) return false;
    return true;
  };

  const refreshSession = {
    create: jest.fn(async ({ data }: any) => {
      rows.set(data.id, { revokedAt: null, revokedReason: null, replacedById: null, ...data });
      return rows.get(data.id);
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id !== undefined) return rows.get(where.id) ?? null;
      if (where.tokenHash !== undefined) {
        return [...rows.values()].find((r) => r.tokenHash === where.tokenHash) ?? null;
      }
      return null;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows.values()) {
        if (matches(r, where)) {
          Object.assign(r, data);
          count++;
        }
      }
      return { count };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (const [id, r] of [...rows.entries()]) {
        const before = new Date(where.expiresAt.lt).getTime();
        if (new Date(r.expiresAt).getTime() < before) {
          rows.delete(id);
          count++;
        }
      }
      return { count };
    }),
  };

  const prisma: any = {
    refreshSession,
    $transaction: async (fn: any) => fn(prisma),
    __rows: rows,
    __reset: () => rows.clear(),
  };
  return { prisma };
});

jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));

import { SessionService } from '../src/services/SessionService';
import { prisma } from '../src/services/database';
import { AuditService } from '../src/services/AuditService';

const rows: Map<string, any> = (prisma as any).__rows;
const logAction = AuditService.logAction as jest.Mock;

/** Build a realistic refresh JWT with a jti and a chosen lifetime. */
function makeRefreshToken(jti = crypto.randomUUID(), expiresIn = '30d'): string {
  return jwt.sign({ userId: 'u1', type: 'refresh' }, 'test-secret', { jwtid: jti, expiresIn });
}

const USER = 'user-1';

describe('SessionService', () => {
  beforeEach(() => {
    (prisma as any).__reset();
    logAction.mockClear();
  });

  it('create() stores a hashed row keyed by the token jti, with the parent absolute cap', async () => {
    const jti = 'jti-1';
    const token = makeRefreshToken(jti);
    await SessionService.create(USER, token, { ip: '1.2.3.4', userAgent: 'jest', isChild: false });

    const row = rows.get(jti);
    expect(row).toBeDefined();
    expect(row.userId).toBe(USER);
    expect(row.tokenHash).not.toContain(token); // stored hashed, never raw
    expect(row.revokedAt).toBeNull();
    expect(row.createdByIp).toBe('1.2.3.4');
    // ~30 days out (parent cap), well under the 180-day child cap.
    const days = (new Date(row.absoluteExpiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  it('create() gives children a 180-day absolute cap', async () => {
    const jti = 'jti-child';
    await SessionService.create(USER, makeRefreshToken(jti, '90d'), { isChild: true });
    const days = (new Date(rows.get(jti).absoluteExpiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(179);
    expect(days).toBeLessThan(181);
  });

  it('create() persists the deviceId when given, null when absent (F-10g)', async () => {
    await SessionService.create(USER, makeRefreshToken('jti-dev'), { isChild: false, deviceId: 'device-abc' });
    expect(rows.get('jti-dev').deviceId).toBe('device-abc');

    await SessionService.create(USER, makeRefreshToken('jti-nodev'), { isChild: false });
    expect(rows.get('jti-nodev').deviceId).toBeNull();
  });

  it('rotate() carries the deviceId forward across the chain (F-10g)', async () => {
    const t1 = makeRefreshToken('jti-a');
    await SessionService.create(USER, t1, { isChild: false, deviceId: 'device-xyz' });
    await SessionService.rotate(t1, makeRefreshToken('jti-b'));
    expect(rows.get('jti-b').deviceId).toBe('device-xyz');
  });

  it('rotate() marks the old row rotated and inserts the new one in the same chain', async () => {
    const t1 = makeRefreshToken('jti-a');
    await SessionService.create(USER, t1, { isChild: false });
    const chainId = rows.get('jti-a').chainId;

    const t2 = makeRefreshToken('jti-b');
    await SessionService.rotate(t1, t2);

    expect(rows.get('jti-a').revokedAt).not.toBeNull();
    expect(rows.get('jti-a').revokedReason).toBe('rotated');
    expect(rows.get('jti-a').replacedById).toBe('jti-b');

    expect(rows.get('jti-b')).toBeDefined();
    expect(rows.get('jti-b').revokedAt).toBeNull();
    expect(rows.get('jti-b').chainId).toBe(chainId); // same rotation family
  });

  it('rotate() detects replay of a spent token: kills the whole chain + audits SESSION_REUSE', async () => {
    const t1 = makeRefreshToken('jti-a');
    await SessionService.create(USER, t1, { isChild: false });
    const t2 = makeRefreshToken('jti-b');
    await SessionService.rotate(t1, t2); // legit rotation

    // Attacker replays the already-rotated t1.
    await expect(SessionService.rotate(t1, makeRefreshToken('jti-c'))).rejects.toThrow(
      /already been used/i,
    );

    // Every row in the chain is now dead: jti-a was already revoked as 'rotated' by the legit
    // rotation (revokeChain only re-touches still-live rows), and the live token jti-b is killed
    // with reason 'reuse'.
    expect(rows.get('jti-a').revokedAt).not.toBeNull();
    expect(rows.get('jti-b').revokedReason).toBe('reuse');
    expect(rows.get('jti-b').revokedAt).not.toBeNull();
    // ...and 'jti-c' was never created.
    expect(rows.get('jti-c')).toBeUndefined();

    expect(logAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_REUSE', actorId: USER }),
    );
  });

  it('rotate() rejects a token with no session row (predates the store / forged)', async () => {
    await expect(
      SessionService.rotate(makeRefreshToken('unknown'), makeRefreshToken('new')),
    ).rejects.toThrow(/invalid refresh token/i);
  });

  it('rotate() enforces the absolute cap even when the presented token itself is unused', async () => {
    const t1 = makeRefreshToken('jti-a');
    await SessionService.create(USER, t1, { isChild: false });
    // Force the chain past its hard cap.
    rows.get('jti-a').absoluteExpiresAt = new Date(Date.now() - 1000);

    await expect(SessionService.rotate(t1, makeRefreshToken('jti-b'))).rejects.toThrow(/expired/i);
    expect(rows.get('jti-a').revokedReason).toBe('expired');
    expect(rows.get('jti-b')).toBeUndefined();
  });

  it('revokeByToken() revokes a single session; unknown token is a no-op', async () => {
    const t1 = makeRefreshToken('jti-a');
    await SessionService.create(USER, t1, { isChild: false });

    await SessionService.revokeByToken(t1, 'logout');
    expect(rows.get('jti-a').revokedReason).toBe('logout');

    // No throw for an unknown or absent token.
    await expect(SessionService.revokeByToken(makeRefreshToken('x'), 'logout')).resolves.toBeUndefined();
    await expect(SessionService.revokeByToken(undefined, 'logout')).resolves.toBeUndefined();
  });

  it('revokeAllForUser() revokes every live session for the user only', async () => {
    await SessionService.create(USER, makeRefreshToken('jti-a'), { isChild: false });
    await SessionService.create(USER, makeRefreshToken('jti-b'), { isChild: false });
    rows.set('other', { id: 'other', userId: 'user-2', revokedAt: null, chainId: 'c', tokenHash: 'h' });

    const count = await SessionService.revokeAllForUser(USER, 'password_change');

    expect(count).toBe(2);
    expect(rows.get('jti-a').revokedReason).toBe('password_change');
    expect(rows.get('jti-b').revokedReason).toBe('password_change');
    expect(rows.get('other').revokedAt).toBeNull(); // untouched
  });

  it('sweepExpired() deletes only rows well past their natural expiry', async () => {
    // Fresh row (expires in the future) — kept.
    await SessionService.create(USER, makeRefreshToken('fresh'), { isChild: false });
    // Ancient row (expired 40 days ago) — swept.
    rows.set('old', {
      id: 'old',
      userId: USER,
      chainId: 'c',
      tokenHash: 'h',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() - 40 * 86_400_000),
    });

    const removed = await SessionService.sweepExpired();

    expect(removed).toBe(1);
    expect(rows.get('old')).toBeUndefined();
    expect(rows.get('fresh')).toBeDefined();
  });
});
