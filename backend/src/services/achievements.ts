import { prisma } from './database';
import { GAMIFICATION } from '@taskbuddy/shared';

/**
 * Calculate the child's level from their total XP.
 * Level formula: XP needed for level N = BASE_XP * N^GROWTH_FACTOR
 */
function calculateLevel(totalXp: number): number {
  const { BASE_XP, GROWTH_FACTOR, MAX_LEVEL } = GAMIFICATION.LEVEL;
  let level = 1;
  let xpNeeded = 0;

  while (level < MAX_LEVEL) {
    xpNeeded += Math.floor(BASE_XP * Math.pow(level, GROWTH_FACTOR));
    if (totalXp < xpNeeded) break;
    level++;
  }

  return level;
}

interface UnlockedAchievement {
  id: string;
  name: string;
  pointsReward: number;
  xpReward: number;
}

/**
 * Check and unlock any achievements the child has earned.
 * Call this after task approval, reward redemption, or any other event
 * that could trigger an achievement.
 *
 * Returns the list of newly unlocked achievements.
 */
export async function checkAndUnlockAchievements(childId: string): Promise<UnlockedAchievement[]> {
  // Fetch child profile
  const profile = await prisma.childProfile.findUnique({
    where: { userId: childId },
  });

  if (!profile) return [];

  // Fetch all achievements not yet unlocked by this child
  const alreadyUnlocked = await prisma.childAchievement.findMany({
    where: { childId },
    select: { achievementId: true },
  });

  const unlockedIds = new Set(alreadyUnlocked.map((a) => a.achievementId));

  const allAchievements = await prisma.achievement.findMany();
  const lockedAchievements = allAchievements.filter((a) => !unlockedIds.has(a.id));

  if (lockedAchievements.length === 0) return [];

  // Build current stats for checking criteria
  const currentLevel = calculateLevel(profile.experiencePoints);

  // Count total reward redemptions (non-cancelled)
  const redemptionCount = await prisma.rewardRedemption.count({
    where: {
      childId,
      status: { not: 'cancelled' },
    },
  });

  // Check each locked achievement
  const newlyUnlocked: UnlockedAchievement[] = [];

  for (const achievement of lockedAchievements) {
    const criteriaType = achievement.unlockCriteriaType;
    const criteriaValue = achievement.unlockCriteriaValue;

    if (!criteriaType || criteriaValue == null) continue;

    let met = false;

    switch (criteriaType) {
      case 'tasks_completed':
        met = profile.totalTasksCompleted >= criteriaValue;
        break;

      case 'streak_days':
        // Check both current streak and longest streak
        met = profile.currentStreakDays >= criteriaValue || profile.longestStreakDays >= criteriaValue;
        break;

      case 'points_earned':
        met = profile.totalPointsEarned >= criteriaValue;
        break;

      case 'level_reached':
        met = currentLevel >= criteriaValue;
        break;

      case 'rewards_redeemed':
        met = redemptionCount >= criteriaValue;
        break;

      // Special achievements - these need contextual triggers
      // early_completion and perfect_week are checked separately
      // when the relevant event occurs
      case 'early_completion':
      case 'perfect_week':
        // These are not checked here - they need special event context
        break;

      default:
        break;
    }

    if (met) {
      newlyUnlocked.push({
        id: achievement.id,
        name: achievement.name,
        pointsReward: achievement.pointsReward,
        xpReward: achievement.xpReward,
      });
    }
  }

  if (newlyUnlocked.length === 0) return [];

  // Create ChildAchievement records and award bonus points/XP
  let totalBonusPoints = 0;
  let totalBonusXp = 0;

  for (const achievement of newlyUnlocked) {
    await prisma.childAchievement.create({
      data: {
        childId,
        achievementId: achievement.id,
        progressValue: 100,
      },
    });

    totalBonusPoints += achievement.pointsReward;
    totalBonusXp += achievement.xpReward;
  }

  // Award bonus points and XP from achievements
  if (totalBonusPoints > 0 || totalBonusXp > 0) {
    const updatedProfile = await prisma.childProfile.update({
      where: { userId: childId },
      data: {
        pointsBalance: { increment: totalBonusPoints },
        totalPointsEarned: { increment: totalBonusPoints },
        experiencePoints: { increment: totalBonusXp },
      },
    });

    // Create ledger entry for achievement bonus points
    if (totalBonusPoints > 0) {
      await prisma.pointsLedger.create({
        data: {
          childId,
          transactionType: 'earned',
          pointsAmount: totalBonusPoints,
          balanceAfter: updatedProfile.pointsBalance,
          referenceType: 'achievement_bonus',
          referenceId: newlyUnlocked.map((a) => a.id).join(','),
          description: `Achievement bonus: ${newlyUnlocked.map((a) => a.name).join(', ')}`,
        },
      });
    }
  }

  return newlyUnlocked;
}

/**
 * Check and unlock the "Early Bird" achievement.
 * Call this when a task is completed before 9 AM.
 */
export async function checkEarlyBirdAchievement(childId: string): Promise<UnlockedAchievement | null> {
  const achievement = await prisma.achievement.findFirst({
    where: { unlockCriteriaType: 'early_completion' },
  });

  if (!achievement) return null;

  // Check if already unlocked
  const existing = await prisma.childAchievement.findUnique({
    where: { childId_achievementId: { childId, achievementId: achievement.id } },
  });

  if (existing) return null;

  // Unlock it
  await prisma.childAchievement.create({
    data: {
      childId,
      achievementId: achievement.id,
      progressValue: 100,
    },
  });

  // Award bonus
  if (achievement.pointsReward > 0 || achievement.xpReward > 0) {
    const updatedProfile = await prisma.childProfile.update({
      where: { userId: childId },
      data: {
        pointsBalance: { increment: achievement.pointsReward },
        totalPointsEarned: { increment: achievement.pointsReward },
        experiencePoints: { increment: achievement.xpReward },
      },
    });

    if (achievement.pointsReward > 0) {
      await prisma.pointsLedger.create({
        data: {
          childId,
          transactionType: 'earned',
          pointsAmount: achievement.pointsReward,
          balanceAfter: updatedProfile.pointsBalance,
          referenceType: 'achievement_bonus',
          referenceId: achievement.id,
          description: `Achievement bonus: ${achievement.name}`,
        },
      });
    }
  }

  return {
    id: achievement.id,
    name: achievement.name,
    pointsReward: achievement.pointsReward,
    xpReward: achievement.xpReward,
  };
}
