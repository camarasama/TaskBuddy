/**
 * routes/sessions.ts — signed-in devices, and the controls to sign them out (P0-4).
 *
 * Mobile sessions live up to 90 days, which means a child's phone holds a long-lived credential.
 * That is only acceptable paired with a way to kill it on demand: a lost phone, a child who
 * shouldn't be on the app after bedtime, a device handed on to someone else. Expiry alone is not
 * a control — it is a wait.
 *
 * Two scopes, deliberately separate rather than one endpoint with a branch:
 *   - Own sessions:   any authenticated user, including children, may see and end their own.
 *   - Child sessions: a parent may see and end the sessions of *children* in their family.
 *
 * A parent cannot touch a co-parent's sessions. Co-parents are peers, and "sign out my kid's
 * phone" does not imply "sign out the other adult in the house" — that would be a new power over
 * another adult's account, granted as a side effect of a mobile feature.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { SessionService, type SessionSummary } from '../services/SessionService';
import { authenticate, requireParent } from '../middleware/auth';
import { NotFoundError } from '../middleware/errorHandler';
import { AuditService } from '../services/AuditService';
import { validateParams } from '../middleware/validate';

export const sessionsRouter = Router();

const sessionIdSchema = z.object({ sessionId: z.string().uuid() });

/**
 * Shape a session for the client. The IP is included because it is the only signal that
 * distinguishes two otherwise identical entries, but the raw token hash, chain id and device id
 * are not — they identify the credential rather than the device, and nothing in the UI needs them.
 */
function present(session: SessionSummary, currentJti: string | undefined) {
  return {
    id: session.id,
    userId: session.userId,
    // NULL client means the session was opened from a browser — see the migration note.
    client: session.client ?? 'web',
    userAgent: session.userAgent,
    ipAddress: session.createdByIp,
    lastActiveAt: session.lastActiveAt,
    expiresAt: session.expiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    // Lets the UI label "this device" and warn before someone signs themselves out.
    isCurrent: currentJti !== undefined && session.id === currentJti,
  };
}

/** Child user ids in the caller's family. Excludes co-parents by design (see the header note). */
async function childIdsInFamily(familyId: string): Promise<string[]> {
  const children = await prisma.user.findMany({
    where: { familyId, role: 'child', deletedAt: null },
    select: { id: true },
  });
  return children.map((c) => c.id);
}

// GET /sessions - the caller's own signed-in devices
sessionsRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const sessions = await SessionService.listLiveForUsers([req.user!.userId]);
    res.json({
      success: true,
      data: { sessions: sessions.map((s) => present(s, req.user!.jti)) },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /sessions/:sessionId - end one of the caller's own sessions
sessionsRouter.delete('/:sessionId', authenticate, validateParams(sessionIdSchema), async (req, res, next) => {
  try {
    const target = await SessionService.revokeById(req.params.sessionId, 'user_revoke');

    // Ownership is checked *after* the lookup but the response is the same either way: an id that
    // belongs to someone else must be indistinguishable from one that doesn't exist, or this
    // endpoint becomes an oracle for whether a given session id is live.
    if (!target || target.userId !== req.user!.userId) {
      throw new NotFoundError('Session not found');
    }

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'SESSION_REVOKE',
      resourceType: 'refresh_session',
      resourceId: req.params.sessionId,
      familyId: req.user!.familyId,
      ipAddress: req.ip,
      metadata: { scope: 'self' },
    });

    res.json({ success: true, data: { message: 'Device signed out' } });
  } catch (error) {
    next(error);
  }
});

// GET /sessions/children - parent-only: every child's signed-in devices
sessionsRouter.get('/children', authenticate, requireParent, async (req, res, next) => {
  try {
    const childIds = await childIdsInFamily(req.user!.familyId);
    const sessions = await SessionService.listLiveForUsers(childIds);

    res.json({
      success: true,
      data: { sessions: sessions.map((s) => present(s, req.user!.jti)) },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /sessions/children/:sessionId - parent-only: sign out a child's device
sessionsRouter.delete(
  '/children/:sessionId',
  authenticate,
  requireParent,
  validateParams(sessionIdSchema),
  async (req, res, next) => {
    try {
      const target = await SessionService.revokeById(req.params.sessionId, 'parent_revoke');

      // Same non-disclosure rule as the self endpoint, and the same reason. The scope check is
      // "is this one of my children" — not "is this in my family", which would let a parent end a
      // co-parent's session through this route.
      const childIds = await childIdsInFamily(req.user!.familyId);
      if (!target || !childIds.includes(target.userId)) {
        throw new NotFoundError('Session not found');
      }

      await AuditService.logAction({
        actorId: req.user!.userId,
        action: 'SESSION_REVOKE',
        resourceType: 'refresh_session',
        resourceId: req.params.sessionId,
        familyId: req.user!.familyId,
        ipAddress: req.ip,
        metadata: { scope: 'child', childId: target.userId },
      });

      res.json({ success: true, data: { message: 'Device signed out' } });
    } catch (error) {
      next(error);
    }
  }
);
