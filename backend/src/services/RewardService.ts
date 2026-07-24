import { prisma } from './database';
import { checkAndUnlockAchievements } from './achievements';
import { AuditService } from './AuditService';
import { EmailService } from './email';
import { SocketService } from './SocketService';
import { WebhookService } from './WebhookService';
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

    // FR-18: outbound webhook. Detached — a third-party endpoint must never delay or fail a
    // redemption. Carries no data the family doesn't already own.
    WebhookService.dispatchDetached(familyId, 'reward.redeemed', {
      redemptionId: result.redemption.id,
      childId,
      childName: child?.firstName ?? null,
      rewardId: reward.id,
      rewardName: reward.name,
      pointsSpent: reward.pointsCost,
      newBalance: result.newBalance,
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

  /**
   * FR-09 — a child contributes points toward a collaborative (pooled) reward.
   *
   * Debits the child's balance immediately via an append-only ledger row (consistent with how
   * redemption spends points), records the contribution, and — when the running total first reaches
   * pointsCost — auto-fulfils the reward for the family exactly once.
   *
   * Once-only fulfilment under concurrency: rather than read-then-write (which two racing
   * contributions could both pass), we claim fulfilment with a conditional updateMany on
   * `collaborativeFulfilledAt: null` and act only if we were the one row that flipped it.
   */
  static async contribute(params: {
    rewardId: string;
    familyId: string;
    childId: string;
    points: number;
    ipAddress?: string;
  }) {
    const { rewardId, familyId, childId, points, ipAddress } = params;

    if (points <= 0) throw new ValidationError('Contribution must be a positive number of points.');

    const reward = await prisma.reward.findFirst({
      where: { id: rewardId, familyId, deletedAt: null },
    });
    if (!reward) throw new NotFoundError('Reward not found');
    if (!reward.isCollaborative) throw new ConflictError('This reward is not collaborative.');
    if (!reward.isActive) throw new ConflictError('This reward is no longer available.');
    if (reward.collaborativeFulfilledAt) {
      throw new ConflictError('This reward has already been fully funded.');
    }

    const profile = await prisma.childProfile.findUnique({ where: { userId: childId } });
    if (!profile) throw new NotFoundError('Child profile not found');
    if (profile.pointsBalance < points) {
      throw new ValidationError(
        `Not enough points. You have ${profile.pointsBalance} but tried to contribute ${points}.`
      );
    }

    // Don't let a child overshoot the goal — cap the contribution at what's still needed.
    const priorTotal = await prisma.rewardContribution.aggregate({
      where: { rewardId },
      _sum: { points: true },
    });
    const alreadyPooled = priorTotal._sum.points ?? 0;
    const remaining = reward.pointsCost - alreadyPooled;
    if (remaining <= 0) throw new ConflictError('This reward has already been fully funded.');
    const applied = Math.min(points, remaining);

    const result = await prisma.$transaction(async (tx) => {
      const newBalance = profile.pointsBalance - applied;

      await tx.rewardContribution.create({ data: { rewardId, childId, points: applied } });

      await tx.childProfile.update({
        where: { userId: childId },
        data: { pointsBalance: newBalance },
      });

      await tx.pointsLedger.create({
        data: {
          childId,
          transactionType: 'redeemed',
          pointsAmount: -applied,
          balanceAfter: newBalance,
          referenceType: 'reward_contribution',
          referenceId: rewardId,
          description: `Contributed ${applied} to: ${reward.name}`,
        },
      });

      const pooledNow = alreadyPooled + applied;
      let fulfilled = false;
      if (pooledNow >= reward.pointsCost) {
        // Atomic claim: only the transaction that flips null → now wins the fulfilment.
        const claim = await tx.reward.updateMany({
          where: { id: rewardId, collaborativeFulfilledAt: null },
          data: { collaborativeFulfilledAt: new Date() },
        });
        fulfilled = claim.count === 1;
      }

      return { applied, newBalance, pooledNow, fulfilled };
    });

    await AuditService.logAction({
      actorId: childId,
      action: result.fulfilled ? 'REWARD_FUNDED' : 'REWARD_CONTRIBUTE',
      resourceType: 'reward',
      resourceId: rewardId,
      familyId,
      ipAddress,
      metadata: { applied: result.applied, pooled: result.pooledNow, goal: reward.pointsCost },
    });

    if (result.fulfilled) {
      EmailService.sendToFamilyParents({
        familyId,
        triggerType: 'reward_redeemed',
        subjectBuilder: () => `The family reward "${reward.name}" is fully funded!`,
        templateData: { rewardName: reward.name, pointsCost: reward.pointsCost },
        referenceType: 'reward',
        referenceId: rewardId,
      }).catch((err: { message?: string }) =>
        console.error('[RewardService.contribute] funded email failed:', err?.message)
      );
    }

    return {
      applied: result.applied,
      newBalance: result.newBalance,
      pooled: result.pooledNow,
      goal: reward.pointsCost,
      fulfilled: result.fulfilled,
    };
  }

}
