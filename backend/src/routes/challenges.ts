/**
 * routes/challenges.ts — daily challenges (FR-08). Mounted at /api/v1/challenges.
 *
 *   GET  /challenges/today          - today's challenge for the caller's family + the child's progress
 *   POST /challenges/:id/complete   - claim the bonus (child only; server re-verifies eligibility)
 */

import { Router } from 'express';
import { authenticate, requireChild, familyIsolation } from '../middleware/auth';
import {
  getTodayChallenge,
  completeChallenge,
  ChallengeNotMetError,
} from '../services/ChallengeService';
import { AuditService } from '../services/AuditService';

export const challengeRouter = Router();

challengeRouter.use(authenticate, familyIsolation);

// GET /challenges/today — visible to any family member; progress is the requesting child's.
challengeRouter.get('/today', async (req, res, next) => {
  try {
    const data = await getTodayChallenge(req.familyId!, req.user!.userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /challenges/:id/complete — child claims the bonus. Eligibility is checked server-side, so a
// forged request cannot award points the child hasn't earned.
challengeRouter.post('/:id/complete', requireChild, async (req, res, next) => {
  try {
    const result = await completeChallenge(req.params.id, req.user!.userId, req.familyId!);

    if (!result.alreadyClaimed) {
      await AuditService.logAction({
        actorId: req.user!.userId,
        action: 'CHALLENGE_COMPLETED',
        resourceType: 'daily_challenge',
        resourceId: req.params.id,
        familyId: req.familyId,
        ipAddress: req.ip,
        metadata: { bonusAwarded: result.awarded },
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ChallengeNotMetError) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'CHALLENGE_NOT_MET',
          message: error.message,
          details: { done: error.done, target: error.target },
        },
      });
    }
    next(error);
  }
});
