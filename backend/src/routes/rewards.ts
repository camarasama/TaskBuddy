/**
 * rewards.ts — Backend route (updated M10 Phase 5 — Socket.io + In-app Notifications)
 *
 * Changes from M10 Phase 5 (this file):
 *  - POST /:id/redeem: createNotification() confirms redemption in child's bell.
 *    SocketService.emitPointsUpdated() pushes new balance live.
 *  - PUT /redemptions/:id/fulfill: createNotification() + SocketService tell
 *    the child instantly their reward has been fulfilled.
 *
 * Previous M9 (from M8):
 *  - POST /:id/redeem: EmailService.sendToFamilyParents() for reward_redeemed.
 *  All other routes unchanged from M8.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../middleware/errorHandler';
import { checkAndUnlockAchievements } from '../services/achievements';
import { checkRedemptionCaps, getRewardCapData } from '../utils/rewardCaps';
// M8 — Audit logging for all mutating reward routes
import { AuditService } from '../services/AuditService';
// M9 — Email notifications
import { EmailService } from '../services/email';
// M10 — Phase 4: In-app notification bell
import { createNotification } from './notifications';
// M10 — Phase 5: Real-time socket events
import { SocketService } from '../services/SocketService';

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
  // M6 — CR-11: per-child cap
  maxRedemptionsPerChild: z.number().int().min(1).optional(),
  // M6 — CR-11: household cap
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

    const childId = req.user!.role === 'child' ? req.user!.userId : null;

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

    // M8 — Audit: reward created
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'reward',
      resourceId: reward.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { name: reward.name, pointsCost: reward.pointsCost, tier: reward.tier },
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

    // M8 — Audit: reward updated
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'reward',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { changes: req.body },
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

    // M8 — Audit: reward soft-deleted
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'DELETE',
      resourceType: 'reward',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { name: reward.name, pointsCost: reward.pointsCost },
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
    if (req.user!.role !== 'child') {
      throw new ForbiddenError('Only children can redeem rewards');
    }

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

    if (!reward.isActive) {
      throw new ConflictError('This reward is no longer available.');
    }

    // ── M6: Three-gate cap check ────────────────────────────────────────────
    const capCheck = await checkRedemptionCaps(reward.id, req.user!.userId, {
      expiresAt: reward.expiresAt,
      maxRedemptionsTotal: reward.maxRedemptionsTotal,
      maxRedemptionsPerChild: reward.maxRedemptionsPerChild,
    });

    if (!capCheck.allowed) {
      throw new ConflictError(capCheck.reason!);
    }

    const profile = await prisma.childProfile.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!profile) {
      throw new NotFoundError('Child profile not found');
    }

    if (profile.pointsBalance < reward.pointsCost) {
      throw new ValidationError(
        `Not enough points. You have ${profile.pointsBalance} but need ${reward.pointsCost}`
      );
    }

    // Fetch the child's name for the email (profile doesn't include it)
    const child = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { firstName: true, lastName: true },
    });

    // Create redemption and deduct points in a single transaction
    const result = await prisma.$transaction(async (tx) => {
      const newBalance = profile.pointsBalance - reward.pointsCost;

      const redemption = await tx.rewardRedemption.create({
        data: {
          rewardId: reward.id,
          childId: req.user!.userId,
          pointsSpent: reward.pointsCost,
          status: 'pending',
        },
      });

      await tx.childProfile.update({
        where: { userId: req.user!.userId },
        data: { pointsBalance: newBalance },
      });

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

    const unlockedAchievements = await checkAndUnlockAchievements(req.user!.userId);

    // M8 — Audit: reward redeemed by child
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'REDEEM',
      resourceType: 'reward_redemption',
      resourceId: result.redemption.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: {
        rewardId: reward.id,
        rewardName: reward.name,
        pointsSpent: reward.pointsCost,
        newBalance: result.newBalance,
      },
    });

    // M9 — Reward redeemed email: notify all parents so they can arrange fulfilment.
    // Respects the 'reward_redeemed' notification preference (CR-08).
    EmailService.sendToFamilyParents({
      familyId: req.familyId!,
      triggerType: 'reward_redeemed',
      subjectBuilder: () =>
        `${child?.firstName ?? 'A child'} redeemed "${reward.name}"`,
      templateData: {
        childName: child?.firstName ?? 'A child',
        rewardName: reward.name,
        pointsSpent: reward.pointsCost,
        newBalance: result.newBalance,
        redemptionId: result.redemption.id,
      },
      referenceType: 'reward_redemption',
      referenceId: result.redemption.id,
    }).catch((err) =>
      console.error('[rewards/redeem] reward_redeemed email failed (non-fatal):', err?.message)
    );

    // M10 — Phase 4: Confirm redemption in the child's notification bell
    createNotification({
      userId: req.user!.userId,
      notificationType: 'reward_redeemed',
      title: '🎁 Reward Redeemed!',
      message: `You redeemed "${reward.name}" for ${reward.pointsCost} pts. A parent will arrange fulfilment soon!`,
      actionUrl: `/child/rewards`,
      referenceType: 'reward_redemption',
      referenceId: result.redemption.id,
    }).catch(() => {}); // non-fatal

    // M10 — Phase 5: Push updated points balance live so the child's header refreshes instantly
    SocketService.emitPointsUpdated(req.familyId!, {
      childId: req.user!.userId,
      newBalance: result.newBalance,
      delta: -reward.pointsCost,
      reason: 'reward_redeemed',
    });

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

    // M8 — Audit: redemption fulfilled by parent
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'FULFILL',
      resourceType: 'reward_redemption',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { childId: redemption.childId, rewardId: redemption.rewardId },
    });

    // M10 — Phase 4: Notify the child their reward was fulfilled
    createNotification({
      userId: redemption.childId,
      notificationType: 'reward_fulfilled',
      title: '✅ Reward Delivered!',
      message: `Your reward has been fulfilled by your parent. Enjoy! 🎉`,
      actionUrl: `/child/rewards`,
      referenceType: 'reward_redemption',
      referenceId: req.params.id,
    }).catch(() => {}); // non-fatal

    // M10 — Phase 5: Socket event → child's bell updates instantly without polling
    SocketService.emitNotificationNew(redemption.childId, {
      notificationType: 'reward_fulfilled',
      title: '✅ Reward Delivered!',
      message: `Your reward has been fulfilled by your parent. Enjoy! 🎉`,
      referenceType: 'reward_redemption',
      referenceId: req.params.id,
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

    if (req.user!.role === 'child' && redemption.childId !== req.user!.userId) {
      throw new ForbiddenError("Cannot cancel another child's redemption");
    }

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

    // M8 — Audit: redemption cancelled
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CANCEL',
      resourceType: 'reward_redemption',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: {
        childId: redemption.childId,
        rewardId: redemption.rewardId,
        pointsRefunded: redemption.pointsSpent,
        cancelledBy: req.user!.role,
      },
    });

    res.json({
      success: true,
      data: { message: 'Redemption cancelled and points refunded' },
    });
  } catch (error) {
    next(error);
  }
});