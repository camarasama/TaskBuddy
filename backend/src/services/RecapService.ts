/**
 * services/RecapService.ts — the child's "My Week" recap (growth roadmap §6).
 *
 * The parent has had a weekly digest since U3; the child has had nothing. This is the child-facing
 * half of the same ritual, and it is deliberately narrow.
 *
 * **It reads history and writes nothing.** No points, no streak effects, no state at all. §11 binds
 * that no mechanism may remove a child's earned points, streaks or history, and the surest way to
 * honour that in a summary feature is for it to have no write path to audit in the first place.
 *
 * **It contains no sibling data.** The leaderboard is opt-out-able by design; a recap that mentioned
 * a sibling's totals would smuggle the comparison back in through a surface with no opt out. Every
 * figure below is about one child.
 *
 * **It shares the parent digest's week window.** If the two ever described different weeks, a parent
 * and child looking at the same family would disagree about what happened, with no way to tell which
 * was right.
 */

import { prisma } from './database';
import { lastWeekWindow } from './DigestService';

export interface WeekRecap {
  childId: string;
  firstName: string;
  weekStart: string;
  weekEnd: string;
  tasksApproved: number;
  pointsEarned: number;
  pointsSpent: number;
  /** The day with the most approvals, or null when the week was empty. Never an arbitrary default. */
  bestDay: { date: string; tasksApproved: number } | null;
  currentStreak: number;
  longestStreak: number;
  achievementsUnlocked: Array<{ name: string; icon: string | null }>;
  gamesPlayed: number;
  teamUpsCompleted: number;
  /** True when literally nothing happened. The UI says so plainly rather than inventing praise. */
  quietWeek: boolean;
}

/** YYYY-MM-DD, UTC — matching every other date surface in the product. */
function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function buildWeekRecap(childId: string, now: Date = new Date()): Promise<WeekRecap> {
  const { weekStart, weekEnd } = lastWeekWindow(now);

  const child = await prisma.user.findUnique({
    where: { id: childId },
    select: { firstName: true, childProfile: { select: { currentStreakDays: true, longestStreakDays: true } } },
  });

  const [approvals, ledger, achievements, gamesPlayed, teamTasks] = await Promise.all([
    prisma.taskAssignment.findMany({
      where: { childId, status: 'approved', approvedAt: { gte: weekStart, lt: weekEnd } },
      select: { approvedAt: true },
    }),
    // From the LEDGER, so the recap and R-02 can never disagree about the same week.
    prisma.pointsLedger.findMany({
      where: { childId, createdAt: { gte: weekStart, lt: weekEnd } },
      select: { pointsAmount: true },
    }),
    prisma.childAchievement.findMany({
      where: { childId, unlockedAt: { gte: weekStart, lt: weekEnd } },
      select: { achievement: { select: { name: true, iconUrl: true } } },
    }),
    prisma.gameSession.count({
      where: { childId, submittedAt: { gte: weekStart, lt: weekEnd } },
    }),
    prisma.task.findMany({
      where: {
        isTeamTask: true,
        teamBonusAwardedAt: { gte: weekStart, lt: weekEnd },
        assignments: { some: { childId } },
      },
      select: { id: true },
    }),
  ]);

  // Earned and spent are separated by sign rather than by transaction type: a future type would
  // otherwise be silently dropped from one side of the summary.
  let pointsEarned = 0;
  let pointsSpent = 0;
  for (const row of ledger) {
    if (row.pointsAmount >= 0) pointsEarned += row.pointsAmount;
    else pointsSpent += Math.abs(row.pointsAmount);
  }

  const byDay = new Map<string, number>();
  for (const a of approvals) {
    if (!a.approvedAt) continue;
    const key = dateKey(a.approvedAt);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  let bestDay: WeekRecap['bestDay'] = null;
  for (const [date, count] of byDay) {
    if (!bestDay || count > bestDay.tasksApproved) bestDay = { date, tasksApproved: count };
  }

  const tasksApproved = approvals.length;

  return {
    childId,
    firstName: child?.firstName ?? '',
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    tasksApproved,
    pointsEarned,
    pointsSpent,
    bestDay,
    currentStreak: child?.childProfile?.currentStreakDays ?? 0,
    longestStreak: child?.childProfile?.longestStreakDays ?? 0,
    achievementsUnlocked: achievements.map((a) => ({ name: a.achievement.name, icon: a.achievement.iconUrl })),
    gamesPlayed,
    teamUpsCompleted: teamTasks.length,
    quietWeek: tasksApproved === 0 && pointsEarned === 0 && achievements.length === 0 && gamesPlayed === 0,
  };
}

export const RecapService = { buildWeekRecap };
