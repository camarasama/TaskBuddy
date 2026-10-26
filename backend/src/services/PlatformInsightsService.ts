/**
 * services/PlatformInsightsService.ts - the numbers behind the admin Overview (2026-10-26).
 *
 * Not to be confused with InsightsService, which is the PARENT-facing per-family insights.
 *
 * Definitions (shown on the page, keep them in sync):
 *   active family     anyone in it made an authenticated request that day (family_activity_days)
 *   activation        a task approved within 7 days of signup
 *   30-day churn      share of families active 31-60 days ago with no activity in the last 30
 *   stickiness        average daily active families / monthly active families, last 30 days
 *
 * Test accounts (families.is_test_account) are excluded unless `includeTesters` is set. Deleted
 * families are excluded from counts, but still count as churned (deleting the account IS churn).
 *
 * Volumes are small (thousands of families), so the lifecycle and cohort maths run in JS over one
 * pass of the families table, which keeps every definition in one readable place.
 */

import os from 'os';
import { Prisma } from '@prisma/client';
import { prisma } from './database';
import { stageOf, STAGES, type Stage } from './lifecycle';

const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGES = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 } as const;
export type RangeKey = keyof typeof RANGES;

export interface FamilyRow {
  id: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  isTest: boolean;
  cameBack: boolean;
  firstApprovedAt: Date | null;
  parents: number;
  children: number;
}

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): Date {
  const s = startOfUtcDay(d);
  return new Date(s.getTime() - ((s.getUTCDay() + 6) % 7) * DAY_MS);
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

function testSql(includeTesters: boolean): Prisma.Sql {
  return includeTesters ? Prisma.sql`TRUE` : Prisma.sql`NOT f.is_test_account`;
}

export async function loadFamilies(): Promise<FamilyRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      created_at: Date;
      last_active_at: Date | null;
      is_test_account: boolean;
      came_back: boolean;
      first_approved_at: Date | null;
      parents: number;
      children: number;
    }>
  >`
    SELECT f.id, f.created_at, f.last_active_at, f.is_test_account,
           EXISTS (SELECT 1 FROM family_activity_days d
                    WHERE d.family_id = f.id AND d.day > f.created_at::date) AS came_back,
           (SELECT min(ta.approved_at) FROM task_assignments ta JOIN users c ON c.id = ta.child_id
             WHERE c.family_id = f.id AND ta.status = 'approved') AS first_approved_at,
           (SELECT count(*)::int FROM users u WHERE u.family_id = f.id AND u.role = 'parent' AND u.deleted_at IS NULL) AS parents,
           (SELECT count(*)::int FROM users u WHERE u.family_id = f.id AND u.role = 'child' AND u.deleted_at IS NULL) AS children
      FROM families f
     WHERE f.deleted_at IS NULL`;
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    lastActiveAt: r.last_active_at,
    isTest: r.is_test_account,
    cameBack: r.came_back,
    firstApprovedAt: r.first_approved_at,
    parents: r.parents,
    children: r.children,
  }));
}

/** Activated = first approved task within 7 days of signup. */
export function isActivated(f: FamilyRow): boolean {
  return !!f.firstApprovedAt && f.firstApprovedAt.getTime() - f.createdAt.getTime() <= 7 * DAY_MS;
}

/**
 * Activation rate for families whose 7-day window CLOSED inside [end - days, end). Families still
 * inside their first week are left out: counting them as "not activated" would drag the rate down
 * every time signups go up.
 */
export function activationRate(families: FamilyRow[], end: Date, days: number): { rate: number | null; cohort: number } {
  const closeFrom = end.getTime() - days * DAY_MS;
  const cohort = families.filter((f) => {
    const closes = f.createdAt.getTime() + 7 * DAY_MS;
    return closes >= closeFrom && closes < end.getTime();
  });
  return { rate: pct(cohort.filter(isActivated).length, cohort.length), cohort: cohort.length };
}

export function lifecycleCounts(families: FamilyRow[], now: Date): Record<Stage, number> {
  const out = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const f of families) out[stageOf(f, now)]++;
  return out;
}

export function weeklySignups(families: FamilyRow[], now: Date, weeks = 8) {
  const thisWeek = weekStart(now).getTime();
  return Array.from({ length: weeks }, (_, i) => {
    const start = thisWeek - (weeks - 1 - i) * 7 * DAY_MS;
    const inWeek = families.filter((f) => f.createdAt.getTime() >= start && f.createdAt.getTime() < start + 7 * DAY_MS);
    return { weekStart: dayStr(new Date(start)), total: inWeek.length, activated: inWeek.filter(isActivated).length };
  });
}

