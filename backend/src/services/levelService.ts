/**
 * levelService.ts - M7: Level-up detection and milestone bonus (CR-06)
 *
 * Called after every XP award (task approval, auto-approve, game reward, achievement bonus).
 * Compares the child's old level to their new level after XP is added.
 * If they levelled up, creates a PointsLedger entry of type "milestone_bonus"
 * for (newLevel × LEVEL_MULTIPLIER) Points and updates pointsBalance.
 *
 * This service does NOT award XP itself - that happens at the call sites.
 * It only handles the downstream level-up bonus Points logic.
 *
 * ## It is the ONLY writer of `level` and `experiencePoints`
 *
 * Both fields are projections of `totalXpEarned`, and deriving them in one place is what keeps them
 * from disagreeing. The two-formula bug this replaced is worth remembering: `achievements.ts` carried
 * its own polynomial curve over `experiencePoints` while this service used the exponential curve in
 * `utils/gamification.ts` over `totalXpEarned`, so a child could satisfy a `level_reached` achievement
 * at a level they had not reached, or hold a level the achievement check refused to see.
 *
 * So a caller that awards XP increments `totalXpEarned` ONLY, then calls this. Writing
 * `experiencePoints` at a call site is always a bug: it is the within-level remainder, not a
 * counter, and incrementing it makes it a second lifetime total that drifts from the first.
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
      experiencePoints: true,
      pointsBalance: true,
    },
  });

  if (!profile) {
    return { leveledUp: false, oldLevel, newLevel: oldLevel, bonusPointsAwarded: 0 };
  }

  // Calculate what level the child SHOULD be at given lifetime XP, and how much of that level they
  // have already filled. `currentLevelXp` is what `experiencePoints` stores.
  const { level: calculatedLevel, currentLevelXp } = calculateLevelFromXp(profile.totalXpEarned);

  // No level-up occurred
  if (calculatedLevel <= oldLevel) {
    // Still normalise both projections in case they drifted (safety net). This is also the path that
    // repairs rows written before this service owned `experiencePoints`.
    if (profile.level !== calculatedLevel || profile.experiencePoints !== currentLevelXp) {
      await db.childProfile.update({
        where: { userId: childId },
        data: { level: calculatedLevel, experiencePoints: currentLevelXp },
      });
    }
    return { leveledUp: false, oldLevel, newLevel: calculatedLevel, bonusPointsAwarded: 0 };
  }

  // Level-up detected - award bonus Points for EACH level gained
  // (Edge case: a very large XP award could jump multiple levels at once)
  let totalBonusPoints = 0;
  for (let lvl = oldLevel + 1; lvl <= calculatedLevel; lvl++) {
    totalBonusPoints += lvl * GAMIFICATION_M7.LEVEL_MULTIPLIER;
  }

  const newBalance = profile.pointsBalance + totalBonusPoints;

  // Update profile: new level + within-level remainder + bonus points added to balance
  await db.childProfile.update({
    where: { userId: childId },
    data: {
      level: calculatedLevel,
      experiencePoints: currentLevelXp,
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
      referenceId: childId, // Self-reference - no external record to link
      description:
        calculatedLevel === oldLevel + 1
          ? `Level up! Reached Level ${calculatedLevel} - bonus ${totalBonusPoints} Points`
          : `Multi-level up! Level ${oldLevel} → ${calculatedLevel} - bonus ${totalBonusPoints} Points`,
    },
  });

  return {
    leveledUp: true,
    oldLevel,
    newLevel: calculatedLevel,
    bonusPointsAwarded: totalBonusPoints,
  };
}
