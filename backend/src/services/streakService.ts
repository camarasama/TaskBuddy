/**
 * streakService.ts - Updated M7 (CR-06)
 *
 * Changes from M7:
 *  - evaluateStreak now checks if the new streak count hits a milestone
 *    (7, 14, 30, 60, 100 days). If so, it awards bonus Points via a
 *    milestone_bonus PointsLedger entry. No XP is awarded for streaks -
 *    only spendable Points.
 *
 * Original BUG-06 logic (grace period from FamilySettings) is unchanged.
 */

import { MAX_STREAK_PAUSE_DAYS } from '@taskbuddy/shared';
import { prisma } from './database';

// Re-exported so `routes/family.ts` and the tests keep one import site for the streak rules.
export { MAX_STREAK_PAUSE_DAYS };
import {
  GAMIFICATION_M7,
  STREAK_MILESTONE_DAYS,
  type StreakMilestoneDay,
} from '../utils/gamification';
import { emitStreakMilestone } from './SocketService';

/**
 * Evaluates and updates a child's streak after a task is completed or approved.
 *
 * BUG-06 FIX: Reads `streakGracePeriodHours` from FamilySettings instead of
 * using hardcoded values. The grace period allows a streak to survive if the
 * child completes a task within N hours after midnight of the missed day.
 *
 * M7 - CR-06: After updating the streak, checks if the new streak count
 * matches a milestone (7/14/30/60/100 days). If it does, creates a
 * milestone_bonus PointsLedger entry and increments pointsBalance.
 *
 * Grace period logic:
 *  - A streak day is "covered" if at least one task was approved/completed
 *    on that calendar date OR within the grace window after midnight.
 *  - If the current streak is 0 and the child has no previous activity,
 *    this call simply starts the streak at 1.
 *
 * FR-13 - `asOf` (defaults to now): the moment the child actually finished the task, which for a
 * replayed offline completion is NOT the moment this runs. Every day boundary below is derived
 * from it, so a 23:50 completion synced at 00:10 is still credited to the 23:50 calendar day.
 */

/** Most freezes a child may bank at once (growth roadmap §4.3). */
export const MAX_STREAK_FREEZES = 2;

/** A freeze is earned each time the streak reaches a multiple of this. */
export const STREAK_FREEZE_EARN_EVERY = 7;

export interface FreezeDecision {
  /** Streak value to store. */
  newStreak: number;
  /** Freeze balance to store. */
  newFreezes: number;
  /** How many were spent covering the gap (0 when none were needed or none could help). */
  consumed: number;
}

/**
 * Decide what a gap does to a streak, given the child's freeze bank.
 *
 * Pure, so the arithmetic can be tested exhaustively without a database.
 *
 * Rules (growth roadmap §4.3):
 *  - One freeze covers ONE missed day. A 2-day gap costs 1; a 3-day gap costs 2.
 *  - Freezes are spent only when the bank covers the WHOLE gap. A partial save would be arbitrary —
 *    the child would lose the streak anyway and be out of pocket for it.
 *  - Otherwise the streak resets to 1 and the bank is left alone, so the freezes remain useful for
 *    the streak they are about to start.
 */
export function applyStreakFreeze(params: {
  currentStreak: number;
  daysSinceLast: number;
  freezes: number;
}): FreezeDecision {
  const { currentStreak, daysSinceLast, freezes } = params;
  const missedDays = Math.max(0, daysSinceLast - 1);

  if (missedDays > 0 && missedDays <= freezes) {
    return { newStreak: currentStreak + 1, newFreezes: freezes - missedDays, consumed: missedDays };
  }

  return { newStreak: 1, newFreezes: freezes, consumed: 0 };
}


/**
 * The moment today's grace window actually closes, once a parent's one-off grant is taken into
 * account (growth roadmap §11.3).
 *
 * Two sources, and the LATER wins:
 *   - `FamilySettings.streakGracePeriodHours`, a standing policy in hours past midnight, applied
 *     every day to every child in the family.
 *   - `ChildProfile.graceGrantedUntil`, a timestamp a parent set for one child after one bad
 *     evening.
 *
 * Taking the later of the two is the only combination that cannot surprise anyone: a grant is
 * something a parent did deliberately, so it must never be shortened by a family policy that happens
 * to be stricter, and a family that already allows until 4am should not lose that because a grant
 * expired at midnight. A grant in the past is simply spent and falls out of the max naturally.
 *
 * Pure, so the precedence is testable without a database.
 */
export function graceDeadlineFor(params: {
  todayMidnight: Date;
  gracePeriodHours: number;
  graceGrantedUntil: Date | null;
}): Date {
  const { todayMidnight, gracePeriodHours, graceGrantedUntil } = params;

  const fromPolicy = new Date(todayMidnight);
  fromPolicy.setHours(gracePeriodHours, 0, 0, 0);

  if (!graceGrantedUntil) return fromPolicy;
  return graceGrantedUntil > fromPolicy ? graceGrantedUntil : fromPolicy;
}

