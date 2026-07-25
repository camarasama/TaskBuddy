/**
 * services/DigestService.ts — the weekly parent digest (growth roadmap §3.3, #2 priority).
 *
 * This is the one feature that proves value to the parent *without them opening the app*, which is
 * why the roadmap ranks it second only to the template library. Every line in it deep-links back in.
 *
 * Two rules shape the whole thing:
 *
 *  1. **A silent week sends nothing.** A digest that arrives saying "0 tasks, 0 points, nothing
 *     happened" trains parents to ignore the sender, and unsubscribes are unrecoverable. Families
 *     with no activity are skipped entirely — see `buildFamilyDigest` returning null.
 *
 *  2. **One suggested action, not a wall of numbers.** The digest's job is to cause a return visit,
 *     so it ends with a single concrete next step chosen from what the data actually shows.
 */

import { prisma } from './database';

export interface ChildDigest {
  childId: string;
  firstName: string;
  tasksApproved: number;
  pointsEarned: number;
  pointsSpent: number;
  currentStreak: number;
  achievementsUnlocked: number;
}

export interface FamilyDigest {
  familyId: string;
  weekStart: Date;
  weekEnd: Date;
  children: ChildDigest[];
  pendingApprovals: number;
  /** Rewards that expire within the next 7 days — a nudge with a deadline. */
  expiringRewards: Array<{ name: string; expiresAt: Date }>;
  /** Totals across the family, used for the headline line. */
  totals: { tasksApproved: number; pointsEarned: number };
  suggestedAction: string;
}

/** Monday 00:00 UTC of the week that just ended. */
export function lastWeekWindow(now: Date): { weekStart: Date; weekEnd: Date } {
  const weekEnd = new Date(now);
  weekEnd.setUTCHours(0, 0, 0, 0);
  // getUTCDay(): 0 = Sunday, 1 = Monday. Walk back to the most recent Monday.
  const daysSinceMonday = (weekEnd.getUTCDay() + 6) % 7;
  weekEnd.setUTCDate(weekEnd.getUTCDate() - daysSinceMonday);

  const weekStart = new Date(weekEnd);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);

  return { weekStart, weekEnd };
}

/**
 * Pick the single most useful next step from what the week actually showed.
 *
 * Ordered by urgency to the PARENT, not by how impressive the number is: something waiting on them
 * beats a celebration, because the first is a blocked child and the second is not.
 */
export function chooseSuggestedAction(digest: Omit<FamilyDigest, 'suggestedAction'>): string {
  if (digest.pendingApprovals > 0) {
    const n = digest.pendingApprovals;
    return `${n} task${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} waiting for your approval — a quick tap keeps the streak alive.`;
  }

  if (digest.expiringRewards.length > 0) {
    return `"${digest.expiringRewards[0].name}" expires soon. Worth a mention at dinner?`;
  }

  const onAStreak = digest.children.filter((c) => c.currentStreak >= 3);
  if (onAStreak.length > 0) {
    const child = onAStreak.sort((a, b) => b.currentStreak - a.currentStreak)[0];
    return `${child.firstName} is on a ${child.currentStreak}-day streak. Add a bonus task to keep the momentum?`;
  }

  const quiet = digest.children.find((c) => c.tasksApproved === 0);
  if (quiet) {
    return `${quiet.firstName} didn't finish anything this week — a fresh task or a new reward often restarts things.`;
  }

  return 'Everything is on track. Adding a new reward keeps the goal worth chasing.';
}

/**
 * Build one family's digest, or null when there is nothing worth sending.
 *
 * "Nothing worth sending" means no approvals, no points, and nothing waiting — see rule 1 above.
 * A pending approval alone IS worth sending, because that is a blocked child.
 */
export async function buildFamilyDigest(
  familyId: string,
  now: Date = new Date(),
): Promise<FamilyDigest | null> {
  const { weekStart, weekEnd } = lastWeekWindow(now);

  const children = await prisma.user.findMany({
    where: { familyId, role: 'child', deletedAt: null, isActive: true },
    include: { childProfile: { select: { currentStreakDays: true } } },
  });

  if (children.length === 0) return null;

  const childIds = children.map((c) => c.id);
  const window = { gte: weekStart, lt: weekEnd };

  // Grouped queries rather than N per child — a family with 4 children should not cost 12 round
  // trips inside a cron that runs for every family.
  const [approvedRows, ledgerRows, achievementRows, pendingApprovals, expiringRewards] =
    await Promise.all([
      prisma.taskAssignment.groupBy({
        by: ['childId'],
        where: { childId: { in: childIds }, status: 'approved', approvedAt: window },
        _count: { _all: true },
      }),
      // Rows, not a grouped SUM: the ledger mixes earnings and spends, and a signed sum collapses
      // them into one net figure for any child who did both. The digest needs "earned X, spent Y".
      prisma.pointsLedger.findMany({
        where: { childId: { in: childIds }, createdAt: window },
        select: { childId: true, pointsAmount: true },
      }),
      prisma.childAchievement.groupBy({
        by: ['childId'],
        where: { childId: { in: childIds }, unlockedAt: window },
        _count: { _all: true },
      }),
      prisma.taskAssignment.count({
        where: { status: 'completed', task: { familyId, deletedAt: null } },
      }),
      prisma.reward.findMany({
        where: {
          familyId,
          isActive: true,
          deletedAt: null,
          expiresAt: { gte: now, lt: new Date(now.getTime() + 7 * 86_400_000) },
        },
        select: { name: true, expiresAt: true },
        orderBy: { expiresAt: 'asc' },
        take: 3,
      }),
    ]);

  const approvedBy = new Map(approvedRows.map((r) => [r.childId, r._count._all]));
  const achievementsBy = new Map(achievementRows.map((r) => [r.childId, r._count._all]));

  // A redemption is a negative amount, so split on sign to get the two figures the digest reports.
  const earnedBy = new Map<string, number>();
  const spentBy = new Map<string, number>();
  for (const row of ledgerRows) {
    const bucket = row.pointsAmount >= 0 ? earnedBy : spentBy;
    bucket.set(row.childId, (bucket.get(row.childId) ?? 0) + Math.abs(row.pointsAmount));
  }

  const childDigests: ChildDigest[] = children.map((c) => ({
    childId: c.id,
    firstName: c.firstName,
    tasksApproved: approvedBy.get(c.id) ?? 0,
    pointsEarned: earnedBy.get(c.id) ?? 0,
    pointsSpent: spentBy.get(c.id) ?? 0,
    currentStreak: c.childProfile?.currentStreakDays ?? 0,
    achievementsUnlocked: achievementsBy.get(c.id) ?? 0,
  }));

  const totals = {
    tasksApproved: childDigests.reduce((n, c) => n + c.tasksApproved, 0),
    pointsEarned: childDigests.reduce((n, c) => n + c.pointsEarned, 0),
  };

  // Rule 1: a silent week sends nothing.
  const nothingHappened =
    totals.tasksApproved === 0 && totals.pointsEarned === 0 && pendingApprovals === 0;
  if (nothingHappened) return null;

  const base = {
    familyId,
    weekStart,
    weekEnd,
    children: childDigests,
    pendingApprovals,
    expiringRewards: expiringRewards.map((r) => ({ name: r.name, expiresAt: r.expiresAt! })),
    totals,
  };

  return { ...base, suggestedAction: chooseSuggestedAction(base) };
}

export const DigestService = { buildFamilyDigest, chooseSuggestedAction, lastWeekWindow };
