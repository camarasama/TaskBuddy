/**
 * services/FunnelService.ts — reads the funnel (growth roadmap §1, §5.5).
 *
 * U1 started writing `analytics_events` and nothing has ever read them, so the table has been
 * write-only and the roadmap's north star has been unmeasurable in practice as well as in theory.
 * This is the read side.
 *
 * Two statistical choices matter more than they look:
 *
 *  - **Median, not mean, for time-to-first-approval.** One family that took forty days drags a mean
 *    far enough to make the number worthless for deciding anything.
 *  - **Families that never converted stay in the denominator.** Dropping them would make the
 *    conversion rate *rise* as the product got worse, which is the most dangerous kind of metric.
 */

import { prisma } from './database';

export interface FunnelWindow {
  from: Date;
  to: Date;
}

export interface FunnelReport {
  window: { from: string; to: string };
  signups: number;
  /** Families from this window's signups that have since reached a first approval. */
  activated: number;
  /** activated / signups, 0-100. Null when nobody signed up — not 0, which would read as failure. */
  activationRate: number | null;
  /** Median hours from signup to first approval, over activated families only. Null if none. */
  medianHoursToFirstApproval: number | null;
  /** Distinct families that completed each setup step. */
  setupSteps: Array<{ step: string; families: number }>;
  digestsSent: number;
  digestsOpened: number;
  /** opened / sent, 0-100. Null when none were sent. */
  digestOpenRate: number | null;
}

/** Median of a non-empty numeric list. Exported for direct testing. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Percentage, or null when the denominator is zero. Never NaN, never a divide-by-zero. */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export async function getFunnel(window: FunnelWindow): Promise<FunnelReport> {
  const range = { gte: window.from, lte: window.to };

  const [signupEvents, stepRows, digestsSent, digestsOpened] = await Promise.all([
    // The signup cohort. Time-to-value is only meaningful for families whose START is in the window;
    // one that signed up earlier has no comparable clock, so it is excluded rather than counted as 0.
    prisma.analyticsEvent.findMany({
      where: { eventType: 'SIGNUP', createdAt: range, familyId: { not: null } },
      select: { familyId: true, createdAt: true },
    }),
    // Rows rather than a groupBy: the step name lives in the payload, so it cannot be grouped on
    // in SQL. Distinct families per step are counted below — a family completing a step twice must
    // not inflate the funnel.
    prisma.analyticsEvent.findMany({
      where: { eventType: 'SETUP_STEP', createdAt: range },
      select: { familyId: true, payload: true },
    }),
    prisma.analyticsEvent.count({ where: { eventType: 'DIGEST_SENT', createdAt: range } }),
    prisma.analyticsEvent.count({ where: { eventType: 'DIGEST_OPENED', createdAt: range } }),
  ]);

  const signupBy = new Map<string, Date>();
  for (const row of signupEvents) {
    if (!row.familyId) continue;
    // Keep the earliest, in case a family somehow has two.
    const existing = signupBy.get(row.familyId);
    if (!existing || row.createdAt < existing) signupBy.set(row.familyId, row.createdAt);
  }
  const cohort = [...signupBy.keys()];

  // First approvals for THIS cohort, whenever they happened — a family that signed up on the last
  // day of the window and converted the next day still converted.
  const approvals = cohort.length
    ? await prisma.analyticsEvent.findMany({
        where: { eventType: 'FIRST_APPROVAL', familyId: { in: cohort } },
        select: { familyId: true, createdAt: true },
      })
    : [];

  const approvalBy = new Map<string, Date>();
  for (const row of approvals) {
    if (!row.familyId) continue;
    const existing = approvalBy.get(row.familyId);
    if (!existing || row.createdAt < existing) approvalBy.set(row.familyId, row.createdAt);
  }

  const hours: number[] = [];
  for (const [familyId, signedUp] of signupBy) {
    const approved = approvalBy.get(familyId);
    if (!approved) continue; // never converted — stays in the denominator, contributes no duration
    hours.push((approved.getTime() - signedUp.getTime()) / 3_600_000);
  }

  const familiesByStep = new Map<string, Set<string>>();
  for (const row of stepRows) {
    const step = (row.payload as { step?: string } | null)?.step;
    if (!step || !row.familyId) continue;
    if (!familiesByStep.has(step)) familiesByStep.set(step, new Set());
    familiesByStep.get(step)!.add(row.familyId);
  }

  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    signups: cohort.length,
    activated: hours.length,
    activationRate: rate(hours.length, cohort.length),
    medianHoursToFirstApproval: median(hours) === null ? null : Math.round(median(hours)! * 10) / 10,
    setupSteps: [...familiesByStep.entries()]
      .map(([step, families]) => ({ step, families: families.size }))
      .sort((a, b) => b.families - a.families),
    digestsSent,
    digestsOpened,
    digestOpenRate: rate(digestsOpened, digestsSent),
  };
}

export const FunnelService = { getFunnel, median, rate };
