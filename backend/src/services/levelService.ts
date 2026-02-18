/**
 * levelService.ts — M7: Level-up detection and milestone bonus (CR-06)
 *
 * Place this file at: backend/src/services/levelService.ts
 *
 * Called after every XP award (task approval, auto-approve).
 * Compares the child's old level to their new level after XP is added.
 * If they levelled up, creates a PointsLedger entry of type "milestone_bonus"
 * for (newLevel × LEVEL_MULTIPLIER) Points and updates pointsBalance.
 *
 * This service does NOT award XP itself — that happens in the approval route.
 * It only handles the downstream level-up bonus Points logic.
 */

import { prisma } from './database';
import { calculateLevelFromXp, GAMIFICATION_M7 } from '../utils/gamification';

/**
 * Checks if a child levelled up after a recent XP award.
 * If they did, awards milestone bonus Points and returns the new level.
 *
 * @param childId    - The child's user ID
 * @param oldLevel   - The level BEFORE the XP was added (read before update)
 * @param tx         - Optional Prisma transaction client (pass when called inside $transaction)
 *
 * @returns { leveledUp, oldLevel, newLevel, bonusPointsAwarded }
 */
export async function checkAndApplyLevelUp(
  childId: string,
  oldLevel: number,
  tx?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<{
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  bonusPointsAwarded: number;
}> {
  const db = tx ?? prisma;

  // Re-read the updated profile so we have the latest totalXpEarned
  const profile = await db.childProfile.findUnique({
    where: { userId: childId },
    select: {
      totalXpEarned: true,
      level: true,
      pointsBalance: true,
    },
  });

  if (!profile) {
    return { leveledUp: false, oldLevel, newLevel: oldLevel, bonusPointsAwarded: 0 };
  }

  // Calculate what level the child SHOULD be at given lifetime XP
  const { level: calculatedLevel } = calculateLevelFromXp(profile.totalXpEarned);

  // No level-up occurred
  if (calculatedLevel <= oldLevel) {
    // Still update the level field in case it drifted (safety net)
    if (profile.level !== calculatedLevel) {
      await db.childProfile.update({
        where: { userId: childId },
        data: { level: calculatedLevel },
      });
    }
    return { leveledUp: false, oldLevel, newLevel: calculatedLevel, bonusPointsAwarded: 0 };
  }

  // Level-up detected — award bonus Points for EACH level gained
  // (Edge case: a very large XP award could jump multiple levels at once)
  let totalBonusPoints = 0;
  for (let lvl = oldLevel + 1; lvl <= calculatedLevel; lvl++) {
    totalBonusPoints += lvl * GAMIFICATION_M7.LEVEL_MULTIPLIER;
  }

  const newBalance = profile.pointsBalance + totalBonusPoints;

  // Update profile: new level + bonus points added to balance
  await db.childProfile.update({
    where: { userId: childId },
    data: {
      level: calculatedLevel,
      pointsBalance: newBalance,
    },
  });

  // Create a milestone_bonus ledger entry for the bonus Points
  await db.pointsLedger.create({
    data: {
      childId,
      transactionType: 'milestone_bonus',
      pointsAmount: totalBonusPoints,
      balanceAfter: newBalance,
      referenceType: 'level_up',
      referenceId: childId, // Self-reference — no external record to link
      description:
        calculatedLevel === oldLevel + 1
          ? `Level up! Reached Level ${calculatedLevel} — bonus ${totalBonusPoints} Points`
          : `Multi-level up! Level ${oldLevel} → ${calculatedLevel} — bonus ${totalBonusPoints} Points`,
    },
  });

  return {
    leveledUp: true,
    oldLevel,
    newLevel: calculatedLevel,
    bonusPointsAwarded: totalBonusPoints,
  };
}
