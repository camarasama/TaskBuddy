/**
 * services/InsightsService.ts — the "is this actually working?" answer (growth roadmap §5.2).
 *
 * A parent who cannot see progress stops believing the app is doing anything, which is why the
 * roadmap calls the consistency heatmap the single most persuasive visual in the product.
 *
 * **All bucketing is UTC.** `FamilySettings.timezone` is not reliably populated — the same reason
 * the weekly digest runs at 07:00 UTC — and mixing a half-populated timezone in would shift days for
 * some families and not others. Consistently UTC and documented beats subtly wrong.
 */

import { prisma } from './database';

export interface HeatmapDay {
  /** YYYY-MM-DD, UTC. */
  date: string;
  approved: number;
}

export interface InsightsReport {
  window: { from: string; to: string; weeks: number };
  /** Dense: every day in the window, zeroes included. */
  heatmap: HeatmapDay[];
  /** Index 0 = Monday … 6 = Sunday. */
  byDayOfWeek: number[];
  /** Index 0-23, UTC. */
  byHourOfDay: number[];
  economy: {
    pointsEarned: number;
    pointsSpent: number;
    /** earned / spent. Null when nothing has been spent — an infinity is not a ratio. */
    earnSpendRatio: number | null;
    currentBalance: number;
    /** Set when earning materially outpaces spending; null otherwise. */
    inflationWarning: string | null;
  };
  totals: { approved: number; activeDays: number };
}

/**
 * Earning this many times faster than spending means the points have stopped buying anything.
 * A stated threshold rather than a vibe, so it can be argued with.
 */
export const INFLATION_RATIO = 3;

/**
 * Below this many earned points the ratio is noise — a family two days into using the app has
 * spent nothing yet, and warning them that their economy is broken would be both wrong and rude.
 */
export const INFLATION_MIN_EARNED = 200;

/** UTC midnight, N days back. */
function utcMidnight(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Build the dense day series.
 *
 * Exported and pure so the "no holes" property can be tested without a database — a sparse heatmap
 * is the failure mode here, because the empty days ARE the signal a parent is reading.
 */
export function buildDenseHeatmap(
  from: Date,
  to: Date,
  counts: Map<string, number>,
): HeatmapDay[] {
  const days: HeatmapDay[] = [];
  const cursor = utcMidnight(from);
  const end = utcMidnight(to);

  while (cursor <= end) {
    const key = dateKey(cursor);
    days.push({ date: key, approved: counts.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** The inflation verdict, or null. Pure, so the threshold is directly testable. */
export function inflationWarning(earned: number, spent: number): string | null {
  if (earned < INFLATION_MIN_EARNED) return null; // too little data for the ratio to mean anything
  if (spent <= 0) {
    return `${earned} points earned and none spent yet — a reward they actually want may be missing.`;
  }
  if (earned / spent >= INFLATION_RATIO) {
    return `Points are being earned about ${Math.round(earned / spent)}× faster than they are spent. Rewards may be priced too high, or there may not be one worth saving for.`;
  }
  return null;
}

export async function getInsights(params: {
  familyId: string;
  childId?: string;
  weeks?: number;
}): Promise<InsightsReport> {
  const weeks = Math.max(1, Math.min(params.weeks ?? 12, 52));
  const to = new Date();
  const from = utcMidnight(new Date(to.getTime() - weeks * 7 * 86_400_000));

  const childFilter = params.childId ? { childId: params.childId } : {};

  const [approvals, ledger, profiles] = await Promise.all([
    prisma.taskAssignment.findMany({
      where: {
        status: 'approved',
        approvedAt: { gte: from, lte: to },
        task: { familyId: params.familyId, deletedAt: null },
        ...childFilter,
      },
      select: { approvedAt: true, completedAt: true },
    }),
    prisma.pointsLedger.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        child: { familyId: params.familyId },
        ...childFilter,
      },
      select: { pointsAmount: true },
    }),
    prisma.childProfile.findMany({
      where: {
        user: { familyId: params.familyId, role: 'child', deletedAt: null },
        ...(params.childId ? { userId: params.childId } : {}),
      },
      select: { pointsBalance: true },
    }),
  ]);

  const counts = new Map<string, number>();
  const byDayOfWeek = new Array(7).fill(0);
  const byHourOfDay = new Array(24).fill(0);

  for (const row of approvals) {
    if (!row.approvedAt) continue;
    const key = dateKey(row.approvedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);

    // getUTCDay(): 0 = Sunday. Shift so index 0 is Monday, which is how a week is read.
    byDayOfWeek[(row.approvedAt.getUTCDay() + 6) % 7]++;

    // Bucket on when the CHILD finished, not when the parent got round to approving — the question
    // is when the child works, and approval latency would smear that across the evening.
    const worked = row.completedAt ?? row.approvedAt;
    byHourOfDay[worked.getUTCHours()]++;
  }

  let pointsEarned = 0;
  let pointsSpent = 0;
  for (const row of ledger) {
    if (row.pointsAmount >= 0) pointsEarned += row.pointsAmount;
    else pointsSpent += Math.abs(row.pointsAmount);
  }

  const heatmap = buildDenseHeatmap(from, to, counts);

  return {
    window: { from: from.toISOString(), to: to.toISOString(), weeks },
    heatmap,
    byDayOfWeek,
    byHourOfDay,
    economy: {
      pointsEarned,
      pointsSpent,
      earnSpendRatio:
        pointsSpent > 0 ? Math.round((pointsEarned / pointsSpent) * 10) / 10 : null,
      currentBalance: profiles.reduce((n, p) => n + p.pointsBalance, 0),
      inflationWarning: inflationWarning(pointsEarned, pointsSpent),
    },
    totals: {
      approved: approvals.length,
      activeDays: heatmap.filter((d) => d.approved > 0).length,
    },
  };
}

export const InsightsService = { getInsights, buildDenseHeatmap, inflationWarning };
