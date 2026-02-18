/**
 * rewards.ts — Backend route (updated M6)
 *
 * Changes from M6 (CR-11 — Reward Triple Cap):
 *  - createRewardSchema and updateRewardSchema now include maxRedemptionsTotal
 *  - GET / and GET /:id append computed cap fields (isSoldOut, isExpired, remainingTotal, remainingForChild)
 *  - POST /:id/redeem now delegates all cap logic to checkRedemptionCaps() utility
 *    (three distinct 409 messages instead of a silent 404 for expired/sold-out rewards)
 *  - Nightly deactivation of exhausted/expired rewards is handled by scheduler.ts (new file)
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../middleware/errorHandler';
import { checkAndUnlockAchievements } from '../services/achievements';
import { checkRedemptionCaps, getRewardCapData } from '../utils/rewardCaps';

export const rewardRouter = Router();

// All reward routes require authentication and family isolation
rewardRouter.use(authenticate, familyIsolation);

// ─── Validation schemas ───────────────────────────────────────────────────────

const createRewardSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  pointsCost: z.number().int().min(1).max(100000),
  tier: z.enum(['small', 'medium', 'large']).optional(),
  iconUrl: z.string().url().optional(),
  // M6 — CR-11: per-child cap (how many times one child can claim this reward)
  maxRedemptionsPerChild: z.number().int().min(1).optional(),
  // M6 — CR-11: household cap (total claims across all children combined)
  maxRedemptionsTotal: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
  isCollaborative: z.boolean().optional(),
});

const updateRewardSchema = createRewardSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ─── GET /rewards — List all rewards ─────────────────────────────────────────

rewardRouter.get('/', async (req, res, next) => {
  try {
    const { active } = req.query;

    const where: any = {
      familyId: req.familyId,
      deletedAt: null,
    };

    // When active=true, filter out inactive rewards.
    // Note: We no longer filter by expiresAt here — we let the reward through and
    // mark it as isExpired in the computed fields so the frontend can show a badge.
    if (active === 'true') {
      where.isActive = true;
    }

    const rewards = await prisma.reward.findMany({
      where,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true },
        },
        _count: {
          select: { redemptions: true },
        },
      },
      orderBy: [
        { tier: 'asc' },
        { pointsCost: 'asc' },
      ],
    });

    // Determine the requesting child's id (null for parent callers)
    const childId = req.user!.role === 'child' ? req.user!.userId : null;

    // Append computed cap data to every reward in the list
    const rewardsWithCapData = await Promise.all(
      rewards.map(async (reward) => {
        const capData = await getRewardCapData(reward.id, childId, {
          maxRedemptionsTotal: reward.maxRedemptionsTotal,
          maxRedemptionsPerChild: reward.maxRedemptionsPerChild,
          expiresAt: reward.expiresAt,
          isActive: reward.isActive,
        });
        return { ...reward, ...capData };
      })
    );

    res.json({
      success: true,
      data: { rewards: rewardsWithCapData },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /rewards — Create a reward (parents only) ──────────────────────────

rewardRouter.post('/', requireParent, validateBody(createRewardSchema), async (req, res, next) => {
  try {
    const { expiresAt, ...data } = req.body;

    const reward = await prisma.reward.create({
      data: {
        ...data,
        familyId: req.familyId!,
        createdBy: req.user!.userId,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      },
    });

    res.status(201).json({
      success: true,
      data: { reward },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /rewards/:id — Get a specific reward ─────────────────────────────────

rewardRouter.get('/:id', async (req, res, next) => {
  try {
    const reward = await prisma.reward.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        deletedAt: null,
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true },
        },
        redemptions: {
          include: {
            child: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!reward) {
      throw new NotFoundError('Reward not found');
    }

    // Append computed cap fields for the detail view
    const childId = req.user!.role === 'child' ? req.user!.userId : null;
    const capData = await getRewardCapData(reward.id, childId, {
      maxRedemptionsTotal: reward.maxRedemptionsTotal,
      maxRedemptionsPerChild: reward.maxRedemptionsPerChild,
      expiresAt: reward.expiresAt,
      isActive: reward.isActive,
    });

    res.json({
      success: true,
      data: { reward: { ...reward, ...capData } },
    });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /rewards/:id — Update a reward (parents only) ───────────────────────

rewardRouter.put('/:id', requireParent, validateBody(updateRewardSchema), async (req, res, next) => {
  try {
    const reward = await prisma.reward.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        deletedAt: null,
      },
    });

    if (!reward) {
      throw new NotFoundError('Reward not found');
    }

    const { expiresAt, ...data } = req.body;

    const updated = await prisma.reward.update({
      where: { id: req.params.id },
      data: {
        ...data,
        expiresAt: expiresAt === null ? null : expiresAt ? new Date(expiresAt) : undefined,
      },
    });

    res.json({
      success: true,
      data: { reward: updated },
    });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /rewards/:id — Soft delete (parents only) ────────────────────────

rewardRouter.delete('/:id', requireParent, async (req, res, next) => {
  try {
    const reward = await prisma.reward.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        deletedAt: null,
      },
    });

    if (!reward) {
      throw new NotFoundError('Reward not found');
    }

    await prisma.reward.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });

    res.json({
      success: true,
      data: { message: 'Reward deleted' },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /rewards/:id/redeem — Redeem a reward (children only) ──────────────

rewardRouter.post('/:id/redeem', async (req, res, next) => {
  try {
    // Only children can redeem rewards
    if (req.user!.role !== 'child') {
      throw new ForbiddenError('Only children can redeem rewards');
    }

    // Fetch the reward WITHOUT filtering by expiresAt or isActive — we run explicit
    // cap checks via checkRedemptionCaps() so we can return specific error messages
    // instead of a generic 404.
    const reward = await prisma.reward.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        deletedAt: null,
      },
    });

    if (!reward) {
      throw new NotFoundError('Reward not found');
    }

    // Guard: reward must still be active (parent manually deactivated it)
    if (!reward.isActive) {
      throw new ConflictError('This reward is no longer available.');
    }

    // ── M6: Three-gate cap check ────────────────────────────────────────────
    // Gate 1: expiry  |  Gate 2: household total cap  |  Gate 3: per-child cap
    const capCheck = await checkRedemptionCaps(reward.id, req.user!.userId, {
      expiresAt: reward.expiresAt,
      maxRedemptionsTotal: reward.maxRedemptionsTotal,
      maxRedemptionsPerChild: reward.maxRedemptionsPerChild,
    });

    if (!capCheck.allowed) {
      throw new ConflictError(capCheck.reason!);
    }

    // Get child's profile to check points balance
    const profile = await prisma.childProfile.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!profile) {
      throw new NotFoundError('Child profile not found');
    }

    // Check if child has enough points
    if (profile.pointsBalance < reward.pointsCost) {
      throw new ValidationError(
        `Not enough points. You have ${profile.pointsBalance} but need ${reward.pointsCost}`
      );
    }

    // Create redemption and deduct points in a single transaction
    const result = await prisma.$transaction(async (tx) => {
      const newBalance = profile.pointsBalance - reward.pointsCost;

      // Create redemption record
      const redemption = await tx.rewardRedemption.create({
        data: {
          rewardId: reward.id,
          childId: req.user!.userId,
          pointsSpent: reward.pointsCost,
          status: 'pending',
        },
      });

      // Deduct points from child's balance
      await tx.childProfile.update({
        where: { userId: req.user!.userId },
        data: { pointsBalance: newBalance },
      });

      // Record the deduction in the points ledger
      await tx.pointsLedger.create({
        data: {
          childId: req.user!.userId,
          transactionType: 'redeemed',
          pointsAmount: -reward.pointsCost,
          balanceAfter: newBalance,
          referenceType: 'reward_redemption',
          referenceId: redemption.id,
          description: `Redeemed: ${reward.name}`,
        },
      });

      return { redemption, newBalance };
    });

    // Check whether this redemption unlocked any achievements (e.g., "First Reward")
    const unlockedAchievements = await checkAndUnlockAchievements(req.user!.userId);

    res.status(201).json({
      success: true,
      data: {
        redemptionId: result.redemption.id,
        pointsSpent: reward.pointsCost,
        newBalance: result.newBalance,
        unlockedAchievements,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /rewards/redemptions/history — Redemption history ───────────────────

rewardRouter.get('/redemptions/history', async (req, res, next) => {
  try {
    const where: any = {};

    if (req.user!.role === 'child') {
      where.childId = req.user!.userId;
    } else {
      // Parents see all redemptions across the family
      where.reward = { familyId: req.familyId };
    }

    const redemptions = await prisma.rewardRedemption.findMany({
      where,
      include: {
        reward: true,
        child: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: { redemptions },
    });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /rewards/redemptions/:id/fulfill — Mark as fulfilled (parents only) ──

rewardRouter.put('/redemptions/:id/fulfill', requireParent, async (req, res, next) => {
  try {
    const redemption = await prisma.rewardRedemption.findFirst({
      where: {
        id: req.params.id,
        status: { in: ['pending', 'approved'] },
        reward: { familyId: req.familyId },
      },
    });

    if (!redemption) {
      throw new NotFoundError('Redemption not found');
    }

    const updated = await prisma.rewardRedemption.update({
      where: { id: req.params.id },
      data: {
        status: 'fulfilled',
        fulfilledAt: new Date(),
        approvedBy: req.user!.userId,
        approvedAt: redemption.approvedAt || new Date(),
      },
    });

    res.json({
      success: true,
      data: { redemption: updated },
    });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /rewards/redemptions/:id/cancel — Cancel a redemption ───────────────

rewardRouter.put('/redemptions/:id/cancel', async (req, res, next) => {
  try {
    const redemption = await prisma.rewardRedemption.findFirst({
      where: {
        id: req.params.id,
        status: 'pending',
        reward: { familyId: req.familyId },
      },
      include: { reward: true },
    });

    if (!redemption) {
      throw new NotFoundError('Pending redemption not found');
    }

    // Children can only cancel their own redemptions
    if (req.user!.role === 'child' && redemption.childId !== req.user!.userId) {
      throw new ForbiddenError("Cannot cancel another child's redemption");
    }

    // Refund points and cancel in a single transaction
    await prisma.$transaction(async (tx) => {
      const profile = await tx.childProfile.findUnique({
        where: { userId: redemption.childId },
      });

      const newBalance = profile!.pointsBalance + redemption.pointsSpent;

      await tx.rewardRedemption.update({
        where: { id: req.params.id },
        data: { status: 'cancelled' },
      });

      await tx.childProfile.update({
        where: { userId: redemption.childId },
        data: { pointsBalance: newBalance },
      });

      await tx.pointsLedger.create({
        data: {
          childId: redemption.childId,
          transactionType: 'adjustment',
          pointsAmount: redemption.pointsSpent,
          balanceAfter: newBalance,
          referenceType: 'reward_cancellation',
          referenceId: redemption.id,
          description: `Refund: ${redemption.reward.name} (cancelled)`,
        },
      });
    });

    res.json({
      success: true,
      data: { message: 'Redemption cancelled and points refunded' },
    });
  } catch (error) {
    next(error);
  }
});