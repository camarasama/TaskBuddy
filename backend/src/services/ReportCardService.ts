/**
 * services/ReportCardService.ts — the monthly report card (growth roadmap §5.4).
 *
 * Worth more than its size suggests: it is the **only acquisition mechanic in the product**. A parent
 * forwards it to a co-parent or a grandparent, and the artefact does the introducing. That is also
 * why an empty month must still render something a person is happy to send — a blank page lets the
 * parent down twice, once privately and once in front of whoever they shared it with.
 */

import { prisma } from './database';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';

export interface ReportCard {
  childName: string;
  monthLabel: string;
  month: string; // YYYY-MM
  tasksApproved: number;
  pointsEarned: number;
  currentStreak: number;
  longestStreak: number;
  achievements: string[];
  /** The day with the most approvals, or null for a month with none. */
  bestDay: { date: string; approved: number } | null;
  /** Approvals last month, and the change. Null when there is no prior month on record. */
  previousMonthApproved: number | null;
  approvedDelta: number | null;
  /** True when nothing happened — the renderer says so kindly rather than printing zeroes. */
  isEmpty: boolean;
}

/** First instant of a YYYY-MM, UTC. Throws on anything malformed or implausible. */
export function parseMonth(month: string): Date {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new ValidationError('Month must be in YYYY-MM format.');
  }
  const [year, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) throw new ValidationError('Month must be between 01 and 12.');
  // Bounded so a typo cannot turn into a table scan across centuries.
  if (year < 2020 || year > 2100) throw new ValidationError('Month is out of range.');
  return new Date(Date.UTC(year, m - 1, 1));
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

function monthLabel(start: Date): string {
  return start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export async function buildReportCard(params: {
  familyId: string;
  childId: string;
  month: string;
}): Promise<ReportCard> {
  const start = parseMonth(params.month);
  const end = addMonths(start, 1);
  const previousStart = addMonths(start, -1);

  const child = await prisma.user.findFirst({
    where: { id: params.childId, familyId: params.familyId, role: 'child', deletedAt: null },
    include: { childProfile: { select: { currentStreakDays: true, longestStreakDays: true } } },
  });
  if (!child) throw new NotFoundError('Child not found');

  const [approvals, pointsResult, achievements, previousApproved] = await Promise.all([
    prisma.taskAssignment.findMany({
      where: {
        childId: child.id,
        status: 'approved',
        approvedAt: { gte: start, lt: end },
        task: { deletedAt: null },
      },
      select: { approvedAt: true },
    }),
    prisma.pointsLedger.aggregate({
      where: { childId: child.id, pointsAmount: { gt: 0 }, createdAt: { gte: start, lt: end } },
      _sum: { pointsAmount: true },
    }),
    prisma.childAchievement.findMany({
      where: { childId: child.id, unlockedAt: { gte: start, lt: end } },
      include: { achievement: { select: { name: true } } },
      orderBy: { unlockedAt: 'asc' },
      take: 8,
    }),
    prisma.taskAssignment.count({
      where: {
        childId: child.id,
        status: 'approved',
        approvedAt: { gte: previousStart, lt: start },
        task: { deletedAt: null },
      },
    }),
  ]);

  // Best day, from the approvals already fetched — no second query for a one-line stat.
  const byDay = new Map<string, number>();
  for (const row of approvals) {
    if (!row.approvedAt) continue;
    const key = row.approvedAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  let bestDay: ReportCard['bestDay'] = null;
  for (const [date, approved] of byDay) {
    if (!bestDay || approved > bestDay.approved) bestDay = { date, approved };
  }

  const tasksApproved = approvals.length;
  const pointsEarned = pointsResult._sum.pointsAmount ?? 0;

  // A first-ever card must not claim a delta against a month that never existed. Zero approvals last
  // month is only meaningful if the family was actually around for it — which, for a month with no
  // activity at all either side, it probably was not.
  const hasPrior = previousApproved > 0;

  return {
    childName: child.firstName,
    month: params.month,
    monthLabel: monthLabel(start),
    tasksApproved,
    pointsEarned,
    currentStreak: child.childProfile?.currentStreakDays ?? 0,
    longestStreak: child.childProfile?.longestStreakDays ?? 0,
    achievements: achievements.map((a) => a.achievement.name),
    bestDay,
    previousMonthApproved: hasPrior ? previousApproved : null,
    approvedDelta: hasPrior ? tasksApproved - previousApproved : null,
    isEmpty: tasksApproved === 0 && pointsEarned === 0 && achievements.length === 0,
  };
}

export const ReportCardService = { buildReportCard, parseMonth };