/** Midnight of the calendar day `d` falls in. Every day-boundary comparison here goes through it. */
function midnight(d: Date): Date {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  return m;
}

/**
 * How many days of a gap were covered by an open vacation pause.
 *
 * Counts calendar days STRICTLY BETWEEN the last activity and today, intersected with the inclusive
 * pause range. Both endpoints are excluded on purpose: the last-activity day was worked, and today is
 * the day being credited, so neither is a missed day that a pause could cover.
 *
 * Pure, so the arithmetic is testable without a database, matching `applyStreakFreeze`.
 */
export function pausedDaysInGap(params: {
  lastActivity: Date;
  now: Date;
  pausedFrom: Date | null;
  pausedUntil: Date | null;
}): number {
  const { lastActivity, now, pausedFrom, pausedUntil } = params;
  if (!pausedFrom || !pausedUntil) return 0;

  const from = midnight(pausedFrom);
  const until = midnight(pausedUntil);
  if (until < from) return 0;

  const firstMissed = midnight(lastActivity);
  firstMissed.setDate(firstMissed.getDate() + 1);
  const lastMissed = midnight(now);
  lastMissed.setDate(lastMissed.getDate() - 1);

  // Overlap of [firstMissed, lastMissed] with [from, until], both inclusive.
  const start = firstMissed > from ? firstMissed : from;
  const end = lastMissed < until ? lastMissed : until;
  if (end < start) return 0;

  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** Whether a pause covers the calendar day `on` falls in. */
export function isPausedOn(params: {
  on: Date;
  pausedFrom: Date | null;
  pausedUntil: Date | null;
}): boolean {
  const { on, pausedFrom, pausedUntil } = params;
  if (!pausedFrom || !pausedUntil) return false;
  const day = midnight(on);
  return day >= midnight(pausedFrom) && day <= midnight(pausedUntil);
}

/**
 * Freeze balance after a streak lands on `newStreak`.
 *
 * Earning at the cap is a no-op rather than an overflow, so a long streak does not silently bank
 * credit the child can never use.
 */
export function earnStreakFreeze(params: {
  newStreak: number;
  previousStreak: number;
  freezes: number;
}): number {
  const { newStreak, previousStreak, freezes } = params;
  const advanced = newStreak > previousStreak;
  const hitMilestone = newStreak > 0 && newStreak % STREAK_FREEZE_EARN_EVERY === 0;

  if (!advanced || !hitMilestone) return freezes;
  return Math.min(freezes + 1, MAX_STREAK_FREEZES);
}

export async function evaluateStreak(
  childId: string,
  familyId: string,
  asOf: Date = new Date()
): Promise<void> {
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
      streakFreezes: true, // roadmap §4.3 - insurance against a missed day
      graceGrantedUntil: true, // roadmap §11.3 - one-off parent grant
      streakPausedFrom: true, // roadmap §11.2 - vacation mode
      streakPausedUntil: true,
    },
  });

  if (!childProfile) return;

  // FR-13: "now" is the moment the work happened (asOf), not the moment this code runs.
  const now = asOf;
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);

  const yesterdayMidnight = new Date(todayMidnight);
  yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1);

  // Grace window: tasks completed up to N hours after yesterday midnight still
  // count as "yesterday" for streak purposes.
  // Later of the family's standing policy and any one-off grant. See `graceDeadlineFor`.
  const graceDeadline = graceDeadlineFor({
    todayMidnight,
    gracePeriodHours,
    graceGrantedUntil: childProfile.graceGrantedUntil,
  });

  const lastActivity = childProfile.lastActivityDate
    ? new Date(childProfile.lastActivityDate)
    : null;

  let newStreak = childProfile.currentStreakDays;
  let newFreezes = childProfile.streakFreezes;
  let freezesConsumed = 0;

  if (!lastActivity) {
    // First ever task completion - start streak
    newStreak = 1;
  } else {
    const lastActivityMidnight = new Date(lastActivity);
    lastActivityMidnight.setHours(0, 0, 0, 0);

    const daysSinceLast = Math.floor(
      (todayMidnight.getTime() - lastActivityMidnight.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLast <= 0) {
      // Already active on (or after) this day - streak unchanged.
      // FR-13: daysSinceLast < 0 means a queued action is being replayed for a day the child has
      // already been credited for since. Treating that as a "gap" would reset a live streak, so a
      // backdated replay is a no-op rather than a punishment.
    } else if (daysSinceLast === 1) {
      // Active yesterday, active today - extend streak
      newStreak += 1;
    } else if (daysSinceLast === 2 && now <= graceDeadline) {
      /*
        Missed yesterday but still inside today's grace window, so the streak extends.

        The old condition also required `gracePeriodHours > 0`, which was right when the policy was
        the only source of grace and wrong the moment a parent could grant one: a family that has
        turned the standing window off (0 hours, the default in `isStreakAtRisk`) would have had the
        grant silently ignored, which is the one case the feature exists for. `graceDeadlineFor`
        already collapses to midnight when there is neither a policy nor a grant, and `now` is never
        <= midnight of today at the point this runs, so dropping the guard changes nothing for a
        family without a grant.
      */
      newStreak += 1;
    } else {
      /*
        Gap. Vacation days come off it FIRST, then banked freezes cover whatever is left
        (roadmap §11.2, then §4.3).

        The order is the whole point. A pause is something a parent declared in advance, so it is not
        a missed day at all and must never cost a freeze the child earned; freezes are the fallback
        for days nobody planned for. Running them the other way round would silently bill a child for
        their own holiday.

        `daysSinceLast` is reduced rather than the missed-day count being recomputed, so
        `applyStreakFreeze` keeps its single definition of a gap and stays exhaustively testable on
        its own. A fully covered gap lands on daysSinceLast === 1, which that function reads as no
        missed days and passes through untouched.
      */
      const paused = pausedDaysInGap({
        lastActivity,
        now,
        pausedFrom: childProfile.streakPausedFrom,
        pausedUntil: childProfile.streakPausedUntil,
      });
      const effectiveDays = daysSinceLast - paused;

      if (effectiveDays <= 1) {
        /*
          The holiday covered every missed day, so there is no gap left to answer for. This is the
          same outcome as "active yesterday, active today" and is handled here rather than by passing
          the reduced number to `applyStreakFreeze`.

          It has to be: that function is written for a real gap and reads zero missed days as a
          reset, because until vacation mode existed it was only ever reached through the `else`
          below, where the gap is at least two days. Feeding it a fully discounted gap would wipe the
          streak the pause was bought to protect. Caught by the "spends NO freezes when the holiday
          covers the whole gap" test, which is why that test is written against the ordering rather
          than against the helper alone.
        */
        newStreak += 1;
      } else {
        const decision = applyStreakFreeze({
          currentStreak: childProfile.currentStreakDays,
          daysSinceLast: effectiveDays,
          freezes: childProfile.streakFreezes,
        });
        newStreak = decision.newStreak;
        newFreezes = decision.newFreezes;
        freezesConsumed = decision.consumed;
      }
    }
  }

  // Earn AFTER any consumption, so a child cannot pay for a gap with a freeze they only just
  // earned by closing it.
  newFreezes = earnStreakFreeze({
    newStreak,
    previousStreak: childProfile.currentStreakDays,
    freezes: newFreezes,
  });

  const newLongest = Math.max(newStreak, childProfile.longestStreakDays);

  // FR-13: never move lastActivityDate backwards. A backdated replay must not erase the record of
  // more recent activity, or the next real completion would look like it followed a gap.
  const newLastActivity = lastActivity && lastActivity > now ? lastActivity : now;

  await prisma.childProfile.update({
    where: { userId: childId },
    data: {
      currentStreakDays: newStreak,
      longestStreakDays: newLongest,
      lastActivityDate: newLastActivity,
      streakFreezes: newFreezes,
    },
  });

  if (freezesConsumed > 0) {
    console.log(
      `[streak] child ${childId}: spent ${freezesConsumed} freeze(s) to cover a gap; streak held at ${newStreak}.`,
    );
  }

  // M7 - CR-06: Check if newStreak hits a milestone.
  // Only award the bonus once - if daysSinceLast === 0 (already active today)
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

        // Create milestone_bonus ledger entry - Points only, no XP
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

        // P1 - Real-time: push streak:milestone to child's user room
        emitStreakMilestone(childId, { childId, streakCount: newStreak, bonusPoints });
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
    select: {
      currentStreakDays: true,
      lastActivityDate: true,
      graceGrantedUntil: true,
      streakPausedFrom: true,
      streakPausedUntil: true,
    },
  });

  if (!profile || profile.currentStreakDays === 0) return false;

  const now = new Date();

  // A paused streak cannot be at risk: that is what the parent asked for. Checked before anything
  // else so the at-risk email and push both fall silent for the whole holiday rather than firing
  // every evening about a streak that is not in danger (roadmap §11.2).
  if (isPausedOn({ on: now, pausedFrom: profile.streakPausedFrom, pausedUntil: profile.streakPausedUntil })) {
    return false;
  }

  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);

  const lastActivity = profile.lastActivityDate ? new Date(profile.lastActivityDate) : null;
  if (!lastActivity) return false;

  const lastActivityMidnight = new Date(lastActivity);
  lastActivityMidnight.setHours(0, 0, 0, 0);

  const completedToday = lastActivityMidnight.getTime() === todayMidnight.getTime();
  if (completedToday) return false;

  // If within grace window, the streak is not yet lost - but still "at risk"
  // A granted evening means not at risk yet, so the reminder holds off until the grant lapses.
  const graceDeadline = graceDeadlineFor({
    todayMidnight,
    gracePeriodHours,
    graceGrantedUntil: profile.graceGrantedUntil,
  });

  return now > graceDeadline; // At risk only once the grace window has passed
}