/**
 * Weekly retention grid. Cell k of a cohort = share of that week's signups with any activity in
 * week k after their signup week. Cells for weeks that have not started yet are null.
 */
export function cohortGrid(
  families: FamilyRow[],
  activityDays: Map<string, string[]>,
  now: Date,
  weeks = 8,
) {
  const thisWeek = weekStart(now).getTime();
  return Array.from({ length: weeks }, (_, i) => {
    const start = thisWeek - (weeks - 1 - i) * 7 * DAY_MS;
    const cohort = families.filter((f) => f.createdAt.getTime() >= start && f.createdAt.getTime() < start + 7 * DAY_MS);
    const cells = Array.from({ length: weeks }, (_, k) => {
      const from = start + k * 7 * DAY_MS;
      if (from > now.getTime() || cohort.length === 0) return null;
      const lo = dayStr(new Date(from));
      const hi = dayStr(new Date(from + 6 * DAY_MS));
      const kept = cohort.filter((f) => (activityDays.get(f.id) ?? []).some((d) => d >= lo && d <= hi)).length;
      return pct(kept, cohort.length);
    });
    return { weekStart: dayStr(new Date(start)), size: cohort.length, cells };
  });
}

async function activitySeries(fromDay: string, today: string, stepDays: number, includeTesters: boolean) {
  const t = testSql(includeTesters);
  const step = `${stepDays} days`;
  const rows = await prisma.$queryRaw<Array<{ day: Date; dau: number; wau: number }>>`
    SELECT g.d::date AS day,
      (SELECT count(*)::int FROM family_activity_days a JOIN families f ON f.id = a.family_id
        WHERE a.day = g.d::date AND f.deleted_at IS NULL AND ${t}) AS dau,
      (SELECT count(DISTINCT a.family_id)::int FROM family_activity_days a JOIN families f ON f.id = a.family_id
        WHERE a.day BETWEEN g.d::date - 6 AND g.d::date AND f.deleted_at IS NULL AND ${t}) AS wau
    FROM generate_series(${fromDay}::date, ${today}::date, ${step}::interval) g(d)
    ORDER BY 1`;
  return rows.map((r) => ({ day: dayStr(r.day), daily: r.dau, weekly: r.wau }));
}

async function churn(endDay: Date, includeTesters: boolean): Promise<number | null> {
  const t = testSql(includeTesters);
  const curFrom = dayStr(new Date(endDay.getTime() - 29 * DAY_MS));
  const curTo = dayStr(endDay);
  const priorFrom = dayStr(new Date(endDay.getTime() - 59 * DAY_MS));
  const priorTo = dayStr(new Date(endDay.getTime() - 30 * DAY_MS));
  const [r] = await prisma.$queryRaw<Array<{ prior: number; churned: number }>>`
    WITH prior AS (
      SELECT DISTINCT a.family_id FROM family_activity_days a JOIN families f ON f.id = a.family_id
       WHERE a.day BETWEEN ${priorFrom}::date AND ${priorTo}::date AND ${t}
    ), cur AS (
      SELECT DISTINCT a.family_id FROM family_activity_days a
       WHERE a.day BETWEEN ${curFrom}::date AND ${curTo}::date
    )
    SELECT (SELECT count(*)::int FROM prior) AS prior,
           (SELECT count(*)::int FROM prior p WHERE NOT EXISTS (SELECT 1 FROM cur c WHERE c.family_id = p.family_id)) AS churned`;
  return pct(r?.churned ?? 0, r?.prior ?? 0);
}

