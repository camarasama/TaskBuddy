/**
 * streakService.ts — Updated M7 (CR-06)
 *
 * Changes from M7:
 *  - evaluateStreak now checks if the new streak count hits a milestone
 *    (7, 14, 30, 60, 100 days). If so, it awards bonus Points via a
 *    milestone_bonus PointsLedger entry. No XP is awarded for streaks —
 *    only spendable Points.
 *
 * Original BUG-06 logic (grace period from FamilySettings) is unchanged.
 */

import { prisma } from './database';
import {
  GAMIFICATION_M7,
  STREAK_MILESTONE_DAYS,
  type StreakMilestoneDay,
} from '../utils/gamification';

/**
 * Evaluates and updates a child's streak after a task is completed or approved.
 *
 * BUG-06 FIX: Reads `streakGracePeriodHours` from FamilySettings instead of
 * using hardcoded values. The grace period allows a streak to survive if the
 * child completes a task within N hours after midnight of the missed day.
 *
 * M7 — CR-06: After updating the streak, checks if the new streak count
 * matches a milestone (7/14/30/60/100 days). If it does, creates a
 * milestone_bonus PointsLedger entry and increments pointsBalance.
 *
 * Grace period logic:
 *  - A streak day is "covered" if at least one task was approved/completed
 *    on that calendar date OR within the grace window after midnight.
 *  - If the current streak is 0 and the child has no previous activity,
 *    this call simply starts the streak at 1.
 */
export async function evaluateStreak(childId: string, familyId: string): Promise<void> {
  // 1. Load grace period from FamilySettings (falls back to 0 if not set)
  const settings = await prisma.familySettings.findUnique({
    where: { familyId },
    select: { streakGracePeriodHours: true },
  });

  const gracePeriodHours: number = settings?.streakGracePeriodHours ?? 0;

  // 2. Load child profile
  const childProfile = await prisma.childProfile.findUnique({
    where: { userId: childId },
    select: {
      currentStreakDays: true,
      longestStreakDays: true,
      lastActivityDate: true,
      pointsBalance: true, // M7: needed to calculate balance after bonus
    },
  });

  if (!childProfile) return;

  const now = new Date();
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);

  const yesterdayMidnight = new Date(todayMidnight);
  yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);

  // Grace window: tasks completed up to N hours after yesterday midnight still
  // count as "yesterday" for streak purposes.
  const graceDeadline = new Date(todayMidnight);
  graceDeadline.setHours(gracePeriodHours, 0, 0, 0);

  const lastActivity = childProfile.lastActivityDate
    ? new Date(childProfile.lastActivityDate)
    : null;

  let newStreak = childProfile.currentStreakDays;

  if (!lastActivity) {
    // First ever task completion — start streak
    newStreak = 1;
  } else {
    const lastActivityMidnight = new Date(lastActivity);
    lastActivityMidnight.setHours(0, 0, 0, 0);

    const daysSinceLast = Math.floor(
      (todayMidnight.getTime() - lastActivityMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLast === 0) {
      // Already active today — streak unchanged (already incremented this day)
    } else if (daysSinceLast === 1) {
      // Active yesterday, active today — extend streak
      newStreak += 1;
    } else if (daysSinceLast === 2 && gracePeriodHours > 0 && now <= graceDeadline) {
      // Missed yesterday but within the grace window today — extend streak
      newStreak += 1;
    } else {
      // Gap too large — streak resets
      newStreak = 1;
    }
  }

  const newLongest = Math.max(newStreak, childProfile.longestStreakDays);

  await prisma.childProfile.update({
    where: { userId: childId },
    data: {
      currentStreakDays: newStreak,
      longestStreakDays: newLongest,
      lastActivityDate: now,
    },
  });

  // M7 — CR-06: Check if newStreak hits a milestone.
  // Only award the bonus once — if daysSinceLast === 0 (already active today)
  // then newStreak did not change so we will not double-award.
  // The milestone check is against the NEW streak value after the update above.
  const isMilestone = (STREAK_MILESTONE_DAYS as readonly number[]).includes(newStreak);

  if (isMilestone && newStreak !== childProfile.currentStreakDays) {
    // newStreak is a milestone day AND it just changed (we're the increment that hit it)
    const bonusPoints =
      GAMIFICATION_M7.STREAK_MILESTONE_POINTS[newStreak as StreakMilestoneDay];

    if (bonusPoints) {
      const currentProfile = await prisma.childProfile.findUnique({
        where: { userId: childId },
        select: { pointsBalance: true },
      });

      if (currentProfile) {
        const newBalance = currentProfile.pointsBalance + bonusPoints;

        await prisma.childProfile.update({
          where: { userId: childId },
          data: { pointsBalance: newBalance },
        });

        // Create milestone_bonus ledger entry — Points only, no XP
        await prisma.pointsLedger.create({
          data: {
            childId,
            transactionType: 'milestone_bonus',
            pointsAmount: bonusPoints,
            balanceAfter: newBalance,
            referenceType: 'streak_milestone',
            referenceId: childId, // self-reference, no external record
            description: `🔥 ${newStreak}-day streak milestone! Bonus ${bonusPoints} Points`,
          },
        });
      }
    }
  }
}

/**
 * Returns whether a child's streak is currently "at risk" of being broken,
 * accounting for the grace period from FamilySettings.
 *
 * At risk means: no task completed today AND the grace window (if any) has
 * not yet started or has already passed.
 */
export async function isStreakAtRisk(childId: string, familyId: string): Promise<boolean> {
  const settings = await prisma.familySettings.findUnique({
    where: { familyId },
    select: { streakGracePeriodHours: true },
  });

  const gracePeriodHours: number = settings?.streakGracePeriodHours ?? 0;

  const profile = await prisma.childProfile.findUnique({
    where: { userId: childId },
    select: { currentStreakDays: true, lastActivityDate: true },
  });

  if (!profile || profile.currentStreakDays === 0) return false;

  const now = new Date();
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);

  const lastActivity = profile.lastActivityDate ? new Date(profile.lastActivityDate) : null;
  if (!lastActivity) return false;

  const lastActivityMidnight = new Date(lastActivity);
  lastActivityMidnight.setHours(0, 0, 0, 0);

  const completedToday = lastActivityMidnight.getTime() === todayMidnight.getTime();
  if (completedToday) return false;

  // If within grace window, the streak is not yet lost — but still "at risk"
  const graceDeadline = new Date(todayMidnight);
  graceDeadline.setHours(gracePeriodHours, 0, 0, 0);

  const withinGrace = gracePeriodHours > 0 && now <= graceDeadline;
  return !withinGrace; // At risk only once grace window has passed
}