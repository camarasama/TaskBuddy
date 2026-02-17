import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../middleware/errorHandler';
import { checkAndUnlockAchievements } from '../services/achievements';

export const rewardRouter = Router();

// All reward routes require authentication and family isolation
rewardRouter.use(authenticate, familyIsolation);

// Validation schemas
const createRewardSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  pointsCost: z.number().int().min(1).max(100000),
  tier: z.enum(['small', 'medium', 'large']).optional(),
  iconUrl: z.string().url().optional(),
  maxRedemptionsPerChild: z.number().int().min(1).optional(),
  expiresAt: z.string().datetime().optional(),
  isCollaborative: z.boolean().optional(),
});

const updateRewardSchema = createRewardSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// GET /rewards - List all rewards
rewardRouter.get('/', async (req, res, next) => {
  try {
    const { active } = req.query;

    const where: any = {
      familyId: req.familyId,
      deletedAt: null,
    };

    // Filter by active status
    if (active === 'true') {
      where.isActive = true;
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ];
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

    res.json({
      success: true,
      data: { rewards },
    });
  } catch (error) {
    next(error);
  }
});

// POST /rewards - Create a reward (parents only)
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

// GET /rewards/:id - Get a specific reward
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

    res.json({
      success: true,
      data: { reward },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /rewards/:id - Update a reward (parents only)
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

// DELETE /rewards/:id - Delete a reward (soft delete, parents only)
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

// POST /rewards/:id/redeem - Redeem a reward (children)
rewardRouter.post('/:id/redeem', async (req, res, next) => {
  try {
    // Only children can redeem rewards
    if (req.user!.role !== 'child') {
      throw new ForbiddenError('Only children can redeem rewards');
    }

    const reward = await prisma.reward.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        isActive: true,
        deletedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    if (!reward) {
      throw new NotFoundError('Reward not found or not available');
    }

    // Get child's profile
    const profile = await prisma.childProfile.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!profile) {
      throw new NotFoundError('Child profile not found');
    }

    // Check if child has enough points
    if (profile.pointsBalance < reward.pointsCost) {
      throw new ValidationError(`Not enough points. You have ${profile.pointsBalance} but need ${reward.pointsCost}`);
    }

    // Check max redemptions per child
    if (reward.maxRedemptionsPerChild) {
      const redemptionCount = await prisma.rewardRedemption.count({
        where: {
          rewardId: reward.id,
          childId: req.user!.userId,
          status: { not: 'cancelled' },
        },
      });

      if (redemptionCount >= reward.maxRedemptionsPerChild) {
        throw new ConflictError('Maximum redemptions reached for this reward');
      }
    }

    // Create redemption and deduct points in transaction
    const result = await prisma.$transaction(async (tx) => {
      const newBalance = profile.pointsBalance - reward.pointsCost;

      // Create redemption
      const redemption = await tx.rewardRedemption.create({
        data: {
          rewardId: reward.id,
          childId: req.user!.userId,
          pointsSpent: reward.pointsCost,
          status: 'pending',
        },
      });

      // Deduct points
      await tx.childProfile.update({
        where: { userId: req.user!.userId },
        data: { pointsBalance: newBalance },
      });

      // Create points ledger entry
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

    // Check and unlock any achievements earned (e.g., "First Reward")
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

// GET /rewards/redemptions - Get redemption history
rewardRouter.get('/redemptions/history', async (req, res, next) => {
  try {
    const where: any = {};

    if (req.user!.role === 'child') {
      where.childId = req.user!.userId;
    } else {
      // Parents see all family redemptions
      where.reward = {
        familyId: req.familyId,
      };
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

// PUT /rewards/redemptions/:id/fulfill - Mark redemption as fulfilled (parents only)
rewardRouter.put('/redemptions/:id/fulfill', requireParent, async (req, res, next) => {
  try {
    const redemption = await prisma.rewardRedemption.findFirst({
      where: {
        id: req.params.id,
        status: { in: ['pending', 'approved'] },
        reward: {
          familyId: req.familyId,
        },
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

// PUT /rewards/redemptions/:id/cancel - Cancel a redemption
rewardRouter.put('/redemptions/:id/cancel', async (req, res, next) => {
  try {
    const redemption = await prisma.rewardRedemption.findFirst({
      where: {
        id: req.params.id,
        status: 'pending',
        reward: {
          familyId: req.familyId,
        },
      },
      include: { reward: true },
    });

    if (!redemption) {
      throw new NotFoundError('Pending redemption not found');
    }

    // Children can only cancel their own redemptions
    if (req.user!.role === 'child' && redemption.childId !== req.user!.userId) {
      throw new ForbiddenError('Cannot cancel another child\'s redemption');
    }

    // Refund points and cancel in transaction
    await prisma.$transaction(async (tx) => {
      // Get current balance
      const profile = await tx.childProfile.findUnique({
        where: { userId: redemption.childId },
      });

      const newBalance = profile!.pointsBalance + redemption.pointsSpent;

      // Cancel redemption
      await tx.rewardRedemption.update({
        where: { id: req.params.id },
        data: { status: 'cancelled' },
      });

      // Refund points
      await tx.childProfile.update({
        where: { userId: redemption.childId },
        data: { pointsBalance: newBalance },
      });

      // Create refund ledger entry
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