async function engagement(now: Date, from: Date, includeTesters: boolean) {
  const t = testSql(includeTesters);
  const today = dayStr(now);
  const d30 = dayStr(new Date(now.getTime() - 29 * DAY_MS));
  const d28 = new Date(now.getTime() - 28 * DAY_MS);
  const [r] = await prisma.$queryRaw<
    Array<{ day_rows: number; mau: number; active28: number; approved28: number; median_hours: number | null }>
  >`
    SELECT
      (SELECT count(*)::int FROM family_activity_days a JOIN families f ON f.id = a.family_id
        WHERE a.day BETWEEN ${d30}::date AND ${today}::date AND f.deleted_at IS NULL AND ${t}) AS day_rows,
      (SELECT count(DISTINCT a.family_id)::int FROM family_activity_days a JOIN families f ON f.id = a.family_id
        WHERE a.day BETWEEN ${d30}::date AND ${today}::date AND f.deleted_at IS NULL AND ${t}) AS mau,
      (SELECT count(DISTINCT a.family_id)::int FROM family_activity_days a JOIN families f ON f.id = a.family_id
        WHERE a.day > ${dayStr(d28)}::date AND f.deleted_at IS NULL AND ${t}) AS active28,
      (SELECT count(*)::int FROM task_assignments ta JOIN users c ON c.id = ta.child_id JOIN families f ON f.id = c.family_id
        WHERE ta.status = 'approved' AND ta.approved_at >= ${d28} AND f.deleted_at IS NULL AND ${t}) AS approved28,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ta.approved_at - ta.completed_at) / 3600)
         FROM task_assignments ta JOIN users c ON c.id = ta.child_id JOIN families f ON f.id = c.family_id
        WHERE ta.approved_at >= ${from} AND ta.completed_at IS NOT NULL AND ta.approved_at >= ta.completed_at
          AND ta.approved_by IS NOT NULL AND ${t})::float AS median_hours`;
  const avgDau = (r?.day_rows ?? 0) / 30;
  return {
    stickiness: r && r.mau > 0 ? Math.round((avgDau / r.mau) * 1000) / 10 : null,
    tasksApprovedPerActiveFamilyPerWeek:
      r && r.active28 > 0 ? Math.round((r.approved28 / r.active28 / 4) * 10) / 10 : null,
    medianApprovalHours: r?.median_hours != null ? Math.round(r.median_hours * 10) / 10 : null,
    monthlyActiveFamilies: r?.mau ?? 0,
  };
}

async function adoption(from: Date, includeTesters: boolean) {
  const t = testSql(includeTesters);
  const [r] = await prisma.$queryRaw<
    Array<{ total: number; tasks: number; rewards: number; games: number; streak: number; mobile: number; digest: number; coparent: number }>
  >`
    WITH act AS (
      SELECT DISTINCT a.family_id FROM family_activity_days a JOIN families f ON f.id = a.family_id
       WHERE a.day >= ${dayStr(from)}::date AND f.deleted_at IS NULL AND ${t}
    )
    SELECT
      (SELECT count(*)::int FROM act) AS total,
      (SELECT count(*)::int FROM act WHERE EXISTS (SELECT 1 FROM task_assignments ta JOIN users c ON c.id = ta.child_id
         WHERE c.family_id = act.family_id AND ta.status = 'approved' AND ta.approved_at >= ${from})) AS tasks,
      (SELECT count(*)::int FROM act WHERE EXISTS (SELECT 1 FROM reward_redemptions r JOIN users c ON c.id = r.child_id
         WHERE c.family_id = act.family_id AND r.created_at >= ${from} AND r.status <> 'cancelled')) AS rewards,
      (SELECT count(*)::int FROM act WHERE EXISTS (SELECT 1 FROM game_sessions g JOIN users c ON c.id = g.child_id
         WHERE c.family_id = act.family_id AND g.started_at >= ${from})) AS games,
      (SELECT count(*)::int FROM act WHERE EXISTS (SELECT 1 FROM child_profiles cp JOIN users c ON c.id = cp.user_id
         WHERE c.family_id = act.family_id AND cp.current_streak_days >= 3)) AS streak,
      (SELECT count(*)::int FROM act WHERE EXISTS (SELECT 1 FROM expo_push_tokens e JOIN users u ON u.id = e.user_id
         WHERE u.family_id = act.family_id)) AS mobile,
      (SELECT count(*)::int FROM act WHERE EXISTS (SELECT 1 FROM analytics_events e
         WHERE e.family_id = act.family_id AND e.event_type = 'DIGEST_OPENED' AND e.created_at >= ${from})) AS digest,
      (SELECT count(*)::int FROM act WHERE (SELECT count(*) FROM users u
         WHERE u.family_id = act.family_id AND u.role = 'parent' AND u.deleted_at IS NULL) >= 2) AS coparent`;
  const total = r?.total ?? 0;
  const items: Array<[string, string, number]> = [
    ['tasks', 'Tasks approved', r?.tasks ?? 0],
    ['mobile', 'Android app installed', r?.mobile ?? 0],
    ['rewards', 'Rewards redeemed', r?.rewards ?? 0],
    ['streak', 'A child on a 3+ day streak', r?.streak ?? 0],
    ['games', 'Games played', r?.games ?? 0],
    ['digest', 'Weekly digest opened', r?.digest ?? 0],
    ['coparent', 'Co-parent joined', r?.coparent ?? 0],
  ];
  return { activeFamilies: total, features: items.map(([key, label, n]) => ({ key, label, families: n, pct: pct(n, total) })) };
}

