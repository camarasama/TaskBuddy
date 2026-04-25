import { prisma } from './database';
import { checkAndUnlockAchievements } from './achievements';
import { AuditService } from './AuditService';
import { EmailService } from './email';
import { SocketService } from './SocketService';
import { createNotification } from '../routes/notifications';
import { checkRedemptionCaps, getRewardCapData } from '../utils/rewardCaps';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/errorHandler';

interface RedeemParams {
  rewardId: string;
  familyId: string;
  childId: string;
  ipAddress?: string;
}

export class RewardService {
  static async getCapData(
    rewardId: string,
    childId: string | null,
    caps: {
      maxRedemptionsTotal: number | null;
      maxRedemptionsPerChild: number | null;
      expiresAt: Date | null;
      isActive: boolean;
    }
  ) {
    return getRewardCapData(rewardId, childId, caps);
  }

  static async redeem(params: RedeemParams) {
    const { rewardId, familyId, childId, ipAddress } = params;

    const reward = await prisma.reward.findFirst({
      where: { id: rewardId, familyId, deletedAt: null },
    });

    if (!reward) throw new NotFoundError('Reward not found');
    if (!reward.isActive) throw new ConflictError('This reward is no longer available.');

    const capCheck = await checkRedemptionCaps(reward.id, childId, {
      expiresAt: reward.expiresAt,
      maxRedemptionsTotal: reward.maxRedemptionsTotal,
      maxRedemptionsPerChild: reward.maxRedemptionsPerChild,
    });

    if (!capCheck.allowed) throw new ConflictError(capCheck.reason!);

    const profile = await prisma.childProfile.findUnique({ where: { userId: childId } });
    if (!profile) throw new NotFoundError('Child profile not found');

    if (profile.pointsBalance < reward.pointsCost) {
      throw new ValidationError(
        `Not enough points. You have ${profile.pointsBalance} but need ${reward.pointsCost}`
      );
    }

    const child = await prisma.user.findUnique({
      where: { id: childId },
      select: { firstName: true, lastName: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      const newBalance = profile.pointsBalance - reward.pointsCost;

      const redemption = await tx.rewardRedemption.create({
        data: { rewardId: reward.id, childId, pointsSpent: reward.pointsCost, status: 'pending' },
      });

      await tx.childProfile.update({
        where: { userId: childId },
        data: { pointsBalance: newBalance },
      });

      await tx.pointsLedger.create({
        data: {
          childId,
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

    const unlockedAchievements = await checkAndUnlockAchievements(childId);

    await AuditService.logAction({
      actorId: childId,
      action: 'REDEEM',
      resourceType: 'reward_redemption',
      resourceId: result.redemption.id,
      familyId,
      ipAddress,
      metadata: {
        rewardId: reward.id,
        rewardName: reward.name,
        pointsSpent: reward.pointsCost,
        newBalance: result.newBalance,
      },
    });

    EmailService.sendToFamilyParents({
      familyId,
      triggerType: 'reward_redeemed',
      subjectBuilder: () => `${child?.firstName ?? 'A child'} redeemed "${reward.name}"`,
      templateData: {
        childName: child?.firstName ?? 'A child',
        rewardName: reward.name,
        pointsSpent: reward.pointsCost,
        newBalance: result.newBalance,
        redemptionId: result.redemption.id,
      },
      referenceType: 'reward_redemption',
      referenceId: result.redemption.id,
    }).catch((err: any) =>
      console.error('[RewardService/redeem] reward_redeemed email failed:', err?.message)
    );

    createNotification({
      userId: childId,
      notificationType: 'reward_redeemed',
      title: '🎁 Reward Redeemed!',
      message: `You redeemed "${reward.name}" for ${reward.pointsCost} pts. A parent will arrange fulfilment soon!`,
      actionUrl: '/child/rewards',
      referenceType: 'reward_redemption',
      referenceId: result.redemption.id,
    }).catch(() => {});

    SocketService.emitPointsUpdated(familyId, {
      childId,
      newBalance: result.newBalance,
      delta: -reward.pointsCost,
      reason: 'reward_redeemed',
    });

    return {
      redemptionId: result.redemption.id,
      pointsSpent: reward.pointsCost,
      newBalance: result.newBalance,
      unlockedAchievements,
    };
  }

  static async runNightlyExpiry(): Promise<void> {
    const now = new Date();

    const expiredResult = await prisma.reward.updateMany({
      where: { isActive: true, deletedAt: null, expiresAt: { lte: now } },
      data: { isActive: false },
    });

    if (expiredResult.count > 0) {
      console.log(`[RewardService] Deactivated ${expiredResult.count} expired reward(s)`);
    }

    const cappedCandidates = await prisma.reward.findMany({
      where: { isActive: true, deletedAt: null, maxRedemptionsTotal: { not: null } },
      select: {
        id: true,
        maxRedemptionsTotal: true,
        _count: { select: { redemptions: { where: { status: { not: 'cancelled' } } } } },
      },
    });

    const soldOutIds = cappedCandidates
      .filter((r) => r._count.redemptions >= r.maxRedemptionsTotal!)
      .map((r) => r.id);

    if (soldOutIds.length > 0) {
      await prisma.reward.updateMany({
        where: { id: { in: soldOutIds } },
        data: { isActive: false },
      });
      console.log(`[RewardService] Deactivated ${soldOutIds.length} sold-out reward(s)`);
    }
  }
}
