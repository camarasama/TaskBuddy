/**
 * SessionService - server-side refresh-token sessions (F-1).
 *
 * Every refresh token issued to a client has a matching row here. That turns three things that
 * were previously impossible into cheap DB operations:
 *
 *   - Rotation:   each /auth/refresh mints a new token in the same `chainId` and revokes the old
 *                 row, so a leaked-but-superseded token is worthless.
 *   - Reuse:      if a token that was already rotated (or revoked) is presented again, the whole
 *                 chain is revoked and the event is audited - the signature of a stolen token
 *                 being replayed after the legitimate client already rotated it.
 *   - Revocation: logout, password change/reset, admin force-reset and child PIN reset can kill
 *                 every live session for a user immediately, instead of waiting up to 90 days for
 *                 a child refresh token to expire on its own.
 *
 * The raw JWT is never stored: rows are keyed by the token's `jti` claim and carry only a sha256
 * of the token string.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from './database';
import { UnauthorizedError } from '../middleware/errorHandler';
import { AuditService } from './AuditService';

// Hard cap on how long a single login (chain of rotations) may live, regardless of rotation.
const PARENT_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const CHILD_ABSOLUTE_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

// Revoked/expired rows are kept for a while (audit + reuse detection) then swept.
const SWEEP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days past natural expiry

export type RevokeReason =
  | 'logout'
  | 'rotated'
  | 'reuse'
  | 'expired'
  | 'password_change'
  | 'admin'
  | 'pin_reset';

export interface SessionContext {
  ip?: string;
  userAgent?: string;
  isChild?: boolean;
  deviceId?: string; // F-10g: opaque client-supplied device id, stored for traceability only
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Read the `jti` and `exp` claims without re-verifying (the caller has already verified). */
function claims(token: string): { jti?: string; exp?: number } {
  const decoded = jwt.decode(token) as { jti?: string; exp?: number } | null;
  return decoded ?? {};
}

/** Thrown when a conditional rotate loses a race - treated as reuse by the caller. */
class ConcurrentRotationError extends Error {}

async function revokeChain(chainId: string, reason: RevokeReason): Promise<void> {
  await prisma.refreshSession.updateMany({
    where: { chainId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export const SessionService = {
  /** Record a freshly minted refresh token as the head of a new chain. */
  async create(userId: string, refreshJwt: string, ctx: SessionContext = {}): Promise<void> {
    const { jti, exp } = claims(refreshJwt);
    if (!jti) throw new Error('SessionService.create: refresh token has no jti claim');

    const now = Date.now();
    await prisma.refreshSession.create({
      data: {
        id: jti,
        userId,
        tokenHash: sha256(refreshJwt),
        chainId: crypto.randomUUID(),
        expiresAt: exp ? new Date(exp * 1000) : new Date(now + PARENT_ABSOLUTE_MS),
        absoluteExpiresAt: new Date(now + (ctx.isChild ? CHILD_ABSOLUTE_MS : PARENT_ABSOLUTE_MS)),
        createdByIp: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        deviceId: ctx.deviceId ?? null,
      },
    });
  },

  /**
   * Rotate an old refresh token to a new one. Throws UnauthorizedError (→ 401 → client re-login)
   * on anything suspicious; on the happy path marks the old row rotated and inserts the new one
   * in the same chain.
   */
  async rotate(oldJwt: string, newJwt: string): Promise<void> {
    const existing = await prisma.refreshSession.findUnique({
      where: { tokenHash: sha256(oldJwt) },
    });

    // No row: the token predates the session store (first refresh after this feature deploys) or
    // is forged. Either way it cannot be trusted - force a fresh login.
    if (!existing) throw new UnauthorizedError('Invalid refresh token');

    const now = new Date();

    // Already rotated or revoked → this is a replay of a spent token. Burn the whole chain.
    if (existing.revokedAt || existing.replacedById) {
      await revokeChain(existing.chainId, 'reuse');
      await AuditService.logAction({
        actorId: existing.userId,
        action: 'SESSION_REUSE',
        resourceType: 'refresh_session',
        resourceId: existing.id,
        metadata: { chainId: existing.chainId, reason: 'replayed spent refresh token' },
      });
      throw new UnauthorizedError('Refresh token has already been used');
    }

    // The chain has lived past its absolute cap - stop rotating even though this token is unused.
    if (existing.absoluteExpiresAt <= now) {
      await revokeChain(existing.chainId, 'expired');
      throw new UnauthorizedError('Session expired, please log in again');
    }

    const { jti: newJti, exp: newExp } = claims(newJwt);
    if (!newJti) throw new Error('SessionService.rotate: new refresh token has no jti claim');

    try {
      await prisma.$transaction(async (tx) => {
        // Conditional mark: if another request rotated this row first, count === 0 and we lost a
        // race → treat as reuse (below). The condition is what makes rotation atomic.
        const marked = await tx.refreshSession.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: now, revokedReason: 'rotated', replacedById: newJti },
        });
        if (marked.count === 0) throw new ConcurrentRotationError();

        await tx.refreshSession.create({
          data: {
            id: newJti,
            userId: existing.userId,
            tokenHash: sha256(newJwt),
            chainId: existing.chainId,
            expiresAt: newExp ? new Date(newExp * 1000) : existing.expiresAt,
            absoluteExpiresAt: existing.absoluteExpiresAt,
            createdByIp: existing.createdByIp,
            userAgent: existing.userAgent,
            deviceId: existing.deviceId, // carry the device id across rotations in the chain
          },
        });
      });
    } catch (err) {
      if (err instanceof ConcurrentRotationError) {
        await revokeChain(existing.chainId, 'reuse');
        await AuditService.logAction({
          actorId: existing.userId,
          action: 'SESSION_REUSE',
          resourceType: 'refresh_session',
          resourceId: existing.id,
          metadata: { chainId: existing.chainId, reason: 'concurrent rotation of one token' },
        });
        throw new UnauthorizedError('Refresh token has already been used');
      }
      throw err;
    }
  },

  /** Revoke a single session by its token (logout). No-op if the token is unknown. */
  async revokeByToken(refreshJwt: string | undefined | null, reason: RevokeReason): Promise<void> {
    if (!refreshJwt) return;
    await prisma.refreshSession.updateMany({
      where: { tokenHash: sha256(refreshJwt), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  },

  /** Revoke every live session for a user (password change/reset, admin action, PIN reset). */
  async revokeAllForUser(userId: string, reason: RevokeReason): Promise<number> {
    const { count } = await prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  },

  /** Delete rows whose natural expiry is well past - called daily from the scheduler. */
  async sweepExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - SWEEP_RETENTION_MS);
    const { count } = await prisma.refreshSession.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  },
};