async function health(from: Date) {
  const [emails, pendingApprovals] = await Promise.all([
    prisma.emailLog.groupBy({ by: ['status'], where: { createdAt: { gte: from } }, _count: { _all: true } }),
    prisma.taskAssignment.count({ where: { status: 'completed' } }),
  ]);
  const sent = emails.find((e) => e.status === 'sent')?._count._all ?? 0;
  const failed = emails.filter((e) => e.status !== 'sent').reduce((n, e) => n + e._count._all, 0);
  const cpus = os.cpus().length || 1;
  return {
    emailDeliveryRate: pct(sent, sent + failed),
    emailsFailed: failed,
    serverLoadPct: Math.round((os.loadavg()[0] / cpus) * 100),
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    uptimeHours: Math.round((process.uptime() / 3600) * 10) / 10,
    pendingApprovals,
  };
}

export const PlatformInsightsService = {
  async overview(params: { range: RangeKey; includeTesters: boolean; now?: Date }) {
    const now = params.now ?? new Date();
    const days = RANGES[params.range];
    const from = new Date(now.getTime() - days * DAY_MS);
    const prevFrom = new Date(from.getTime() - days * DAY_MS);
    const inc = params.includeTesters;

    const all = await loadFamilies();
    const families = inc ? all : all.filter((f) => !f.isTest);

    const today = startOfUtcDay(now);
    const stepDays = days > 90 ? 7 : 1;
    const points = Math.floor((days - 1) / stepDays);
    const fromDay = dayStr(new Date(today.getTime() - points * stepDays * DAY_MS));

    const cohortFamilies = families.filter((f) => f.createdAt.getTime() >= weekStart(now).getTime() - 7 * 7 * DAY_MS);
    const cohortIds = cohortFamilies.map((f) => f.id);

    const [series, churnNow, churnPrev, eng, adopt, hlth, childrenActive, cohortDays] = await Promise.all([
      activitySeries(fromDay, dayStr(today), stepDays, inc),
      churn(today, inc),
      churn(new Date(today.getTime() - 30 * DAY_MS), inc),
      engagement(now, from, inc),
      adoption(from, inc),
      health(from),
      prisma.user.count({
        where: {
          role: 'child',
          deletedAt: null,
          lastActiveAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
          family: { deletedAt: null, ...(inc ? {} : { isTestAccount: false }) },
        },
      }),
      cohortIds.length
        ? prisma.familyActivityDay.findMany({ where: { familyId: { in: cohortIds } }, select: { familyId: true, day: true } })
        : Promise.resolve([] as Array<{ familyId: string; day: Date }>),
    ]);

    const activityDays = new Map<string, string[]>();
    for (const r of cohortDays) {
      const list = activityDays.get(r.familyId) ?? [];
      list.push(dayStr(r.day));
      activityDays.set(r.familyId, list);
    }

    const created = (lo: Date, hi: Date) =>
      families.filter((f) => f.createdAt >= lo && f.createdAt < hi);
    const newNow = created(from, now);
    const newPrev = created(prevFrom, from);
    const sum = (list: FamilyRow[], k: 'parents' | 'children') => list.reduce((n, f) => n + f[k], 0);

    const parents = sum(families, 'parents');
    const children = sum(families, 'children');
    const weeklyActive = series.length ? series[series.length - 1].weekly : 0;
    const act = activationRate(families, now, days);
    const actPrev = activationRate(families, from, days);

    return {
      range: params.range,
      includeTesters: inc,
      generatedAt: now.toISOString(),
      testFamilies: all.filter((f) => f.isTest).length,
      kpis: {
        families: { value: families.length, newInRange: newNow.length, newPrevRange: newPrev.length },
        parents: {
          value: parents,
          perFamily: families.length ? Math.round((parents / families.length) * 10) / 10 : null,
          coParentShare: pct(families.filter((f) => f.parents >= 2).length, families.length),
        },
        children: {
          value: children,
          perFamily: families.length ? Math.round((children / families.length) * 10) / 10 : null,
          activeLast7d: childrenActive,
        },
        weeklyActive: { value: weeklyActive, pct: pct(weeklyActive, families.length) },
        activation: { rate: act.rate, cohort: act.cohort, prevRate: actPrev.rate },
        churn30d: { rate: churnNow, prevRate: churnPrev },
      },
      activity: { stepDays, points: series },
      engagement: eng,
      lifecycle: lifecycleCounts(families, now),
      weeklySignups: weeklySignups(families, now),
      cohorts: cohortGrid(cohortFamilies, activityDays, now),
      adoption: adopt,
      health: hlth,
    };
  },
};
